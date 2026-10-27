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
import type { EpubImportReport } from '../toc-types.js';
import { strToU8, zipSync } from 'fflate';
import { buildEpub, countClass } from './fixtures.js';

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

/** 收集导入报告（不传回调时不影响既有行为） */
function reportOf(bytes: Uint8Array): EpubImportReport {
  let report: EpubImportReport | undefined;
  epubToHtml(bytes, { inlineImages: false, onReport: (value) => { report = value; } });
  if (report === undefined) throw new Error('onReport 未被调用');
  return report;
}

describe('epubToHtml 目录层级重建（nav.xhtml）', () => {
  it('仅 nav.xhtml 的三级目录 → bt-volume > bt-chapter > bt-section 嵌套', () => {
    const bytes = buildEpub({
      docs: {
        'text/v1.xhtml':
          '<h2 id="v1">第一卷</h2>' +
          '<h3 id="ch1">第一章</h3><p>第一章正文</p>' +
          '<h4 id="s1">第一节</h4><p>第一节正文</p>',
      },
      navItems:
        '<li><a href="text/v1.xhtml#v1">第一卷</a><ol>' +
        '<li><a href="text/v1.xhtml#ch1">第一章</a><ol>' +
        '<li><a href="text/v1.xhtml#s1">第一节</a></li>' +
        '</ol></li></ol></li>',
    });

    const html = epubToHtml(bytes, { inlineImages: false });
    expect(countClass(html, 'bt-volume')).toBe(1);
    expect(countClass(html, 'bt-chapter')).toBe(1);
    expect(countClass(html, 'bt-section')).toBe(1);
    /* 真嵌套：卷在外、章在中、节在内 */
    expect(html).toMatch(/class="bt-volume"[\s\S]*class="bt-chapter"[\s\S]*class="bt-section"/);

    /* 目录标题逐条落到容器上（data-title 供 IR 回收标题） */
    expect(html).toContain('data-title="第一卷"');
    expect(html).toContain('data-title="第一章"');
    expect(html).toContain('data-title="第一节"');

    /* 正文归属顺序：章标题 → 章正文 → 节标题 → 节正文 */
    const order = ['data-title="第一章"', '第一章正文', 'data-title="第一节"', '第一节正文'].map(
      (token) => html.indexOf(token),
    );
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('单个 XHTML 含三章（#c1/#c2/#c3）→ 三个 chapter，各段归属正确且不丢文', () => {
    const bytes = buildEpub({
      docs: {
        'text/all.xhtml':
          '<h2 id="c1">第一章</h2><p>甲段</p>' +
          '<h2 id="c2">第二章</h2><p>乙段</p>' +
          '<h2 id="c3">第三章</h2><p>丙段</p>',
      },
      navItems:
        '<li><a href="text/all.xhtml#c1">第一章</a></li>' +
        '<li><a href="text/all.xhtml#c2">第二章</a></li>' +
        '<li><a href="text/all.xhtml#c3">第三章</a></li>',
    });

    const html = epubToHtml(bytes, { inlineImages: false });
    expect(countClass(html, 'bt-chapter')).toBe(3);
    const order = [
      'data-title="第一章"',
      '甲段',
      'data-title="第二章"',
      '乙段',
      'data-title="第三章"',
      '丙段',
    ].map((token) => html.indexOf(token));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('toc.ncx 位于子目录时按 ncx 自身目录解析 src（标题不退化为「第N节」）', () => {
    const bytes = buildEpub({
      docs: { 'nav/ch1.xhtml': '<h2 id="c1">第一章</h2><p>正文甲</p>' },
      ncxPath: 'nav/toc.ncx',
      ncxPoints:
        '<navPoint id="n1" playOrder="1"><navLabel><text>第一章</text></navLabel>' +
        '<content src="ch1.xhtml#c1"/></navPoint>',
    });

    const html = epubToHtml(bytes, { inlineImages: false });
    expect(html).toContain('data-title="第一章"');
    expect(html).toContain('正文甲');
    expect(reportOf(bytes).tocSource).toBe('ncx');
  });

  it('spine 顺序与目录相反 → 正文按目录顺序输出', () => {
    const bytes = buildEpub({
      docs: {
        'text/a.xhtml': '<h2 id="a">甲章</h2><p>甲段</p>',
        'text/b.xhtml': '<h2 id="b">乙章</h2><p>乙段</p>',
      },
      /* spine 写成反序（旧实现照抄 spine 顺序，导致正文与目录乱序） */
      spine: ['text/b.xhtml', 'text/a.xhtml'],
      navItems: '<li><a href="text/a.xhtml#a">甲章</a></li><li><a href="text/b.xhtml#b">乙章</a></li>',
    });

    const html = epubToHtml(bytes, { inlineImages: false });
    expect(html.indexOf('data-title="甲章"')).toBeLessThan(html.indexOf('data-title="乙章"'));
    expect(html.indexOf('甲段')).toBeLessThan(html.indexOf('乙段'));
  });

  it('OPF href 大小写与 zip 条目不一致 → 正文不丢，报告无缺失文件', () => {
    const bytes = buildEpub({
      docs: { 'text/ch1.xhtml': '<h2 id="c1">第一章</h2><p>正文甲</p>' },
      hrefCase: 'upper',
      navItems: '<li><a href="TEXT/CH1.XHTML#c1">第一章</a></li>',
    });

    const html = epubToHtml(bytes, { inlineImages: false });
    expect(html).toContain('正文甲');
    expect(html).toContain('data-title="第一章"');

    const report = reportOf(bytes);
    expect(report.missingFiles).toEqual([]);
    expect(report.tocEntries).toBe(1);
    expect(report.unlocatedAnchors).toEqual([]);
  });

  it('无目录时走扁平路径（不产出结构容器），并回报 tocSource: none', () => {
    const bytes = buildEpub({
      docs: { 'text/ch1.xhtml': '<h1>第一章</h1><p>正文甲</p>' },
    });

    const html = epubToHtml(bytes, { inlineImages: false });
    expect(html).toContain('<h1');
    expect(html).toContain('正文甲');
    expect(countClass(html, 'bt-chapter')).toBe(0);
    expect(countClass(html, 'bt-volume')).toBe(0);
    expect(reportOf(bytes).tocSource).toBe('none');
  });
});
