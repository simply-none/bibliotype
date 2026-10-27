/**
 * epub 测试夹具（zip 内联构造，不落二进制、不依赖网络）
 *
 * 只搭导入侧真正关心的最小结构：
 * `META-INF/container.xml` → `OEBPS/content.opf`（manifest + spine）→
 * 可选的 `nav.xhtml` / `toc.ncx` → 若干 XHTML 正文文档。
 *
 * 用参数而非多份写死字符串，是为了让「目录层级 / 同文件多章 / 大小写不一致 / spine 乱序」
 * 这些差异只体现在几行输入上，断言可以专注于对外行为。
 */
import { strToU8, zipSync } from 'fflate';

/** 夹具输入 */
export interface EpubFixtureInput {
  /** 正文文档：相对 `OEBPS/` 的路径 → `<body>` 内层 HTML */
  docs: Record<string, string>;
  /** `nav.xhtml` 里 `<ol>` 的内层 HTML（提供时生成 nav 文档并在 manifest 声明 `properties="nav"`） */
  navItems?: string;
  /** `toc.ncx` 里 `<navMap>` 的内层 HTML（提供时生成 ncx 并挂到 spine 的 `toc`） */
  ncxPoints?: string;
  /** `toc.ncx` 相对 `OEBPS/` 的路径（默认 `toc.ncx`；用于验证 href 以 ncx 自身目录为基准） */
  ncxPath?: string;
  /** spine 顺序（相对 `OEBPS/` 路径；缺省按 `docs` 的声明顺序） */
  spine?: string[];
  /** manifest 中正文 href 的大小写（`upper` 用于验证 zip 条目查找的容错） */
  hrefCase?: 'asis' | 'upper';
}

const CONTAINER_XML =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">' +
  '<rootfiles><rootfile full-path="OEBPS/content.opf" ' +
  'media-type="application/oebps-package+xml"/></rootfiles></container>';

/**
 * 构造一个最小可导入的 epub
 *
 * @param input 正文文档、目录源与 spine 顺序
 * @returns `.epub` 字节（可直接交给 `epubToHtml` / `epubToBookDocument`）
 * @throws Error spine 引用了 `docs` 之外的路径（夹具自检，避免测试写错却静默通过）
 */
export function buildEpub(input: EpubFixtureInput): Uint8Array {
  const { docs, navItems, ncxPoints, ncxPath = 'toc.ncx', hrefCase = 'asis' } = input;
  const order = input.spine ?? Object.keys(docs);
  const hrefOf = (path: string): string => (hrefCase === 'upper' ? path.toUpperCase() : path);
  const docIndex = new Map(Object.keys(docs).map((path, index) => [path, index]));

  const items = Object.keys(docs).map(
    (path, index) =>
      `<item id="doc${index}" href="${hrefOf(path)}" media-type="application/xhtml+xml"/>`,
  );
  if (navItems !== undefined) {
    items.push('<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>');
  }
  const hasNcx = ncxPoints !== undefined;
  if (hasNcx) {
    items.push(`<item id="ncx" href="${ncxPath}" media-type="application/x-dtbncx+xml"/>`);
  }

  const itemrefs = order.map((path) => {
    const index = docIndex.get(path);
    if (index === undefined) {
      throw new Error(`夹具 spine 引用了未在 docs 中声明的正文文档："${path}"`);
    }
    return `<itemref idref="doc${index}"/>`;
  });

  const files: Record<string, Uint8Array> = {
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(CONTAINER_XML),
    'OEBPS/content.opf': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">' +
        '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">' +
        '<dc:identifier id="pub-id">urn:isbn:978-0-000-00000-0</dc:identifier>' +
        '<dc:title>夹具</dc:title><dc:language>zh-Hans</dc:language></metadata>' +
        `<manifest>${items.join('')}</manifest>` +
        `<spine${hasNcx ? ' toc="ncx"' : ''}>${itemrefs.join('')}</spine></package>`,
    ),
  };

  for (const [path, body] of Object.entries(docs)) {
    files[`OEBPS/${path}`] = strToU8(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>样本</title></head>' +
        `<body>${body}</body></html>`,
    );
  }

  if (navItems !== undefined) {
    /* epub:type 前缀必须声明，否则 xmldom 会把属性名解析成无命名空间的 `type` */
    files['OEBPS/nav.xhtml'] = strToU8(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">' +
        '<head><title>目录</title></head><body><nav epub:type="toc" id="toc">' +
        `<h1>目录</h1><ol>${navItems}</ol></nav></body></html>`,
    );
  }

  if (ncxPoints !== undefined) {
    files[`OEBPS/${ncxPath}`] = strToU8(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">' +
        '<head><meta name="dtb:uid" content="urn:isbn:978-0-000-00000-0"/></head>' +
        `<docTitle><text>夹具</text></docTitle><navMap>${ncxPoints}</navMap></ncx>`,
    );
  }

  return zipSync(files);
}

/** 统计 `html` 里某个 class 出现次数（断言「章节数量」用） */
export function countClass(html: string, className: string): number {
  const pattern = new RegExp(`class="${className}"`, 'g');
  return html.match(pattern)?.length ?? 0;
}
