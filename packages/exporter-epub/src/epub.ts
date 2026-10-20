/**
 * EPUB 导出主流程
 *
 * 链路：BookDocument → 章节规划（sections）→ XHTML 序列化（layout/html）
 * → OPF / nav / 样式 → 媒体打包 → 导出前校验 → fflate 打包为 EPUB（Uint8Array）。
 *
 * 浏览器与 Node 同构：不依赖 DOM 与文件系统，产物由调用方保存 / 下载。
 * mimetype 按 OCF 规范以首条目、STORE（不压缩）方式写入。
 *
 * 版本策略（默认 EPUB 3.0）：
 * - EPUB 3：XHTML5 内容文档、`properties="nav"`、`dcterms:modified`、
 *   副标题 refines、封面 `properties="cover-image"`、creator 带 `opf:role`；
 * - EPUB 2（显式 `version: '2.0'`）：XHTML 1.1 内容文档、`toc.ncx` 接入 spine、
 *   仅 `dc:date`、封面 `<meta name="cover">`，不输出任何 EPUB 3 专属
 *   `<meta property>`（京东读书 RMSDK 解析器不识别）。
 * 两路均附带 toc.ncx（EPUB 3 向后兼容推荐做法），差异仅在 OPF 特性与文档壳。
 */
import { DEFAULT_THEME, NODE_TYPES, isTextNode, type BookDocument, type BookNode, type ExportComment } from '@bibliotype/core';
import type { FeatureStyleSheet, NamedStyleSet } from '@bibliotype/core';
import { DEFAULT_LAYOUT_OPTIONS, type LayoutOptions } from '@bibliotype/layout';
import { buildBookCss, serializeNode } from '@bibliotype/layout/html';
import { resolveNodeTitle } from '@bibliotype/reader';
import { strToU8, zipSync, type ZipOptions } from 'fflate';
import { groupEndnotes, type EndnoteGrouping } from './endnotes.js';
import { buildDefaultIdentifier, normalizeIdentifier, resolveIdentifier } from './identifier.js';
import { MediaCollector, type MediaItem } from './media.js';
import { buildNavXhtml } from './nav.js';
import { buildOpf, normalizeModified, type OpfManifestItem } from './opf.js';
import { buildNcx } from './ncx.js';
import { buildNavItems, frontMatterEpubType, planDocument, splitSections } from './sections.js';
import { renderXhtmlDocument } from './xhtml.js';
import { validateEpub, type ValidationProblem } from './validate.js';

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
  /** 唯一标识符（缺省 metadata.identifiers 首项，再缺省确定性 urn；裸 ISBN 自动归一为 urn:isbn:） */
  identifier?: string;
  /** dcterms:modified（ISO 8601；缺省 metadata.updatedAt / createdAt，再缺省当前时间） */
  modified?: string;
  /** 节点类型 → 标签覆盖（透传序列化器，用于插件节点定制） */
  tagOverrides?: Readonly<Record<string, string>>;
  /** OPF 版本（缺省 '3.0'；京东读书等 RMSDK 显式传 '2.0'） */
  version?: '2.0' | '3.0';
  /** 单内容文档未压缩字节上限（缺省 256KiB；导入型扁平书按此拆分为多文档） */
  maxSectionBytes?: number;
  /** 导出前校验开关（缺省 true；校验不中断导出，仅经 onValidation 报告） */
  validate?: boolean;
  /** 校验结果回调（error / warning 列表，error 在前） */
  onValidation?: (problems: readonly ValidationProblem[]) => void;
  /**
   * 功能样式表（按功能粒度的样式覆盖）
   *
   * 与阅读 / 编辑画布共用同一份 —— 用户调过的下划线线型、双行注字号等
   * 必须原样写进导出的 style.css，否则「编辑即所见」在导出后失效。
   */
  features?: FeatureStyleSheet;
  /** 命名样式集合（`[data-style-id]` 规则） */
  namedStyles?: NamedStyleSet;
  /**
   * 尾注聚合方式（缺省 `'keep'`：尾注就地排版）
   *
   * - `chapter`：每章末尾收拢该章尾注（篇末注）；
   * - `book`：全部尾注集中到书末新增一章（书末注）。
   *
   * 正文里的 `noteref` 链接指向尾注节点 id，聚合后依然有效。
   */
  endnoteGrouping?: EndnoteGrouping;
  /** 聚合区标题（缺省「注释」；空串表示不加标题行） */
  endnoteTitle?: string;
  /**
   * 翻页方向（缺省按书写模式推导：直排 `vertical-rl` → `'rtl'`，其余 `'ltr'`）
   *
   * 仅 `'rtl'` 会写进 `<spine page-progression-direction>`；`'ltr'` 是 EPUB 缺省值，
   * 不输出属性以保持既有产物稳定。
   */
  pageDirection?: 'ltr' | 'rtl';
  /**
   * 是否把读者评论导出到 EPUB（缺省 false）
   *
   * 开启时，`comments` 中的评论以书末新增一章「读者评论」输出（每条 `作者：正文`）。
   * 评论数据由 `@bibliotype/annotation` 经 `ExportComment` 提供，本导出器不反向依赖标注包。
   */
  includeComments?: boolean;
  /** 评论数据（开启 `includeComments` 时生效） */
  comments?: readonly ExportComment[];
}

/** 导出 EPUB（返回完整 epub 文件字节，含 zip 容器） */
export function exportEpub(
  document: BookDocument,
  options: EpubExportOptions = {},
): Uint8Array {
  const { metadata } = document;
  const layout = options.layout ?? DEFAULT_LAYOUT_OPTIONS;
  const language = options.language ?? metadata.language ?? 'zh-Hans';
  const identifier = normalizeIdentifier(
    options.identifier ?? resolveIdentifier(metadata) ?? buildDefaultIdentifier(document),
  );
  const modifiedRaw =
    options.modified ??
    metadata.updatedAt ??
    metadata.createdAt ??
    new Date().toISOString();
  /* 规范化到 EPUB 3.3 要求的 CCYY-MM-DDThh:mm:ssZ，
     保证 OPF dcterms:modified 与 zip 条目 mtime 口径一致（避免阅读器拒绝/闪退）。 */
  const modified = normalizeModified(modifiedRaw);
  const mtime = parseZipTime(modified);
  /* 默认 EPUB 3.0（现代阅读器主流）；显式传 '2.0' 走 RMSDK 兼容路径。
     nav.xhtml 两路均保留供 EPUB 3 阅读器渲染，EPUB 2 不挂 EPUB 3 专属 properties。 */
  const epubVersion = options.version ?? '3.0';

  /* 翻页方向：直排（vertical-rl）默认从右往左翻，横排从左往右 */
  const pageDirection =
    options.pageDirection ?? (layout.writingMode === 'vertical-rl' ? 'rtl' : 'ltr');

  /* ---------- 尾注聚合（导出期重排，不改动原文档） ---------- */
  const baseRoot =
    options.endnoteGrouping !== undefined && options.endnoteGrouping !== 'keep'
      ? groupEndnotes(document.root, {
          scope: options.endnoteGrouping,
          title: options.endnoteTitle,
        })
      : document.root;

  /* ---------- 评论聚合（导出期追加书末章，不改动原文档） ---------- */
  let root = baseRoot;
  if (options.includeComments === true && options.comments !== undefined && options.comments.length > 0) {
    const commentNodes: BookNode[] = options.comments.map((comment, index) => ({
      type: NODE_TYPES.PARAGRAPH,
      id: `comment-${index}`,
      children: [{ type: 'text', text: `${comment.author ?? '匿名'}：${comment.body}` }],
    }));
    root = {
      ...baseRoot,
      children: [
        ...(baseRoot.children ?? []),
        {
          type: NODE_TYPES.CHAPTER,
          id: '__comments__',
          attrs: { title: '读者评论' },
          children: commentNodes,
        },
      ],
    };
  }

  /* ---------- 章节规划、锚点与媒体收集 ---------- */
  const plan = planDocument(root);
  const media = new MediaCollector();
  const serializeOptions = {
    tagOverrides: options.tagOverrides,
    anchorIds: plan.anchors,
    rewriteSrc: (src: string): string => media.rewrite(src),
    /* 注释块补 epub:type（footnote / endnote / sidebar）：EPUB 3 阅读器据此
       收进注释系统；EPUB 2 引擎不认该属性，关闭以免输出无意义标记。 */
    epubSemantics: epubVersion === '3.0',
  };

  /* 封面预登记：先于序列化拿到 manifest id（序列化期内图片去重归并到同一条目） */
  const coverItem = registerCoverImage(root, media);

  /* ---------- 体积兜底拆分（导入型扁平书的核心修复） ---------- */
  const split = splitSections(plan, {
    maxSectionBytes: options.maxSectionBytes,
    serialize: serializeNode,
    serializeOptions,
  });

  const manifest: OpfManifestItem[] = [];
  const spine: string[] = [];
  const textEntries: Record<string, [Uint8Array, ZipOptions]> = {};

  split.sections.forEach((section, index) => {
    const id = `sec-${index}`;
    const first = section.nodes[0];
    const title =
      first !== undefined ? resolveNodeTitle(first) || metadata.title : metadata.title;
    const body = section.nodes
      .map((node) => serializeNode(node, serializeOptions))
      .join('\n');
    const xhtml = renderXhtmlDocument({
      title,
      language,
      body,
      cssHref: '../style.css',
      flavor: epubVersion === '2.0' ? 'xhtml11' : 'xhtml5',
      bodyType: frontMatterEpubType(first?.type),
    });

    textEntries[`OEBPS/${section.file}`] = [strToU8(xhtml), { mtime }];
    manifest.push({ id, href: section.file, mediaType: 'application/xhtml+xml' });
    spine.push(id);
  });

  /* ---------- 导航与样式 ---------- */
  const navItems = buildNavItems(split.sections, plan.anchors);
  const navXhtml = buildNavXhtml({
    title: '目录',
    language,
    items: navItems,
    flavor: epubVersion === '2.0' ? 'xhtml11' : 'xhtml5',
  });
  /* toc.ncx 两路均输出：EPUB 3 向后兼容推荐做法，EPUB 2（RMSDK）则是必需目录来源 */
  const ncx = buildNcx({
    title: metadata.title,
    language,
    uid: identifier,
    items: navItems,
  });
  const css = buildBookCss({
    tokens: options.tokens ?? DEFAULT_THEME,
    options: layout,
    fontToken: options.fontToken,
    features: options.features,
    namedStyles: options.namedStyles,
    /* 导出路径扁平化 CSS 变量：不支持 var() 的老引擎（RMSDK / 微信读书）
       会丢弃含变量的整条声明，扁平化后 computed value 直写，两端一致。 */
    flatten: true,
  });

  /* ---------- OPF ---------- */
  const mediaManifest: OpfManifestItem[] = media.mediaItems.map((item) => ({
    id: item.id,
    href: item.href,
    mediaType: item.mediaType,
    properties: coverItem !== undefined && item.id === coverItem.id && epubVersion === '3.0'
      ? 'cover-image'
      : undefined,
  }));
  const opf = buildOpf({
    identifier,
    metadata,
    language,
    modified,
    manifest: [
      { id: 'ncx', href: 'toc.ncx', mediaType: 'application/x-dtbncx+xml' },
      {
        id: 'nav',
        href: 'nav.xhtml',
        mediaType: 'application/xhtml+xml',
        properties: epubVersion === '3.0' ? 'nav' : undefined,
      },
      { id: 'style', href: 'style.css', mediaType: 'text/css' },
      ...mediaManifest,
      ...manifest,
    ],
    spine,
    version: epubVersion,
    ncxId: 'ncx',
    coverItemId: coverItem?.id,
    pageProgressionDirection: pageDirection,
    /* guide 仅 EPUB 2 输出（EPUB 3 已用 nav + landmarks 取代，写了只会多一条弃用告警） */
    guide:
      epubVersion === '2.0'
        ? [
            { type: 'toc', href: 'nav.xhtml', title: '目录' },
            ...(split.sections[0] !== undefined
              ? [{ type: 'text', href: split.sections[0].file, title: '正文' }]
              : []),
          ]
        : undefined,
  });

  /* ---------- 打包（mimetype 首条目且 STORE，OCF 要求） ---------- */
  const files: Record<string, [Uint8Array, ZipOptions]> = {
    mimetype: [strToU8(EPUB_MIMETYPE), { level: 0, mtime }],
    'META-INF/container.xml': [strToU8(buildContainerXml()), { mtime }],
    'OEBPS/content.opf': [strToU8(opf), { mtime }],
    'OEBPS/toc.ncx': [strToU8(ncx), { mtime }],
    'OEBPS/nav.xhtml': [strToU8(navXhtml), { mtime }],
    'OEBPS/style.css': [strToU8(css), { mtime }],
  };
  for (const item of media.mediaItems) {
    files[`OEBPS/${item.href}`] = [item.bytes, { mtime }];
  }
  for (const [name, entry] of Object.entries(textEntries)) {
    files[name] = entry;
  }

  /* ---------- 导出前校验（不中断导出，问题经回调透出） ---------- */
  if (options.validate !== false) {
    /* 校验视图：同一批字节引用（不拷贝），仅换掉 zip 选项包装 */
    const entries: Record<string, Uint8Array> = {};
    for (const [name, entry] of Object.entries(files)) entries[name] = entry[0];
    const problems: ValidationProblem[] = [
      /* 媒体收集告警（外链 / 易失地址 / 相对死链 / 超限）并入报告；IMG- 前缀与校验器的 MEDIA- 码区分 */
      ...media.mediaProblems.map((p) => ({
        severity: p.severity,
        code: `IMG-${p.code}`,
        message: p.message,
      })),
      ...validateEpub({
        entries,
        version: epubVersion,
        maxSectionBytes: options.maxSectionBytes,
      }),
    ];
    options.onValidation?.(problems);
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

/**
 * 登记封面图（cover 节点内第一个 img）
 *
 * 京东读书 / 微信读书书架封面来自 manifest 的封面声明而非正文渲染，
 * 缺封面上传审核可能被拒。预登记只为先拿 manifest id；图片字节的
 * 实际去重与路径改写由序列化期的 MediaCollector 完成。
 *
 * 只在**显式 cover 结构节点**内找图：导入型扁平书没有 cover 节点，
 * 若退化为「全书第一张图」，会把正文装饰图（如篇间分隔符）误当封面，
 * 不如不声明（阅读器自行取首图或显示默认封面）。
 */
function registerCoverImage(root: BookNode, media: MediaCollector): MediaItem | undefined {
  const topCover = (root.children ?? []).find(
    (child) => !isTextNode(child) && child.type === NODE_TYPES.COVER,
  );
  if (topCover === undefined) return undefined;
  const found = findFirstImageSrc(topCover, 0);
  return found !== undefined ? media.register(found) : undefined;
}

/** 深度优先找第一个 img 的 src（深度上限 6，避免异常深树） */
function findFirstImageSrc(node: BookNode, depth: number): string | undefined {
  if (node.type === NODE_TYPES.IMAGE) {
    const src = node.attrs?.src;
    return typeof src === 'string' && src !== '' ? src : undefined;
  }
  if (depth >= 6) return undefined;
  for (const child of node.children ?? []) {
    if (isTextNode(child)) continue;
    const found = findFirstImageSrc(child, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** ISO 时间 → zip 条目时间（无效值回退 1980-01-01，DOS 时间下限；保证导出确定性） */
function parseZipTime(iso: string): Date {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? new Date('1980-01-01T00:00:00Z') : new Date(time);
}
