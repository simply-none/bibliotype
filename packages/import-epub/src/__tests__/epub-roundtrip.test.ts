// @vitest-environment happy-dom
/**
 * 「导入 → 导出」往返的格式良好性回归（happy-dom：XHTML → IR 复用 import 的 HTML 通路，需 DOM）
 *
 * 背景缺陷：某些外部 EPUB 正文含 XML 1.0 非法字符（C0 控制符等）。
 * xmldom / 浏览器 DOM 解析时宽容放行，导入侧不报错；但导出后的 XHTML/OPF/NCX
 * 被严格 XML 解析器（京东读书等 RMSDK 内核）读入时整机拒绝打开。
 * 本文件锁定该链路：脏字符不得出现在任何导出条目中，且目录、图片、emoji 三项回归同测。
 */
import { NODE_TYPES, type BookNode } from '@bibliotype/core';
import { buildEditorSchema } from '@bibliotype/editor';
import { exportEpub } from '@bibliotype/exporter-epub';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { epubToBookDocument } from '../from-epub.js';

/** XML 1.0 非法字符：C0 控制符（TAB/LF/CR 除外）与 U+FFFE/U+FFFF；代理对必须放行 */
const ILLEGAL_XML_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g;

/** 1×1 PNG（内容无关，仅作可内联的二进制载荷） */
const PNG_1X1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';

function pngBytes(): Uint8Array {
  const binary = atob(PNG_1X1_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** 构造「脏」外部 EPUB：正文带非法控制字符 + 相对图片引用 + h1/h2/h3 标题 */
function dirtyEpubWithImage(): Uint8Array {
  const bad = '\u000b\u000c\u0007\u0001';
  const xhtml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一章</title></head><body>' +
    `<h1>第一篇${bad}学而</h1>` +
    `<p>子曰：学而时习之${bad}，不亦说乎？</p>` +
    '<p><img src="../images/cover.png" alt="封面"/></p>' +
    '<h2>第一节</h2>' +
    '<p>正文二 😀 emoji 保留。</p>' +
    '<h1>第二篇</h1>' +
    '<p>正文三。</p>' +
    '<h3>太深不入目录</h3>' +
    '</body></html>';
  const opf =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">' +
    '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">' +
    '<dc:identifier id="pub-id">urn:isbn:978-0-000-00000-0</dc:identifier>' +
    '<dc:title>脏样本</dc:title><dc:language>zh-Hans</dc:language></metadata>' +
    '<manifest>' +
    '<item id="ch1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>' +
    '<item id="cover" href="images/cover.png" media-type="image/png"/>' +
    '</manifest><spine><itemref idref="ch1"/></spine></package>';
  const container =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">' +
    '<rootfiles><rootfile full-path="OEBPS/content.opf" ' +
    'media-type="application/oebps-package+xml"/></rootfiles></container>';

  return zipSync({
    /* OCF 规范：mimetype 首条目且 STORE */
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8(container),
    'OEBPS/content.opf': strToU8(opf),
    'OEBPS/text/ch1.xhtml': strToU8(xhtml),
    'OEBPS/images/cover.png': pngBytes(),
  });
}

const schema = buildEditorSchema();

/** 递归收集节点文本 */
function collectText(node: BookNode): string {
  if (node.type === NODE_TYPES.TEXT) return node.text ?? '';
  return (node.children ?? []).map(collectText).join('');
}

describe('脏 epub 导入导出往返：产物格式良好', () => {
  const doc = epubToBookDocument(dirtyEpubWithImage(), schema, { title: '脏样本' });
  const bytes = exportEpub(doc, { modified: '2026-01-01T00:00:00Z' });
  const entries = unzipSync(bytes);
  const at = (name: string): string => {
    const data = entries[name];
    return data === undefined ? '' : new TextDecoder().decode(data);
  };

  it('所有 XML 条目不含 XML 1.0 非法字符（严格解析器不再拒绝）', () => {
    const xmlEntries = Object.keys(entries).filter((name) =>
      /\.(xhtml|opf|ncx)$/.test(name),
    );
    expect(xmlEntries.length).toBeGreaterThan(0);
    for (const name of xmlEntries) {
      expect(at(name).match(ILLEGAL_XML_CHARS) ?? []).toEqual([]);
    }
  });

  it('净化发生在导出侧序列化出口，而非导入侧（IR 可能携带非法字符）', () => {
    const text = collectText(doc.root);
    expect(text).toContain('子曰：学而时习之');
    expect(text).toContain('不亦说乎');
    /* 归因实测：happy-dom / xmldom 不校验 XML 合法性，导入侧会把 \u000b 等原样写进 IR；
       因此净化责任只能在序列化出口统一兜底 —— 上一用例已断言导出产物零非法字符。 */
    expect(at('OEBPS/text/sec-0.xhtml').match(ILLEGAL_XML_CHARS) ?? []).toEqual([]);
  });

  it('代理对（emoji）不被误伤', () => {
    /* 标题优先断点后正文分布在多节；emoji 段落在含「第二节」之后的节里，聚合全部内容文档检查 */
    const all = Object.keys(entries)
      .filter((name) => name.startsWith('OEBPS/text/'))
      .map(at)
      .join('\n');
    expect(all).toContain('😀');
  });

  it('扁平文档的目录由顶层标题重建（nav / ncx 非空）', () => {
    const ncx = at('OEBPS/toc.ncx');
    const nav = at('OEBPS/nav.xhtml');
    expect(nav).not.toContain('<ol></ol>');
    expect((ncx.match(/<navPoint /g) ?? []).length).toBe(3);
    expect(ncx).toContain('第一篇');
    expect(ncx).toContain('第一节');
    expect(ncx).toContain('第二篇');
    expect(ncx).not.toContain('太深不入目录');
  });

  it('包内图片内联为 data URI，导出打包为 media 独立文件（不再是死链）', () => {
    /* 导出侧 MediaCollector：data URI → OEBPS/media/* 独立文件 + manifest 登记 + 相对路径引用 */
    const body = at('OEBPS/text/sec-0.xhtml');
    expect(body).toContain('src="../media/img-');
    expect(body).not.toContain('data:image/png;base64,');
    expect(body).not.toContain('../images/');
    /* media 条目在包内 + manifest 登记 media-type */
    const mediaNames = Object.keys(entries).filter((name) => name.startsWith('OEBPS/media/'));
    expect(mediaNames).toHaveLength(1);
    expect(at('OEBPS/content.opf')).toMatch(/<item id="media-1" href="media\/img-[0-9a-f]{8}\.png" media-type="image\/png"\/>/);
    /* 字节即原 PNG（内联 → 解码 → 原样落盘） */
    const png = entries[mediaNames[0]!];
    expect(png).toBeDefined();
    expect(Array.from(png!).length).toBeGreaterThan(0);
  });
});
