/**
 * epubToHtml 测试（默认 Node 环境：验证「解包 + XML 结构读取」浏览器/Node 同构，不触碰 DOM）
 *
 * 采用「导出 ↔ 导入往返」：以 @bibliotype/import 的 markdownToBookDocument 造 BookDocument，
 * 经 @bibliotype/exporter-epub 产出真实 .epub 字节，再解回正文 HTML 片段。
 * （exporter-epub 仅作测试 devDependency 用作夹具生成器，非运行时依赖。）
 */
import { buildEditorSchema } from '@bibliotype/editor';
import { exportEpub } from '@bibliotype/exporter-epub';
import { markdownToBookDocument } from '@bibliotype/import';
import { describe, expect, it } from 'vitest';
import { epubToHtml } from '../epub-package.js';
import { strToU8, zipSync } from 'fflate';

const schema = buildEditorSchema();

/** Markdown → BookDocument → exportEpub 字节（往返夹具） */
function epubFromMarkdown(md: string, title: string): Uint8Array {
  const doc = markdownToBookDocument(md, schema, { title });
  return exportEpub(doc);
}

describe('epubToHtml（Node 同构，无 DOM）', () => {
  it('解包 + OPF spine → 正文 HTML 片段（标题 / 段落 / 强调回收）', () => {
    const bytes = epubFromMarkdown(
      '# 学而\n\n子曰：**学而时习之**，不亦说乎？\n\n居其所而众星共之。',
      '论语',
    );
    const html = epubToHtml(bytes);
    expect(html).toMatch(/<h[1-6]/);
    expect(html).toContain('学而');
    expect(html).toContain('子曰');
    expect(html).toContain('居其所而众星共之');
  });

  it('多段正文全部回收', () => {
    const bytes = epubFromMarkdown('# 八佾\n\n第一段内容。\n\n第二段内容。', '论语');
    const html = epubToHtml(bytes);
    expect(html).toContain('第一段内容');
    expect(html).toContain('第二段内容');
  });

  it('空字节 → 抛出指向明确的 RangeError', () => {
    expect(() => epubToHtml(new Uint8Array([]))).toThrow(/epub 数据为空/);
  });

  it('非 zip 垃圾字节 → 抛出解包失败 RangeError', () => {
    expect(() => epubToHtml(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(/epub 解包失败/);
  });
});

/**
 * 构造带图片的外部 EPUB（非本库导出产物，模拟真实 epub 的目录布局：
 * OEBPS/content.opf + OEBPS/text/*.xhtml + OEBPS/images/*.png + 相对 src 引用）
 */
function fixtureEpubWithImage(imageBytes: Uint8Array): Uint8Array {
  const coverPng = imageBytes;
  return zipSync({
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8(
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
          '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">' +
          '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>' +
          '</rootfiles></container>',
      ),
    'OEBPS/content.opf': strToU8(
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
          '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">' +
          '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">' +
          '<dc:identifier id="pub-id">urn:isbn:978-0-000-00000-0</dc:identifier>' +
          '<dc:title>带图样本</dc:title><dc:language>zh-Hans</dc:language></metadata>' +
          '<manifest>' +
          '<item id="ch1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>' +
          '<item id="cover" href="images/cover.png" media-type="image/png"/>' +
          '</manifest><spine><itemref idref="ch1"/></spine></package>',
      ),
    'OEBPS/text/ch1.xhtml': strToU8(
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
          '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一章</title></head><body>' +
          '<h1>第一章</h1><img src="../images/cover.png" alt="封面"/>' +
          '<img src="https://example.com/x.png" alt="外链"/><p>正文。</p>' +
          '</body></html>',
      ),
    'OEBPS/images/cover.png': coverPng,
  });
}

/** 1×1 PNG 的最小合法字节序列（图片内容无关，仅作为可内联的二进制载荷） */
const PNG_1X1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';

/** base64 → 字节（Node / 浏览器双端 atob，避免引入 Buffer） */
function pngBytes(): Uint8Array {
  const binary = atob(PNG_1X1_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

describe('epubToHtml 图片内联（default true）', () => {
  it('包内图片改写为 data URI，媒体类型取自 OPF manifest', () => {
    const html = epubToHtml(fixtureEpubWithImage(pngBytes()));
    expect(html).toContain('data:image/png;base64,');
    expect(html).toContain(PNG_1X1_BASE64);
    /* 相对引用已消失（否则导出后为死链） */
    expect(html).not.toContain('../images/cover.png');
  });

  it('外链图片不内联（保留 http 引用）', () => {
    const html = epubToHtml(fixtureEpubWithImage(pngBytes()));
    expect(html).toContain('https://example.com/x.png');
  });

  it('inlineImages: false → 保持原相对 src', () => {
    const html = epubToHtml(fixtureEpubWithImage(pngBytes()), { inlineImages: false });
    expect(html).toContain('../images/cover.png');
    expect(html).not.toContain('data:image/png;base64,');
  });

  it('正文结构不受内联影响（标题 / 段落照常回收）', () => {
    const html = epubToHtml(fixtureEpubWithImage(pngBytes()));
    /* body 子元素由 XHTML 文档抽出，序列化时保留命名空间，属既有行为 */
    expect(html).toContain('<h1 xmlns="http://www.w3.org/1999/xhtml">第一章</h1>');
    expect(html).toContain('<p xmlns="http://www.w3.org/1999/xhtml">正文。</p>');
  });
});
