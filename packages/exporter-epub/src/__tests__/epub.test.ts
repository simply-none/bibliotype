/**
 * EPUB 导出测试
 *
 * 覆盖：OCF 打包结构（mimetype 首条目 STORE）、OPF 元数据与 spine（EPUB 3 默认 /
 * EPUB 2 兼容两路）、章节切分与体积兜底拆分、nav 目录与自动锚点、XHTML 转义、
 * 媒体打包（data URI → 独立文件 + 封面声明）、导出前校验、古籍布局场景、
 * 导出确定性与空书边界，以及标识符工具。
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THEME,
  FONT_TOKENS,
  NODE_TYPES,
  createEmptyDocument,
  type BookDocument,
  type BookNode,
} from '@bibliotype/core';
import { CLASSICAL_LAYOUT_OPTIONS, FACSIMILE_PRESETS } from '@bibliotype/layout';
import { escapeXml, serializeNode, stripInvalidXmlChars } from '@bibliotype/layout/html';
import { strFromU8, unzipSync } from 'fflate';
import { EPUB_MIMETYPE, buildContainerXml, exportEpub } from '../epub.js';
import { buildOpf, normalizeModified } from '../opf.js';
import {
  buildDefaultIdentifier,
  fnv1a,
  isIsbn,
  normalizeIdentifier,
  resolveIdentifier,
} from '../identifier.js';
import { planDocument, splitSections } from '../sections.js';
import type { ValidationProblem } from '../validate.js';

/** 固定修改时间（带小数秒的输入；导出应规范化到无小数秒的 Z 形式） */
const FIXED_MODIFIED = '2026-01-02T00:00:00.000Z';
/** 规范化后的期望输出（EPUB 3.3 要求的 CCYY-MM-DDThh:mm:ssZ） */
const FIXED_MODIFIED_NORMALIZED = '2026-01-02T00:00:00Z';

/** 1x1 PNG（嗅探魔术字节用；内容任意） */
const PNG_1X1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** 构造样本：书 > 卷（1/2/无 id 章，含嵌套节） + 卷后散块 */
function sampleDoc(): BookDocument {
  const doc = createEmptyDocument({
    title: '论语',
    subtitle: '校注本',
    language: 'zh-Hant',
    contributors: [{ name: '孔子', dynasty: '春秋', role: '述' }],
    publication: { publisher: '中华书局', year: '2019' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: FIXED_MODIFIED,
  });
  doc.root.children = [
    {
      type: NODE_TYPES.VOLUME,
      id: 'vol-1',
      attrs: { title: '卷一' },
      children: [
        {
          type: NODE_TYPES.CHAPTER,
          id: 'chap-1',
          children: [
            { type: 'text', text: '学而第一' },
            {
              type: NODE_TYPES.PARAGRAPH,
              id: 'p-1',
              children: [{ type: 'text', text: '子曰：学而时习之。' }],
            },
          ],
        },
        {
          type: NODE_TYPES.CHAPTER,
          id: 'chap-2',
          attrs: { title: '为政第二' },
          children: [
            {
              type: NODE_TYPES.SECTION,
              id: 'sec-1',
              attrs: { title: '为政篇上' },
              children: [],
            },
          ],
        },
        {
          type: NODE_TYPES.CHAPTER,
          attrs: { title: '里仁第四' },
          children: [],
        },
      ],
    },
    {
      type: NODE_TYPES.PARAGRAPH,
      id: 'p-2',
      children: [{ type: 'text', text: '附记：散块聚合。' }],
    },
  ];
  return doc;
}

/** 解包 EPUB 并将全部条目解码为文本 */
function readEntries(epub: Uint8Array): Record<string, string> {
  const files = unzipSync(epub);
  const entries: Record<string, string> = {};
  for (const [name, bytes] of Object.entries(files)) {
    entries[name] = strFromU8(bytes);
  }
  return entries;
}

/** 收集校验问题（导出默认开启校验） */
function exportWithProblems(
  doc: BookDocument,
  options: Parameters<typeof exportEpub>[1] = {},
): { entries: Record<string, string>; problems: ValidationProblem[] } {
  let problems: ValidationProblem[] = [];
  const epub = exportEpub(doc, {
    ...options,
    onValidation: (p) => {
      problems = [...p];
    },
  });
  return { entries: readEntries(epub), problems };
}

describe('OCF 打包结构', () => {
  it('mimetype 为 zip 首条目且以 STORE（不压缩）写入', () => {
    const epub = exportEpub(sampleDoc(), { modified: FIXED_MODIFIED });
    const view = new DataView(epub.buffer, epub.byteOffset, epub.byteLength);

    /* ZIP 本地文件头：签名 4B + 版本 2B + 标志 2B + 压缩方法 2B */
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint16(8, true)).toBe(0); // 0 = STORE

    const nameLength = view.getUint16(26, true);
    const extraLength = view.getUint16(28, true);
    const name = strFromU8(epub.subarray(30, 30 + nameLength));
    expect(name).toBe('mimetype');
    expect(extraLength).toBe(0);

    const contentStart = 30 + nameLength + extraLength;
    const content = strFromU8(epub.subarray(contentStart, contentStart + nameLength + 20));
    expect(content.startsWith(EPUB_MIMETYPE)).toBe(true);
  });

  it('包含 OCF 必需文件与全部章节文档', () => {
    const files = unzipSync(exportEpub(sampleDoc(), { modified: FIXED_MODIFIED }));
    const names = Object.keys(files);

    expect(names).toContain('mimetype');
    expect(names).toContain('META-INF/container.xml');
    expect(names).toContain('OEBPS/content.opf');
    expect(names).toContain('OEBPS/toc.ncx');
    expect(names).toContain('OEBPS/nav.xhtml');
    expect(names).toContain('OEBPS/style.css');
    expect(names).toContain('OEBPS/text/sec-0.xhtml');
    expect(names).toContain('OEBPS/text/sec-1.xhtml');
    expect(names).not.toContain('OEBPS/text/sec-2.xhtml');
  });

  it('container.xml 指向 OEBPS/content.opf', () => {
    expect(buildContainerXml()).toContain('full-path="OEBPS/content.opf"');
    expect(buildContainerXml()).toContain('media-type="application/oebps-package+xml"');

    const files = readEntries(exportEpub(sampleDoc(), { modified: FIXED_MODIFIED }));
    expect(files['META-INF/container.xml']).toContain('full-path="OEBPS/content.opf"');
  });

  it('导出确定性：相同输入两次导出字节一致', () => {
    const first = exportEpub(sampleDoc(), { modified: FIXED_MODIFIED });
    const second = exportEpub(sampleDoc(), { modified: FIXED_MODIFIED });
    expect(Array.from(second)).toEqual(Array.from(first));
  });

  it('导出默认无校验问题（error 级）', () => {
    const { problems } = exportWithProblems(sampleDoc(), { modified: FIXED_MODIFIED });
    const errors = problems.filter((p) => p.severity === 'error');
    expect(errors).toEqual([]);
  });
});

describe('OPF 包文档（EPUB 3 默认）', () => {
  it('EPUB 3：version=3.0、dcterms:modified、nav properties、refines、creator role', () => {
    const files = readEntries(exportEpub(sampleDoc(), { modified: FIXED_MODIFIED }));
    const opf = files['OEBPS/content.opf'];

    expect(opf).toContain('<package xmlns="http://www.idpf.org/2007/opf" version="3.0"');
    expect(opf).toContain('<dc:identifier id="pub-id">urn:bibliotype:');
    expect(opf).toContain('<dc:title id="bt-title">论语</dc:title>');
    /* EPUB 3 特性 */
    expect(opf).toContain(`<meta property="dcterms:modified">${FIXED_MODIFIED_NORMALIZED}</meta>`);
    expect(opf).toContain(
      '<meta refines="#bt-title" property="dcterms:title" xml:lang="zh-Hant">校注本</meta>',
    );
    expect(opf).toContain('<dc:creator opf:role="aut">孔子</dc:creator>');
    expect(opf).toContain('<dc:language>zh-Hant</dc:language>');
    expect(opf).toContain('<dc:publisher>中华书局</dc:publisher>');
    expect(opf).toContain('<dc:date>2026-01-02</dc:date>');
    /* nav 挂 properties；ncx 仍保留（EPUB 3 向后兼容推荐做法） */
    expect(opf).toContain(
      '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    );
    expect(opf).toContain('<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>');
    expect(opf).toContain('<spine toc="ncx">');
    expect(opf).toContain('href="style.css" media-type="text/css"');
  });

  it('EPUB 2 兼容：显式 version=2.0，无 EPUB3 专属 meta（RMSDK 可解析）', () => {
    const files = readEntries(exportEpub(sampleDoc(), { modified: FIXED_MODIFIED, version: '2.0' }));
    const opf = files['OEBPS/content.opf'];

    expect(opf).toContain('<package xmlns="http://www.idpf.org/2007/opf" version="2.0"');
    expect(opf).toContain(
      '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">',
    );
    /* EPUB 2 路径不输出 EPUB3 专属 meta（RMSDK 不认 property 属性） */
    expect(opf).not.toContain('<meta refines=');
    expect(opf).not.toContain('<meta property="dcterms:modified">');
    expect(opf).not.toContain('properties="nav"');
    expect(opf).not.toContain('opf:role');
    expect(opf).toContain('<dc:date>2026-01-02</dc:date>');
    expect(opf).toContain('<spine toc="ncx">');
    /* EPUB 2 内容文档保持 XHTML 1.1 文档壳 */
    expect(files['OEBPS/text/sec-0.xhtml']).toContain(
      '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">',
    );
    expect(files['OEBPS/text/sec-0.xhtml']).toContain(
      '<meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>',
    );
  });

  it('生成 toc.ncx（EPUB 2 目录，RMSDK 兼容）且结构正确', () => {
    const files = readEntries(exportEpub(sampleDoc(), { modified: FIXED_MODIFIED }));
    expect(files['OEBPS/toc.ncx']).toBeDefined();
    const ncx = files['OEBPS/toc.ncx'];

    expect(ncx).toContain('<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"');
    /* dtb:uid 须与 OPF 的 dc:identifier 内容一致（京东读书据此校验） */
    expect(ncx).toContain('<meta content="urn:bibliotype:');
    expect(ncx).toContain('name="dtb:uid"/>');
    expect(ncx).toContain('<docTitle>');
    expect(ncx).toContain('<navMap>');
    /* navPoint 含顺序 playOrder 与 content src（与 nav 同源 href） */
    expect(ncx).toContain('<navPoint id="np-1" playOrder="1">');
    expect(ncx).toContain('<content src="text/sec-0.xhtml#vol-1"/>');
    expect(ncx).toContain('<content src="text/sec-0.xhtml#chap-1"/>');
    /* playOrder 全局递增且唯一：np-1..np-N 连续 */
    const playOrders = [...ncx.matchAll(/playOrder="(\d+)"/g)].map((m) => Number(m[1]));
    expect(playOrders).toEqual(playOrders.slice().sort((a, b) => a - b));
    expect(new Set(playOrders).size).toBe(playOrders.length);
    expect(playOrders[0]).toBe(1);
  });

  it('修改时间输出：EPUB 3 保留规范化后的 dcterms:modified，两路均有 dc:date', () => {
    /* 默认 EPUB 3 导出 */
    const a = readEntries(exportEpub(sampleDoc(), { modified: '2026-01-02T00:00:00.000Z' }));
    expect(a['OEBPS/content.opf']).toContain(
      `<meta property="dcterms:modified">${FIXED_MODIFIED_NORMALIZED}</meta>`,
    );
    expect(a['OEBPS/content.opf']).toContain('<dc:date>2026-01-02</dc:date>');
    expect(a['OEBPS/content.opf']).not.toContain('.000Z');

    /* 时区偏移 → 归一到 UTC */
    const b = readEntries(exportEpub(sampleDoc(), { modified: '2026-01-02T08:00:00+08:00' }));
    expect(b['OEBPS/content.opf']).toContain(
      `<meta property="dcterms:modified">${FIXED_MODIFIED_NORMALIZED}</meta>`,
    );

    /* EPUB 2 路径：仅 dc:date，不输出 EPUB3 专属 meta */
    const c = readEntries(
      exportEpub(sampleDoc(), { modified: '2026-01-02T08:00:00+08:00', version: '2.0' }),
    );
    expect(c['OEBPS/content.opf']).toContain('<dc:date>2026-01-02</dc:date>');
    expect(c['OEBPS/content.opf']).not.toContain('<meta property="dcterms:modified">');
  });

  it('normalizeModified：幂等、回退且输出符合 EPUB 3.3 格式', () => {
    expect(normalizeModified('2026-01-02T00:00:00.000Z')).toBe(FIXED_MODIFIED_NORMALIZED);
    expect(normalizeModified('2026-01-02T08:00:00+08:00')).toBe(FIXED_MODIFIED_NORMALIZED);
    expect(normalizeModified('2026-01-02T00:00:00Z')).toBe(FIXED_MODIFIED_NORMALIZED);
    expect(normalizeModified('not-a-date')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it('spine 顺序与章节文件一致', () => {
    const files = readEntries(exportEpub(sampleDoc(), { modified: FIXED_MODIFIED }));
    const opf = files['OEBPS/content.opf'];

    const first = opf.indexOf('<itemref idref="sec-0"/>');
    const second = opf.indexOf('<itemref idref="sec-1"/>');
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
  });

  it('导出选项：identifier / language 覆盖元数据', () => {
    const files = readEntries(
      exportEpub(sampleDoc(), {
        identifier: 'urn:isbn:978-7-101-00000-0',
        language: 'zh-Hans',
        modified: FIXED_MODIFIED,
      }),
    );
    expect(files['OEBPS/content.opf']).toContain(
      '<dc:identifier id="pub-id">urn:isbn:978-7-101-00000-0</dc:identifier>',
    );
    expect(files['OEBPS/content.opf']).toContain('<dc:language>zh-Hans</dc:language>');
    expect(files['OEBPS/text/sec-0.xhtml']).toContain('xml:lang="zh-Hans"');
  });
});

describe('章节切分与体积兜底拆分', () => {
  it('planDocument：结构节点各成一文件，散块聚合，无 id 结构节点分配锚点', () => {
    const plan = planDocument(sampleDoc().root);
    expect(plan.sections.map((section) => section.file)).toEqual([
      'text/sec-0.xhtml',
      'text/sec-1.xhtml',
    ]);
    expect(plan.sections[0]?.nodes).toHaveLength(1);
    expect(plan.sections[1]?.nodes).toHaveLength(1);

    /* 仅「里仁第四」章无 id，获得 bt-a-1 */
    expect([...plan.anchors.values()]).toEqual(['bt-a-1']);
    const anchored = [...plan.anchors.keys()][0];
    expect(anchored?.attrs?.title).toBe('里仁第四');
  });

  it('splitSections：小文档保持原分组（不过度拆分）', () => {
    const plan = planDocument(sampleDoc().root);
    const split = splitSections(plan, { serialize: serializeNode });
    expect(split.sections).toHaveLength(2);
    expect(split.oversized).toEqual([]);
    expect(split.sections[0]?.nodes).toHaveLength(1);
    expect(split.sections[1]?.nodes).toHaveLength(1);
  });

  it('splitSections：扁平大书按字节上限拆成多文档（导入型书打不开的核心修复）', () => {
    /* 模拟导入型扁平文档：大量段落，无结构节点 */
    const doc = createEmptyDocument({ title: '大书' });
    const paragraphs: BookNode[] = [];
    for (let i = 0; i < 400; i += 1) {
      paragraphs.push({
        type: NODE_TYPES.PARAGRAPH,
        children: [{ type: 'text', text: `第${i}段：${'内容'.repeat(80)}` }],
      });
    }
    doc.root.children = paragraphs;

    /* 上限 8KB：400 段 × ~400B 应拆成多份 */
    const plan = planDocument(doc.root);
    const split = splitSections(plan, { serialize: serializeNode, maxSectionBytes: 8 * 1024 });
    expect(split.sections.length).toBeGreaterThan(10);
    /* 每份未压缩体积不超上限（文档壳开销已预留） */
    for (const section of split.sections) {
      const bytes = new TextEncoder().encode(
        section.nodes.map((n) => serializeNode(n)).join('\n'),
      ).length;
      expect(bytes).toBeLessThanOrEqual(8 * 1024);
    }
    /* 拆分是保序的：全部段落按原顺序拼接无丢失 */
    const flat = split.sections.flatMap((s) => s.nodes);
    expect(flat).toHaveLength(400);
    expect(flat[0]).toBe(paragraphs[0]);
    expect(flat[399]).toBe(paragraphs[399]);
  });

  it('splitSections：超大结构节点按子节点边界拆，首桶保留 id（锚点有效）', () => {
    const doc = createEmptyDocument({ title: '巨型卷' });
    const chapters: BookNode[] = [];
    for (let i = 0; i < 30; i += 1) {
      chapters.push({
        type: NODE_TYPES.CHAPTER,
        id: `chap-${i}`,
        attrs: { title: `第${i}章` },
        children: [
          { type: NODE_TYPES.PARAGRAPH, children: [{ type: 'text', text: '正文'.repeat(300) }] },
        ],
      });
    }
    doc.root.children = [
      { type: NODE_TYPES.VOLUME, id: 'vol-big', attrs: { title: '大卷' }, children: chapters },
    ];

    const plan = planDocument(doc.root);
    const split = splitSections(plan, { serialize: serializeNode, maxSectionBytes: 16 * 1024 });
    expect(split.sections.length).toBeGreaterThan(1);
    /* 首桶是带 id 的卷外壳克隆（导航锚点 vol-big 仍可跳转） */
    expect(split.sections[0]?.nodes[0]?.id).toBe('vol-big');
    /* 后续桶剥掉 id：同一 id 不出现在多份文档 */
    const laterIds = split.sections.slice(1).map((s) => s.nodes[0]?.id);
    expect(laterIds.every((id) => id === undefined)).toBe(true);
    /* 30 章全部保留 */
    const chaptersOut = split.sections.flatMap((s) =>
      (s.nodes[0]?.children ?? []).filter((c) => c.type === NODE_TYPES.CHAPTER),
    );
    expect(chaptersOut).toHaveLength(30);
  });

  it('splitSections：空书兜底一份内容文档', () => {
    const plan = planDocument(createEmptyDocument({ title: '空书' }).root);
    const split = splitSections(plan, { serialize: serializeNode });
    expect(split.sections).toHaveLength(1);
    expect(split.sections[0]?.nodes).toEqual([]);
  });

  it('卷文件容纳全部子章，散块文件承载卷后内容', () => {
    const files = readEntries(exportEpub(sampleDoc(), { modified: FIXED_MODIFIED }));
    const first = files['OEBPS/text/sec-0.xhtml'] ?? '';
    const second = files['OEBPS/text/sec-1.xhtml'] ?? '';

    expect(first).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(first).toContain('<section id="vol-1" class="bt-volume" data-title="卷一">');
    expect(first).toContain('学而第一');
    expect(first).toContain('<p id="p-1" class="bt-paragraph">子曰：学而时习之。</p>');
    expect(first).toContain('<section id="sec-1" class="bt-section" data-title="为政篇上"></section>');

    expect(second).toContain('id="p-2"');
    expect(second).toContain('附记：散块聚合。');
    expect(second).not.toContain('bt-volume');
  });

  it('文本与属性转义（XML 实体）', () => {
    const doc = createEmptyDocument({ title: '样本' });
    doc.root.children = [
      {
        type: NODE_TYPES.CHAPTER,
        id: 'c-1',
        attrs: { title: '篇名 <A> & "B"' },
        children: [
          {
            type: NODE_TYPES.PARAGRAPH,
            children: [{ type: 'text', text: "a < b & \"c\" 'd'" }],
          },
        ],
      },
    ];
    const files = readEntries(exportEpub(doc, { modified: FIXED_MODIFIED }));
    const sec = files['OEBPS/text/sec-0.xhtml'] ?? '';

    expect(sec).toContain('<title>篇名 &lt;A&gt; &amp; &quot;B&quot;</title>');
    expect(sec).toContain('data-title="篇名 &lt;A&gt; &amp; &quot;B&quot;"');
    expect(sec).toContain('a &lt; b &amp; &quot;c&quot; &#39;d&#39;');
  });

  it('内容文档为 XHTML5 且声明 charset（EPUB 3 默认壳）', () => {
    const files = readEntries(exportEpub(sampleDoc(), { modified: FIXED_MODIFIED }));
    const first = files['OEBPS/text/sec-0.xhtml'] ?? '';
    expect(first).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(first).toContain('<!DOCTYPE html>');
    expect(first).toContain('<meta charset="utf-8"/>');
    expect(first).not.toContain('<meta http-equiv');
  });
});

describe('媒体打包（data URI → 独立文件）', () => {
  /** 带封面图 + 正文重复引用同图 + 外链图的文档 */
  function mediaDoc(): BookDocument {
    const doc = createEmptyDocument({ title: '带图书' });
    doc.root.children = [
      {
        type: NODE_TYPES.COVER,
        id: 'cover-1',
        children: [
          { type: NODE_TYPES.IMAGE, attrs: { src: PNG_1X1, alt: '封面' }, children: [] },
        ],
      },
      {
        type: NODE_TYPES.CHAPTER,
        id: 'c-1',
        children: [
          {
            type: NODE_TYPES.PARAGRAPH,
            children: [{ type: NODE_TYPES.IMAGE, attrs: { src: PNG_1X1 }, children: [] }],
          },
          {
            type: NODE_TYPES.PARAGRAPH,
            children: [
              {
                type: NODE_TYPES.IMAGE,
                attrs: { src: 'https://example.com/remote.png' },
                children: [],
              },
            ],
          },
        ],
      },
    ];
    return doc;
  }

  it('data URI 图片打包为 OEBPS/media 独立文件并登记 manifest', () => {
    const { entries, problems } = exportWithProblems(mediaDoc(), { modified: FIXED_MODIFIED });

    const mediaNames = Object.keys(entries).filter((n) => n.startsWith('OEBPS/media/'));
    expect(mediaNames).toHaveLength(1); /* 两处引用去重为一份 */
    expect(mediaNames[0] ?? '').toMatch(/^OEBPS\/media\/img-[0-9a-f]{8}\.png$/);

    const opf = entries['OEBPS/content.opf'] ?? '';
    /* manifest 登记（media-type 嗅探自字节，而非 data URI 声明）+ EPUB 3 封面 properties */
    expect(opf).toMatch(
      /<item id="media-1" href="media\/img-[0-9a-f]{8}\.png" media-type="image\/png" properties="cover-image"\/>/,
    );
    /* EPUB 3 封面走 properties；EPUB 2 才走 meta name="cover" */
    expect(opf).not.toContain('<meta name="cover"');

    /* 内容文档里的引用改写为相对路径（封面在 sec-0，正文图在 sec-1） */
    const secs = Object.keys(entries)
      .filter((n) => n.startsWith('OEBPS/text/'))
      .map((n) => entries[n] ?? '')
      .join('\n');
    expect(secs).toContain('src="../media/img-');
    expect(secs).not.toContain('data:image/png;base64,');
    /* 外链原样保留 */
    expect(secs).toContain('src="https://example.com/remote.png"');

    /* 无 error 级问题；外链仅有 warning */
    expect(problems.filter((p) => p.severity === 'error')).toEqual([]);
    expect(problems.some((p) => p.code === 'MEDIA-04')).toBe(true);
  });

  it('EPUB 2 兼容路径：封面走 meta name="cover"', () => {
    const files = readEntries(
      exportEpub(mediaDoc(), { modified: FIXED_MODIFIED, version: '2.0' }),
    );
    const opf = files['OEBPS/content.opf'] ?? '';
    expect(opf).toContain('<meta name="cover" content="media-1"/>');
    expect(opf).not.toContain('properties="cover-image"');
  });

  it('图片字节与 manifest 声明一致（嗅探优先于 data URI 声明）', () => {
    /* 声明 jpeg 实际是 PNG：嗅探应纠正为 image/png */
    const doc = createEmptyDocument({ title: '错声明' });
    doc.root.children = [
      {
        type: NODE_TYPES.CHAPTER,
        id: 'c-1',
        children: [
          {
            type: NODE_TYPES.PARAGRAPH,
            children: [
              {
                type: NODE_TYPES.IMAGE,
                attrs: { src: PNG_1X1.replace('image/png', 'image/jpeg') },
                children: [],
              },
            ],
          },
        ],
      },
    ];
    const files = readEntries(exportEpub(doc, { modified: FIXED_MODIFIED }));
    const opf = files['OEBPS/content.opf'] ?? '';
    expect(opf).toMatch(/media-type="image\/png"/);
    expect(opf).not.toMatch(/media-type="image\/jpeg"/);
  });

  it('死链（包内不存在的相对路径）报 MEDIA-01 error', () => {
    const doc = createEmptyDocument({ title: '死链书' });
    doc.root.children = [
      {
        type: NODE_TYPES.CHAPTER,
        id: 'c-1',
        children: [
          {
            type: NODE_TYPES.PARAGRAPH,
            children: [
              { type: NODE_TYPES.IMAGE, attrs: { src: 'Images/missing.jpeg' }, children: [] },
            ],
          },
        ],
      },
    ];
    const { problems } = exportWithProblems(doc, { modified: FIXED_MODIFIED });
    expect(problems.some((p) => p.code === 'MEDIA-01' && p.severity === 'error')).toBe(true);
  });
});

describe('nav 目录', () => {
  it('结构层级渲染为嵌套 ol，href 携带锚点', () => {
    const files = readEntries(exportEpub(sampleDoc(), { modified: FIXED_MODIFIED }));
    const nav = files['OEBPS/nav.xhtml'] ?? '';

    expect(nav).toContain('<nav epub:type="toc" id="bt-toc">');
    expect(nav).toContain('href="text/sec-0.xhtml#vol-1">卷一</a>');
    expect(nav).toContain('href="text/sec-0.xhtml#chap-1">学而第一</a>');

    /* 节嵌套在章条目之下 */
    expect(nav).toContain('href="text/sec-0.xhtml#chap-2">为政第二</a>\n<ol>');
    expect(nav).toContain('href="text/sec-0.xhtml#sec-1">为政篇上</a>');
  });

  it('无 id 结构节点：自动锚点与 XHTML id 一致', () => {
    const files = readEntries(exportEpub(sampleDoc(), { modified: FIXED_MODIFIED }));

    expect(files['OEBPS/nav.xhtml']).toContain('href="text/sec-0.xhtml#bt-a-1">里仁第四</a>');
    expect(files['OEBPS/text/sec-0.xhtml']).toContain(
      '<section id="bt-a-1" class="bt-chapter" data-title="里仁第四"></section>',
    );
  });
});

describe('古籍场景', () => {
  it('直排布局：CSS 直排规则 + 字体令牌 + 插件节点兜底（导出路径扁平化变量）', () => {
    const doc = createEmptyDocument({ title: '论语集注', language: 'zh-Hant' });
    doc.root.children = [
      {
        type: NODE_TYPES.CHAPTER,
        id: 'chap-1',
        attrs: { title: '学而' },
        children: [
          {
            type: NODE_TYPES.PARAGRAPH,
            children: [{ type: 'text', text: '子曰：学而时习之。' }],
          },
          {
            type: 'double-note',
            attrs: { kind: 'jiaozhu' },
            children: [
              {
                type: NODE_TYPES.PARAGRAPH,
                children: [{ type: 'text', text: '朱注：习，鸟数飞也。' }],
              },
            ],
          },
        ],
      },
    ];

    const files = readEntries(
      exportEpub(doc, {
        layout: CLASSICAL_LAYOUT_OPTIONS,
        tokens: {
          ...DEFAULT_THEME,
          'writing-mode': 'vertical-rl',
          'text-combine-upright': 'digits',
          'text-combine-limit': '4',
        },
        fontToken: FONT_TOKENS.CLASSICAL_BODY,
        modified: FIXED_MODIFIED,
      }),
    );

    const css = files['OEBPS/style.css'] ?? '';
    /* 直排规则保留 */
    expect(css).toContain('writing-mode: vertical-rl;');
    expect(css).toContain('text-combine-upright: digits 4;');
    /* 老引擎前缀（P1-7） */
    expect(css).toContain('-webkit-writing-mode: vertical-rl;');
    /* 导出路径扁平化：无变量层、无 var() 引用（RMSDK / 微信读书老引擎兼容） */
    expect(css).not.toContain(':root {');
    expect(css).not.toContain('var(--bt-');
    expect(css).toContain('font-family: ');

    expect(files['OEBPS/text/sec-0.xhtml']).toContain(
      '<div class="bt-double-note" data-kind="jiaozhu"><p class="bt-paragraph">朱注：习，鸟数飞也。</p></div>',
    );
  });

  it('阅读 / 编辑路径（不传 flatten）仍输出变量层', async () => {
    const { buildBookCss } = await import('@bibliotype/layout/html');
    const css = buildBookCss({
      tokens: { ...DEFAULT_THEME, 'writing-mode': 'vertical-rl' },
      options: CLASSICAL_LAYOUT_OPTIONS,
    });
    expect(css).toContain(':root {');
    expect(css).toContain('var(--bt-');
  });
});

describe('XML 格式良好（非法字符净化）', () => {
  /** XML 1.0 非法字符集（除 TAB/LF/CR 外的 C0 控制符 + #xFFFE / #xFFFF） */
  const INVALID_XML_CHARS_G = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g;
  /** 全部非法字符拼接（每个前面加一个汉字，便于定位） */
  const DIRTY = '文'
    .padEnd(1)
    .concat('\u0000\u0001\u0002\u0003\u0004\u0005\u0006\u0007\u0008\u000b\u000c')
    .concat('\u000e\u000f\u0011\u0012\u0014\u001a\u001f\ufffe\uffff')
    .concat('末');

  /** 构造「正文 + 标题 + 属性 + 元数据」四处都携带非法字符的文档 */
  function dirtyDoc(): BookDocument {
    const doc = createEmptyDocument({
      title: `书名${DIRTY}样本`,
      contributors: [{ name: `作者${DIRTY}` }],
      publication: { publisher: `出版社${DIRTY}` },
    });
    doc.root.children = [
      {
        type: NODE_TYPES.CHAPTER,
        id: 'chap-1',
        attrs: { title: `章名${DIRTY}` },
        children: [
          { type: 'text', text: DIRTY },
          {
            type: NODE_TYPES.PARAGRAPH,
            children: [{ type: 'text', text: `正文${DIRTY}内容` }],
          },
          {
            type: NODE_TYPES.PARAGRAPH,
            children: [
              { type: 'text', text: `带注音${DIRTY}`, marks: [{ type: 'ruby', attrs: { text: DIRTY } }] },
            ],
          },
          {
            type: 'text',
            text: `链接${DIRTY}`,
            marks: [{ type: 'link', attrs: { href: `https://x.test/#${DIRTY}` } }],
          } as unknown as BookNode,
        ],
      },
    ];
    return doc;
  }

  it('导出全部条目不含 XML 1.0 非法字符（正文 / 属性 / 元数据 / NCX / nav）', () => {
    const files = readEntries(exportEpub(dirtyDoc(), { modified: FIXED_MODIFIED }));
    for (const [name, text] of Object.entries(files)) {
      expect(text.match(INVALID_XML_CHARS_G), `${name} 含非法字符`).toBeNull();
    }
  });

  it('净化不误伤正常字符：控制字符相邻文本与代理对（emoji）完整保留', () => {
    const text = '子曰：学而时习之。\n第二行\t缩进符\r\n x 时 ☀ 😀 done';
    const doc = createEmptyDocument({ title: '净化口径' });
    doc.root.children = [
      {
        type: NODE_TYPES.CHAPTER,
        id: 'chap-1',
        children: [{ type: NODE_TYPES.PARAGRAPH, children: [{ type: 'text', text }] }],
      },
    ];
    const files = readEntries(exportEpub(doc, { modified: FIXED_MODIFIED }));
    expect(files['OEBPS/text/sec-0.xhtml']).toContain('子曰：学而时习之。');
    expect(files['OEBPS/text/sec-0.xhtml']).toContain('😀');
  });

  it('stripInvalidXmlChars 幂等且与 escapeXml 组合后仍无非法字符', () => {
    expect(stripInvalidXmlChars(DIRTY)).toBe('文末');
    expect(stripInvalidXmlChars(stripInvalidXmlChars(DIRTY))).toBe('文末');
    expect(escapeXml(`<&"'${DIRTY}`)).toBe('&lt;&amp;&quot;&#39;文末');
  });
});

describe('导入型扁平文档：目录由顶层标题重建', () => {
  /** 模拟「外部 EPUB 导入后」的 IR：无结构节点，仅 h1/h2/段落 */
  function flatDoc(): BookDocument {
    const doc = createEmptyDocument({ title: '导入书' });
    doc.root.children = [
      { type: NODE_TYPES.HEADING, attrs: { level: 1 }, children: [{ type: 'text', text: '第一篇' }] },
      { type: NODE_TYPES.PARAGRAPH, children: [{ type: 'text', text: '正文一' }] },
      { type: NODE_TYPES.HEADING, attrs: { level: 2 }, children: [{ type: 'text', text: '第一节' }] },
      { type: NODE_TYPES.PARAGRAPH, children: [{ type: 'text', text: '正文二' }] },
      { type: NODE_TYPES.HEADING, attrs: { level: 1 }, children: [{ type: 'text', text: '第二篇' }] },
      { type: NODE_TYPES.HEADING, attrs: { level: 3 }, children: [{ type: 'text', text: '太深不入目录' }] },
    ];
    return doc;
  }

  it('nav.xhtml 与 toc.ncx 不再为空，且 h2 嵌套在所属 h1 之下', () => {
    const files = readEntries(exportEpub(flatDoc(), { modified: FIXED_MODIFIED }));
    const nav = files['OEBPS/nav.xhtml'] ?? '';
    const ncx = files['OEBPS/toc.ncx'] ?? '';

    expect(nav).not.toContain('<ol></ol>');
    expect(nav).toContain('第一篇');
    expect(nav).toContain('第二篇');
    /* 节挂在其所属篇条目之下 */
    expect(nav).toMatch(/第一篇<\/a>\s*\n<ol>\s*\n<li><a[^>]*>第一节<\/a>/);
    expect(ncx).toMatch(/<navMap>\s*<navPoint/);
    expect(ncx).toContain('第一篇');
  });

  it('目录锚点与正文标题 id 一致（自动分配的 bt-a-N 已注入 XHTML）', () => {
    const files = readEntries(exportEpub(flatDoc(), { modified: FIXED_MODIFIED }));
    /* 标题优先断点：h1/h2 各自开新节（篇 / 节边界与正式 EPUB 一篇一文件同构） */
    const sec0 = files['OEBPS/text/sec-0.xhtml'] ?? '';
    const sec1 = files['OEBPS/text/sec-1.xhtml'] ?? '';
    const sec2 = files['OEBPS/text/sec-2.xhtml'] ?? '';

    /* 无 id 的顶层标题按文档序分配锚点；h3 不入目录故不分配 */
    expect(sec0).toContain('<h1 id="bt-a-1" class="bt-heading" data-level="1">第一篇</h1>');
    expect(sec1).toContain('<h2 id="bt-a-2" class="bt-heading" data-level="2">第一节</h2>');
    expect(sec2).toContain('<h1 id="bt-a-3" class="bt-heading" data-level="1">第二篇</h1>');
    /* 层级超出 MAX_NAV_HEADING_LEVEL 的标题不进目录，也不分配锚点 */
    expect(sec2).toContain('<h3 class="bt-heading" data-level="3">太深不入目录</h3>');
    expect(sec2).not.toContain('bt-a-4');

    const ncx = files['OEBPS/toc.ncx'] ?? '';
    expect(ncx).toContain('<content src="text/sec-0.xhtml#bt-a-1"/>');
    expect(ncx).toContain('<content src="text/sec-1.xhtml#bt-a-2"/>');
    expect(ncx).toContain('<content src="text/sec-2.xhtml#bt-a-3"/>');
    /* 层级超出 MAX_NAV_HEADING_LEVEL 的标题不进目录 */
    expect(ncx).not.toContain('太深不入目录');
  });

  it('结构节点内部的标题不重复入目录（demo 书籍口径不变）', () => {
    const files = readEntries(exportEpub(sampleDoc(), { modified: FIXED_MODIFIED }));
    const nav = files['OEBPS/nav.xhtml'] ?? '';

    /* 原有结构目录项一个不少 */
    expect(nav).toContain('href="text/sec-0.xhtml#vol-1">卷一</a>');
    expect(nav).toContain('href="text/sec-0.xhtml#chap-1">学而第一</a>');
    /* 无 id 的「里仁第四」仍只有自动锚点一项，未因标题重复计数 */
    expect([...nav.matchAll(/bt-a-1/g)]).toHaveLength(1);
  });
});

describe('边界与标识符', () => {
  it('空书：兜底一封内容文档，导出不抛错', () => {
    const files = readEntries(
      exportEpub(createEmptyDocument({ title: '空书' }), { modified: FIXED_MODIFIED }),
    );
    expect(files['OEBPS/text/sec-0.xhtml']).toContain('<title>空书</title>');
    expect(files['OEBPS/nav.xhtml']).toContain('<ol></ol>');
    expect(files['OEBPS/content.opf']).toContain('<itemref idref="sec-0"/>');
  });

  it('fnv1a：确定性与差异性', () => {
    expect(fnv1a('')).toBe('811c9dc5');
    expect(fnv1a('论语')).toMatch(/^[0-9a-f]{8}$/);
    expect(fnv1a('论语')).toBe(fnv1a('论语'));
    expect(fnv1a('论语')).not.toBe(fnv1a('孟子'));
  });

  it('resolveIdentifier：取首个非空项', () => {
    expect(resolveIdentifier({ title: 'x' })).toBeUndefined();
    expect(
      resolveIdentifier({
        title: 'x',
        identifiers: [
          { scheme: 'isbn', value: '' },
          { scheme: 'other', value: 'urn:isbn:978-7-101-00000-0' },
        ],
      }),
    ).toBe('urn:isbn:978-7-101-00000-0');
  });

  it('normalizeIdentifier：裸 ISBN 归一为 urn:isbn:，URI 形态原样', () => {
    /* 9787101000009 / 7101000002 均为校验位有效的构造值 */
    expect(normalizeIdentifier('978-7-101-00000-9')).toBe('urn:isbn:9787101000009');
    expect(normalizeIdentifier(' 9787101000009 ')).toBe('urn:isbn:9787101000009');
    expect(normalizeIdentifier('urn:isbn:978-7-101-00000-9')).toBe('urn:isbn:978-7-101-00000-9');
    expect(normalizeIdentifier('doi:10.1000/xyz')).toBe('doi:10.1000/xyz');
    expect(normalizeIdentifier('自定义标识')).toBe('自定义标识');
  });

  it('isIsbn：校验位正确性', () => {
    expect(isIsbn('9787101000009')).toBe(true);
    expect(isIsbn('978-7-101-00000-9')).toBe(true);
    expect(isIsbn('9787101000000')).toBe(false);
    expect(isIsbn('7101000002')).toBe(true); /* 对应 ISBN-10 */
    expect(isIsbn('7101000000')).toBe(false);
    expect(isIsbn('123')).toBe(false);
  });

  it('buildDefaultIdentifier：urn 前缀且对同一文档稳定', () => {
    const first = buildDefaultIdentifier(sampleDoc());
    expect(first).toMatch(/^urn:bibliotype:[0-9a-f]{8}$/);
    expect(buildDefaultIdentifier(sampleDoc())).toBe(first);
  });
});

describe('古籍仿真布局：EPUB 不加装饰', () => {
  it('reflow 无固定分页：样式表不含版框 / 界行 / 版心与仿真变量', () => {
    const preset = FACSIMILE_PRESETS[0];
    expect(preset).toBeDefined();
    const files = readEntries(
      exportEpub(sampleDoc(), {
        modified: FIXED_MODIFIED,
        layout: preset?.layout,
        tokens: preset?.tokens,
        fontToken: preset?.fontToken,
      }),
    );
    const css = files['OEBPS/style.css'] ?? '';
    expect(css.length).toBeGreaterThan(0);
    expect(css).not.toContain('--bt-fs-');
    expect(css).not.toContain('bt-page-gutter');
    expect(css).not.toContain('repeating-linear-gradient');
    expect(css).not.toContain('.bt-page::before');
    /* 仿真版式仍是直排：书写方向与字体照常生效 */
    expect(css).toContain('writing-mode: vertical-rl');
  });

  it('古典布局（对照）：同样不含仿真痕迹', () => {
    const files = readEntries(
      exportEpub(sampleDoc(), { modified: FIXED_MODIFIED, layout: CLASSICAL_LAYOUT_OPTIONS }),
    );
    const css = files['OEBPS/style.css'] ?? '';
    expect(css).not.toContain('--bt-fs-');
    expect(css).not.toContain('bt-page-gutter');
  });
});
