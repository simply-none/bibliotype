/**
 * DOCX 导出测试
 *
 * 验收口径（P4-10）：
 * - 含标题 / 脚注 / 表格 / 图片的样例书导出后，mammoth 回读的**文本与表格结构一致**；
 * - 标题层级、脚注可跳（mammoth 解析出 footnote 引用与注文）；
 * - 不可等价表达的语义（外链图、公式、注音、悬空注引……）不抛错，转问题码。
 */
import { describe, expect, it } from 'vitest';
import mammoth from 'mammoth';
import {
  MARK_TYPES,
  NODE_TYPES,
  type BookDocument,
  type BookMark,
  type BookNode,
  type NamedStyleSet,
} from '@bibliotype/core';
import { buildDocxDocument, exportDocx } from '../document.js';
import { buildBlocks } from '../blocks.js';
import { createExportContext } from '../context.js';
import { decodeImageSrc, displaySize, sniffImageType } from '../images.js';
import { resolveOptions, DEFAULT_PAGE_SIZE_MM } from '../options.js';
import { buildDocxStyles, declarationsToProps, namedWordStyleId, toWordStyleId } from '../styles.js';

/** 1×1 透明 PNG（67 字节） */
const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const PNG_DATA_URI = `data:image/png;base64,${PNG_1PX}`;

/** 文本节点 */
function text(value: string, ...marks: BookMark[]): BookNode {
  return { type: NODE_TYPES.TEXT, text: value, ...(marks.length > 0 ? { marks } : {}) };
}

/** 段落节点 */
function paragraph(...children: BookNode[]): BookNode {
  return { type: NODE_TYPES.PARAGRAPH, children };
}

/** 带脚注引用的样例书稿 */
function sampleBook(): BookDocument {
  return {
    schemaVersion: '0.3.0',
    metadata: {
      title: '测试书稿',
      subtitle: 'DOCX 导出验收样例',
      contributors: [{ name: '张三' }],
    },
    root: {
      type: NODE_TYPES.BOOK,
      children: [
        {
          type: NODE_TYPES.CHAPTER,
          id: 'ch-1',
          children: [
            {
              type: NODE_TYPES.HEADING,
              id: 'h-1',
              attrs: { level: 1 },
              children: [text('第一章 导言')],
            },
            paragraph(
              text('子曰：'),
              text('学而时习之', { type: MARK_TYPES.STRONG }),
              text('。', {
                type: MARK_TYPES.NOTE_REF,
                attrs: { targetId: 'note-footnote-1', refId: 'ref-footnote-1' },
              }),
            ),
            {
              type: NODE_TYPES.TABLE,
              id: 't-1',
              children: [
                {
                  type: NODE_TYPES.TABLE_ROW,
                  attrs: { header: true },
                  children: [
                    {
                      type: NODE_TYPES.TABLE_CELL,
                      children: [paragraph(text('项目'))],
                    },
                    {
                      type: NODE_TYPES.TABLE_CELL,
                      children: [paragraph(text('说明'))],
                    },
                  ],
                },
                {
                  type: NODE_TYPES.TABLE_ROW,
                  children: [
                    {
                      type: NODE_TYPES.TABLE_CELL,
                      attrs: { colspan: 2 },
                      children: [paragraph(text('跨两列'))],
                    },
                  ],
                },
              ],
            },
            { type: NODE_TYPES.IMAGE, attrs: { src: PNG_DATA_URI, alt: '示意图' } },
            { type: NODE_TYPES.CAPTION, children: [text('图 1 示意图')] },
            {
              type: NODE_TYPES.FOOTNOTE,
              id: 'note-footnote-1',
              attrs: { marker: '1', refId: 'ref-footnote-1' },
              children: [paragraph(text('注文内容'))],
            },
          ],
        },
        {
          type: NODE_TYPES.CHAPTER,
          id: 'ch-2',
          children: [
            {
              type: NODE_TYPES.HEADING,
              attrs: { level: 2 },
              children: [text('第一节 小标题')],
            },
            paragraph(text('第二章正文。')),
          ],
        },
      ],
    },
  };
}

/**
 * mammoth 回读 HTML
 *
 * mammoth 缺省样式表不映射下划线（findHtmlPathForRunProperty('underline') 无默认标签），
 * 故测试补一条 `u => u`，使 marked 视图自带的下划线能被回读验证。
 */
async function readBack(book: BookDocument, options = {}): Promise<string> {
  const bytes = await exportDocx(book, options);
  const result = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) }, { styleMap: ['u => u'] });
  return result.value;
}

describe('exportDocx：样例书稿往返', () => {
  it('产出合法的 ZIP 容器（PK 头）', async () => {
    const bytes = await exportDocx(sampleBook());
    expect(bytes.byteLength).toBeGreaterThan(1000);
    expect([...bytes.slice(0, 2)]).toEqual([0x50, 0x4b]);
  });

  it('标题层级、正文与粗体往返正确', async () => {
    const html = await readBack(sampleBook());
    expect(html).toContain('<h1>第一章 导言</h1>');
    expect(html).toContain('<h2>第一节 小标题</h2>');
    expect(html).toContain('子曰：');
    expect(html).toContain('<strong>学而时习之</strong>');
    expect(html).toContain('第二章正文。');
  });

  it('脚注引用与注文可被 mammoth 解析（可跳转）', async () => {
    const html = await readBack(sampleBook());
    expect(html).toMatch(/<sup><a href="#footnote-1" id="footnote-ref-1">\[1\]<\/a><\/sup>/);
    expect(html).toMatch(/<li id="footnote-1">[\s\S]*注文内容[\s\S]*<\/li>/);
  });

  it('表格表头与 colspan 结构一致', async () => {
    const html = await readBack(sampleBook());
    expect(html).toContain('<table>');
    expect(html).toMatch(/<th><p>项目<\/p><\/th>/);
    expect(html).toMatch(/<td[^>]*colspan="2"[^>]*>[\s\S]*跨两列/);
  });

  it('图片以 base64 嵌入文档（word/media）', async () => {
    const html = await readBack(sampleBook());
    expect(html).toMatch(/<img alt="示意图" src="data:image\/png;base64,/);
  });

  it('样例书稿无导出问题', async () => {
    const { problems } = buildDocxDocument(sampleBook());
    expect(problems).toEqual([]);
  });
});

describe('exportDocx：降级与问题码（负例）', () => {
  /** 覆盖全部降级路径的样例 */
  function degradedBook(): BookDocument {
    return {
      schemaVersion: '0.3.0',
      metadata: { title: '降级样例' },
      root: {
        type: NODE_TYPES.BOOK,
        children: [
          paragraph(
            text('外链图后文', {
              type: MARK_TYPES.RUBY,
              attrs: { text: 'wài liàn' },
            }),
            text('，', {
              type: MARK_TYPES.NOTE_REF,
              attrs: { targetId: 'missing-note' },
            }),
          ),
          { type: NODE_TYPES.IMAGE, attrs: { src: 'https://example.com/a.png', alt: '外链图' } },
          { type: NODE_TYPES.IMAGE, attrs: { src: 'images/local.png', alt: '本地图' } },
          { type: NODE_TYPES.IMAGE, attrs: { src: 'data:image/svg+xml;base64,PHN2Zy8+', alt: '矢量图' } },
          { type: NODE_TYPES.MATH_BLOCK, attrs: { tex: 'a^2 + b^2 = c^2' } },
          { type: 'future-widget', children: [text('未来节点内容')] },
          {
            type: NODE_TYPES.FOOTNOTE,
            id: 'note-unused',
            attrs: { marker: '2' },
            children: [paragraph(text('无人引用的注文'))],
          },
        ],
      },
    };
  }

  it('逐类问题码齐备且不抛错', async () => {
    const { problems } = buildDocxDocument(degradedBook());
    const codes = problems.map((problem) => problem.code);
    expect(codes).toContain('external-src');
    expect(codes).toContain('relative-src');
    expect(codes).toContain('unsupported-image');
    expect(codes).toContain('math-degraded');
    expect(codes).toContain('unsupported-node');
    expect(codes).toContain('note-orphan');
    expect(codes).toContain('note-unreferenced');
    expect(codes).toContain('ruby-degraded');
  });

  it('降级后仍保留文字内容', async () => {
    const html = await readBack(degradedBook());
    expect(html).toContain('外链图后文（wài liàn）');
    expect(html).toContain('外链图');
    expect(html).toContain('a^2 + b^2 = c^2');
    expect(html).toContain('未来节点内容');
    expect(html).toContain('无人引用的注文');
  });

  it('onProblem 回调与返回清单同源', () => {
    const seen: string[] = [];
    buildDocxDocument(degradedBook(), { onProblem: (problem) => seen.push(problem.code) });
    const { problems } = buildDocxDocument(degradedBook());
    expect(seen).toEqual(problems.map((problem) => problem.code));
  });

  it('overage：超过字节上限的图片按 oversize-src 记录', () => {
    const { problems } = buildDocxDocument(
      {
        schemaVersion: '0.3.0',
        metadata: { title: '超限图' },
        root: {
          type: NODE_TYPES.BOOK,
          children: [{ type: NODE_TYPES.IMAGE, attrs: { src: PNG_DATA_URI } }],
        },
      },
      { maxImageBytes: 8 },
    );
    expect(problems.map((problem) => problem.code)).toContain('oversize-src');
  });
});

describe('修订视图', () => {
  /** 含插入 / 删除的样例 */
  function revisionBook(): BookDocument {
    return {
      schemaVersion: '0.3.0',
      metadata: { title: '修订样例' },
      root: {
        type: NODE_TYPES.BOOK,
        children: [
          paragraph(
            text('保留'),
            text('插入', { type: MARK_TYPES.INSERTION }),
            text('删除', { type: MARK_TYPES.DELETION }),
          ),
        ],
      },
    };
  }

  it('final：删除内容不输出', async () => {
    const html = await readBack(revisionBook());
    expect(html).toContain('保留');
    expect(html).toContain('插入');
    expect(html).not.toContain('删除');
  });

  it('original：插入内容不输出', async () => {
    const html = await readBack(revisionBook(), { revisionView: 'original' });
    expect(html).toContain('删除');
    expect(html).not.toContain('插入');
  });

  it('marked：两者保留并带删除线 / 下划线', async () => {
    const html = await readBack(revisionBook(), { revisionView: 'marked' });
    expect(html).toMatch(/<s>删除<\/s>/);
    expect(html).toMatch(/<u>插入<\/u>/);
  });
});

describe('样式映射', () => {
  const styleSet: NamedStyleSet = {
    version: 1,
    styles: [
      {
        id: 'ns-quote-kai',
        name: '引文-楷体',
        featureId: 'block.quote',
        declarations: {
          'font-family': '"楷体", serif',
          'font-size': '14pt',
          'text-indent': '2em',
          'line-height': '1.5',
          'text-align': 'center',
          color: '#336699',
        },
      },
    ],
  };

  it('声明 → Word 属性：字体、字号、缩进、行高、对齐、颜色', () => {
    const { paragraph, run } = declarationsToProps(styleSet.styles[0]!.declarations);
    expect(run.font).toBe('楷体');
    expect(run.size).toBe(28);
    expect(run.color).toBe('336699');
    expect(paragraph.indent?.firstLine).toBe(560);
    expect(paragraph.spacing?.line).toBe(360);
    expect(paragraph.spacing?.lineRule).toBe('auto');
    expect(paragraph.alignment).toBe('center');
  });

  it('styleId → 命名样式：查得到才映射，查不到沿用途中样式', () => {
    const node: BookNode = {
      type: NODE_TYPES.PARAGRAPH,
      attrs: { styleId: 'ns-quote-kai' },
      children: [text('引文')],
    };
    expect(namedWordStyleId(node, styleSet)).toBe('ns-quote-kai');
    expect(namedWordStyleId(node, undefined)).toBeUndefined();

    const unknown: BookNode = { ...node, attrs: { styleId: 'ns-missing' } };
    expect(namedWordStyleId(unknown, styleSet)).toBeUndefined();
  });

  it('命名样式进入文档样式表（段落样式 id 与名称）', () => {
    const styles = buildDocxStyles(resolveOptions({ namedStyles: styleSet }));
    const ids = (styles.paragraphStyles ?? []).map((style) => style.id);
    expect(ids).toContain('ns-quote-kai');
    expect(ids).toContain('BibliotypeBody');
  });

  it('styleId 清洗：中文替换、数字前缀、空值兜底', () => {
    expect(toWordStyleId('ns-a b')).toBe('ns-a-b');
    expect(toWordStyleId('1abc')).toBe('S1abc');
    expect(toWordStyleId('  ')).toBe('BibliotypeStyle');
  });

  it('标题默认样式使用标题字体与黑色', () => {
    const styles = buildDocxStyles(resolveOptions({ headingFontFamily: '黑体' }));
    const heading1 = (styles.default as Record<string, { run?: { font?: string; color?: string } }>)['heading1'];
    expect(heading1?.run?.font).toBe('黑体');
    expect(heading1?.run?.color).toBe('000000');
  });

  it('页面缺省 A4、四边 25mm 与首行缩进 2 字符', () => {
    const resolved = resolveOptions();
    expect(resolved.pageSize).toEqual(DEFAULT_PAGE_SIZE_MM);
    expect(resolved.margins).toEqual({ top: 25, right: 25, bottom: 25, left: 25 });
    expect(resolved.firstLineIndentChars).toBe(2);
  });
});

describe('图片解码与尺寸', () => {
  it('PNG data URI：嗅探格式与像素尺寸', () => {
    const decoded = decodeImageSrc(PNG_DATA_URI, 1024 * 1024);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.image.type).toBe('png');
    expect(decoded.image.width).toBe(1);
    expect(decoded.image.height).toBe(1);
  });

  it('小图不放大：1px 图在 150mm 版心内保持 1px', () => {
    const decoded = decodeImageSrc(PNG_DATA_URI, 1024 * 1024);
    if (!decoded.ok) throw new Error('PNG 解码失败');
    expect(displaySize(decoded.image, 150)).toEqual({ width: 1, height: 1 });
  });

  it('非 data URI / SVG / 超限分别给出对应问题码', () => {
    expect(decodeImageSrc('https://example.com/a.png', 1024)).toMatchObject({ ok: false, code: 'external-src' });
    expect(decodeImageSrc('images/a.png', 1024)).toMatchObject({ ok: false, code: 'relative-src' });
    expect(decodeImageSrc('data:image/svg+xml;base64,PHN2Zy8+', 1024)).toMatchObject({
      ok: false,
      code: 'unsupported-image',
    });
    expect(decodeImageSrc(PNG_DATA_URI, 16)).toMatchObject({ ok: false, code: 'oversize-src' });
  });

  it('GIF / BMP 魔术字节识别', () => {
    expect(sniffImageType(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe('gif');
    expect(sniffImageType(new Uint8Array([0x42, 0x4d, 0x00, 0x00]))).toBe('bmp');
    expect(sniffImageType(new Uint8Array([0x00, 0x01]))).toBeUndefined();
  });
});

describe('buildBlocks：边界结构', () => {
  it('空文档不抛错（仍产出可打包的文档）', async () => {
    const book: BookDocument = {
      schemaVersion: '0.3.0',
      metadata: { title: '空文档' },
      root: { type: NODE_TYPES.BOOK, children: [] },
    };
    const bytes = await exportDocx(book);
    expect(bytes.byteLength).toBeGreaterThan(0);
  });

  it('条件容器：缺省保留、上下文为假时裁剪', () => {
    const book: BookDocument = {
      schemaVersion: '0.3.0',
      metadata: { title: '条件' },
      root: {
        type: NODE_TYPES.BOOK,
        children: [
          {
            type: NODE_TYPES.CONDITION,
            attrs: { when: 'edition == "paper"' },
            children: [paragraph(text('纸书专用'))],
          },
        ],
      },
    };
    const keep = buildBlocksFor(book, resolveOptions());
    expect(JSON.stringify(keep)).toContain('纸书专用');

    const drop = buildBlocksFor(book, resolveOptions({ conditionContext: { edition: 'web' } }));
    expect(JSON.stringify(drop)).not.toContain('纸书专用');
  });
});

/** 直接对根节点跑块级转换（测试用） */
function buildBlocksFor(book: BookDocument, options: ReturnType<typeof resolveOptions>) {
  const ctx = createExportContext(options, [], new Set<string>());
  return buildBlocks(book.root, ctx);
}
