/**
 * EPUB 3 导出主流程
 *
 * 链路：BookDocument → 章节规划（sections）→ XHTML 序列化（layout/html）
 * → OPF / nav / 样式 → fflate 打包为 EPUB（Uint8Array）。
 *
 * 浏览器与 Node 同构：不依赖 DOM 与文件系统，产物由调用方保存 / 下载。
 * mimetype 按 OCF 规范以首条目、STORE（不压缩）方式写入。
 */
import { DEFAULT_THEME, type BookDocument } from '@bibliotype/core';
import { DEFAULT_LAYOUT_OPTIONS, type LayoutOptions } from '@bibliotype/layout';
import { buildBookCss, serializeNode } from '@bibliotype/layout/html';
import { resolveNodeTitle } from '@bibliotype/reader';
import { strToU8, zipSync, type ZipOptions } from 'fflate';
import { buildDefaultIdentifier, resolveIdentifier } from './identifier.js';
import { buildNavXhtml } from './nav.js';
import { buildOpf, type OpfManifestItem } from './opf.js';
import { buildNavItems, planDocument } from './sections.js';
import { renderXhtmlDocument } from './xhtml.js';

/** EPUB 文件媒体类型（OCF 规范固定值） */
export const EPUB_MIMETYPE = 'application/epub+zip';

/** 导出选项 */
export interface EpubExportOptions {
  /** 布局选项（缺省 DEFAULT_LAYOUT_OPTIONS；古籍可传 CLASSICAL_LAYOUT_OPTIONS） */
  layout?: LayoutOptions;
  /** 主题令牌表（缺省 DEFAULT_THEME；古籍传古典主题覆盖 + 扩展令牌） */
  tokens?: Readonly<Record<string, string | undefined>>;
  /** 正文字体令牌键（缺省 FONT_TOKENS.BODY；古籍传 FONT_TOKENS.CLASSICAL_BODY） */
  fontToken?: string;
  /** 语言标记（缺省 metadata.language，再缺省 zh-Hans） */
  language?: string;
  /** 唯一标识符（缺省 metadata.identifiers 首项，再缺省确定性 urn） */
  identifier?: string;
  /** dcterms:modified（ISO 8601；缺省 metadata.updatedAt / createdAt，再缺省当前时间） */
  modified?: string;
  /** 节点类型 → 标签覆盖（透传序列化器，用于插件节点定制） */
  tagOverrides?: Readonly<Record<string, string>>;
}

/** 导出 EPUB 3（返回完整 epub 文件字节，含 zip 容器） */
export function exportEpub(
  document: BookDocument,
  options: EpubExportOptions = {},
): Uint8Array {
  const { metadata } = document;
  const layout = options.layout ?? DEFAULT_LAYOUT_OPTIONS;
  const language = options.language ?? metadata.language ?? 'zh-Hans';
  const identifier =
    options.identifier ?? resolveIdentifier(metadata) ?? buildDefaultIdentifier(document);
  const modified =
    options.modified ??
    metadata.updatedAt ??
    metadata.createdAt ??
    new Date().toISOString();
  const mtime = parseZipTime(modified);

  /* ---------- 章节规划与 XHTML 生成 ---------- */
  const plan = planDocument(document.root);
  const serializeOptions = {
    tagOverrides: options.tagOverrides,
    anchorIds: plan.anchors,
  };

  const manifest: OpfManifestItem[] = [];
  const spine: string[] = [];
  const textEntries: Record<string, [Uint8Array, ZipOptions]> = {};

  plan.sections.forEach((section, index) => {
    const id = `sec-${index}`;
    const first = section.nodes[0];
    const title =
      first !== undefined ? resolveNodeTitle(first) || metadata.title : metadata.title;
    const body = section.nodes
      .map((node) => serializeNode(node, serializeOptions))
      .join('\n');
    const xhtml = renderXhtmlDocument({ title, language, body, cssHref: '../style.css' });

    textEntries[`OEBPS/${section.file}`] = [strToU8(xhtml), { mtime }];
    manifest.push({ id, href: section.file, mediaType: 'application/xhtml+xml' });
    spine.push(id);
  });

  /* ---------- 导航与样式 ---------- */
  const navXhtml = buildNavXhtml({
    title: '目录',
    language,
    items: buildNavItems(plan),
  });
  const css = buildBookCss({
    tokens: options.tokens ?? DEFAULT_THEME,
    options: layout,
    fontToken: options.fontToken,
  });

  /* ---------- OPF ---------- */
  const opf = buildOpf({
    identifier,
    metadata,
    language,
    modified,
    manifest: [
      { id: 'nav', href: 'nav.xhtml', mediaType: 'application/xhtml+xml', properties: 'nav' },
      { id: 'style', href: 'style.css', mediaType: 'text/css' },
      ...manifest,
    ],
    spine,
  });

  /* ---------- 打包（mimetype 首条目且 STORE，OCF 要求） ---------- */
  const files: Record<string, [Uint8Array, ZipOptions]> = {
    mimetype: [strToU8(EPUB_MIMETYPE), { level: 0, mtime }],
    'META-INF/container.xml': [strToU8(buildContainerXml()), { mtime }],
    'OEBPS/content.opf': [strToU8(opf), { mtime }],
    'OEBPS/nav.xhtml': [strToU8(navXhtml), { mtime }],
    'OEBPS/style.css': [strToU8(css), { mtime }],
  };
  for (const [name, entry] of Object.entries(textEntries)) {
    files[name] = entry;
  }

  return zipSync(files);
}

/** OCF 容器描述（container.xml，指向 OPF） */
export function buildContainerXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;
}

/** ISO 时间 → zip 条目时间（无效值回退 1980-01-01，DOS 时间下限；保证导出确定性） */
function parseZipTime(iso: string): Date {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? new Date('1980-01-01T00:00:00Z') : new Date(time);
}
