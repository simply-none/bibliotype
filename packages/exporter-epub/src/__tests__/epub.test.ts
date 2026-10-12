/**
 * EPUB 3 导出测试
 *
 * 覆盖：OCF 打包结构（mimetype 首条目 STORE）、OPF 元数据与 spine、
 * 章节文件切分、nav 目录与自动锚点、XHTML 转义、古籍布局场景、
 * 导出确定性与空书边界，以及标识符工具。
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THEME,
  FONT_TOKENS,
  NODE_TYPES,
  createEmptyDocument,
  type BookDocument,
} from '@bibliotype/core';
import { CLASSICAL_LAYOUT_OPTIONS } from '@bibliotype/layout';
import { strFromU8, unzipSync } from 'fflate';
import { EPUB_MIMETYPE, buildContainerXml, exportEpub } from '../epub.js';
import { buildDefaultIdentifier, fnv1a, resolveIdentifier } from '../identifier.js';
import { planDocument } from '../sections.js';

/** 固定修改时间（导出确定性断言基线） */
const FIXED_MODIFIED = '2026-01-02T00:00:00.000Z';

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
});

describe('OPF 包文档', () => {
  it('输出 DC 元数据、nav 属性与 dcterms:modified', () => {
    const files = readEntries(exportEpub(sampleDoc(), { modified: FIXED_MODIFIED }));
    const opf = files['OEBPS/content.opf'];

    expect(opf).toContain('<package xmlns="http://www.idpf.org/2007/opf" version="3.0"');
    expect(opf).toContain('<dc:identifier id="pub-id">urn:bibliotype:');
    expect(opf).toContain('<dc:title>论语</dc:title>');
    expect(opf).toContain('<dc:title>校注本</dc:title>');
    expect(opf).toContain('<dc:language>zh-Hant</dc:language>');
    expect(opf).toContain('<dc:creator>孔子</dc:creator>');
    expect(opf).toContain('<dc:publisher>中华书局</dc:publisher>');
    expect(opf).toContain(`<meta property="dcterms:modified">${FIXED_MODIFIED}</meta>`);
    expect(opf).toContain('href="nav.xhtml"');
    expect(opf).toContain('properties="nav"');
    expect(opf).toContain('href="style.css" media-type="text/css"');
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

describe('章节切分与 XHTML', () => {
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
  it('直排布局：CSS 直排规则 + 字体令牌 + 插件节点兜底', () => {
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
    expect(css).toContain('writing-mode: vertical-rl;');
    expect(css).toContain('text-combine-upright: digits 4;');
    expect(css).toContain('--bt-writing-mode: vertical-rl;');
    expect(css).toContain('font-family: var(--bt-font-family-classical-body);');

    expect(files['OEBPS/text/sec-0.xhtml']).toContain(
      '<div class="bt-double-note" data-kind="jiaozhu"><p class="bt-paragraph">朱注：习，鸟数飞也。</p></div>',
    );
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

  it('buildDefaultIdentifier：urn 前缀且对同一文档稳定', () => {
    const first = buildDefaultIdentifier(sampleDoc());
    expect(first).toMatch(/^urn:bibliotype:[0-9a-f]{8}$/);
    expect(buildDefaultIdentifier(sampleDoc())).toBe(first);
  });
});
