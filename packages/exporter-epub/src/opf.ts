/**
 * OPF 包文档生成（EPUB 3）
 *
 * 输出 content.opf：package / metadata（DC 元数据 + dcterms:modified）/
 * manifest / spine。所有值经 XML 转义。
 */
import type { BookMetadata } from '@bibliotype/core';
import { escapeHtml } from '@bibliotype/layout/html';

/** manifest 条目 */
export interface OpfManifestItem {
  id: string;
  href: string;
  mediaType: string;
  /** EPUB 属性（如 nav 文档的 "nav"） */
  properties?: string;
}

/** OPF 生成输入 */
export interface OpfInput {
  /** 唯一标识符（dc:identifier） */
  identifier: string;
  metadata: BookMetadata;
  /** 语言标记（BCP 47） */
  language: string;
  /** dcterms:modified（ISO 8601） */
  modified: string;
  manifest: readonly OpfManifestItem[];
  /** spine 顺序（manifest item id） */
  spine: readonly string[];
}

/** 生成 OPF 包文档 */
export function buildOpf(input: OpfInput): string {
  const { metadata } = input;
  const lang = escapeHtml(input.language);

  /* metadata：DC 元素 + 修改时间 */
  const metaLines: string[] = [
    `    <dc:identifier id="pub-id">${escapeHtml(input.identifier)}</dc:identifier>`,
    `    <dc:title>${escapeHtml(metadata.title)}</dc:title>`,
  ];
  if (metadata.subtitle !== undefined && metadata.subtitle !== '') {
    metaLines.push(`    <dc:title>${escapeHtml(metadata.subtitle)}</dc:title>`);
  }
  metaLines.push(`    <dc:language>${lang}</dc:language>`);
  for (const contributor of metadata.contributors ?? []) {
    metaLines.push(`    <dc:creator>${escapeHtml(contributor.name)}</dc:creator>`);
  }
  const publisher = metadata.publication?.publisher;
  if (publisher !== undefined && publisher !== '') {
    metaLines.push(`    <dc:publisher>${escapeHtml(publisher)}</dc:publisher>`);
  }
  metaLines.push(`    <meta property="dcterms:modified">${escapeHtml(input.modified)}</meta>`);

  /* manifest */
  const manifestLines = input.manifest.map((item) => {
    const properties =
      item.properties !== undefined ? ` properties="${escapeHtml(item.properties)}"` : '';
    return (
      `    <item id="${escapeHtml(item.id)}" href="${escapeHtml(item.href)}"` +
      ` media-type="${escapeHtml(item.mediaType)}"${properties}/>`
    );
  });

  /* spine */
  const spineLines = input.spine.map((id) => `    <itemref idref="${escapeHtml(id)}"/>`);

  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id" xml:lang="${lang}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
${metaLines.join('\n')}
  </metadata>
  <manifest>
${manifestLines.join('\n')}
  </manifest>
  <spine>
${spineLines.join('\n')}
  </spine>
</package>
`;
}
