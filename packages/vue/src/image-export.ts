/**
 * 图片 / 长图导出（E7）
 *
 * 把 Reader 的分页结果渲染成图片：
 * - 单页 PNG / JPEG（DPR 可配，字体就绪后再截）；
 * - 按章批量截图 → ZIP（进度回调 + 失败重试）；
 * - 分享长图：多页竖向拼接 + 分章分隔（页眉页脚随页截图自带）。
 *
 * 截图用「离屏页框 + SVG foreignObject」实现（零第三方依赖，与
 * `pagination-measure` 的离屏量尺同源）：页框结构与 `BtBookView` 一致
 * （`.bt-reader-page` + 书册样式表），字体渲染完再栅格化。跨域外链图会被
 * 浏览器判为不洁画布——IR 约定图片内联为 data URI，命中跨域时按截图失败重试。
 *
 * 章节分组读 Reader 目录（`reader.outline`），长图布局是纯函数，可在 Node /
 * happy-dom 里直接断言尺寸与分隔。
 */
import {
  DEFAULT_THEME,
  BibliotypeError,
  isTextNode,
  type FeatureStyleSheet,
  type NamedStyleSet,
} from '@bibliotype/core';
import {
  buildPageStyle,
  buildRootStyle,
  type LayoutOptions,
  type PageSize,
  type PageNumberStyle,
} from '@bibliotype/layout';
import { buildBookCss, serializeNode, serializePageGutter, serializePageNotes } from '@bibliotype/layout/html';
import { formatPageNumber, type OutlineItem, type Reader } from '@bibliotype/reader';

/* =========================================================================
 * 选项
 * ========================================================================= */

/** 图片格式 */
export type ImageExportFormat = 'png' | 'jpeg';

/** 单页截图选项 */
export interface PageImageOptions {
  /** 像素比（1~3，缺省 2） */
  dpr?: number;
  /** 图片格式（缺省 `png`；`jpeg` 不支持透明底） */
  format?: ImageExportFormat;
  /** JPEG 质量（0.1~1，缺省 0.92） */
  quality?: number;
  /** 页面底色（CSS 颜色，缺省 `#ffffff`；`null` = PNG 透明底） */
  background?: string | null;
}

/** 归一化后的截图选项 */
export interface ResolvedPageImageOptions {
  dpr: number;
  format: ImageExportFormat;
  quality: number;
  background: string | null;
}

/** 缺省截图选项 */
export const DEFAULT_PAGE_IMAGE_OPTIONS: ResolvedPageImageOptions = {
  dpr: 2,
  format: 'png',
  quality: 0.92,
  background: '#ffffff',
};

/** 归一化截图选项（DPR 1~3、质量 0.1~1；JPEG 强制不透明底） */
export function resolvePageImageOptions(options: PageImageOptions = {}): ResolvedPageImageOptions {
  const format = options.format ?? DEFAULT_PAGE_IMAGE_OPTIONS.format;
  const background =
    options.background === undefined ? DEFAULT_PAGE_IMAGE_OPTIONS.background : options.background;
  return {
    dpr: clampNumber(options.dpr, 1, 3, DEFAULT_PAGE_IMAGE_OPTIONS.dpr),
    format,
    quality: clampNumber(options.quality, 0.1, 1, DEFAULT_PAGE_IMAGE_OPTIONS.quality),
    background: format === 'jpeg' ? (background ?? '#ffffff') : background,
  };
}

/** 页面像素尺寸（CSS px × DPR，取整且至少 1px） */
export function resolvePagePixelSize(
  page: { width: number; height: number },
  dpr = DEFAULT_PAGE_IMAGE_OPTIONS.dpr,
): { width: number; height: number } {
  const scale = clampNumber(dpr, 1, 3, DEFAULT_PAGE_IMAGE_OPTIONS.dpr);
  return {
    width: Math.max(1, Math.round(page.width * scale)),
    height: Math.max(1, Math.round(page.height * scale)),
  };
}

function clampNumber(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function nonNegative(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return fallback;
  return value;
}

/* =========================================================================
 * 章节分组
 * ========================================================================= */

/** 章节目录分组结果 */
export interface ChapterImagePlan {
  /** 章序号（0 起，与 outline 顶层顺序一致） */
  index: number;
  /** 章标题（目录项标题；缺省「第 N 章」） */
  title: string;
  /** 章首节点 id（无 id 的导入文档为树路径 id） */
  nodeId: string;
  /** 起始页（0 起，含；首章从 0 起以纳入封面 / 前置页） */
  startPage: number;
  /** 结束页（0 起，含） */
  endPage: number;
}

/** 章节分组选项 */
export interface ChapterPlanOptions {
  /** 分组层级：目录顶层为 0（缺省），卷 / 章 / 节按文档结构取层 */
  level?: number;
}

/**
 * 按目录把分页结果分组为章节。
 *
 * - 取 `level` 层的目录项，用 `getPageOfNode` 定位起始页并按页序去重；
 * - 首个分组从第 0 页起（封面 / 前置页归入第一章）；
 * - 无目录（或目录都无页号）时退化为单章「全书」。
 */
export function planChapterImages(reader: Reader, options: ChapterPlanOptions = {}): ChapterImagePlan[] {
  const total = reader.totalPages;
  if (total === 0) return [];
  const level = Math.max(0, Math.trunc(options.level ?? 0));
  const items = collectOutlineAtLevel(reader.outline, level);
  const starts: { item: OutlineItem; page: number }[] = [];
  const seen = new Set<number>();
  for (const item of items) {
    if (item.nodeId === undefined) continue;
    const page = reader.getPageOfNode(item.nodeId);
    if (page === undefined || seen.has(page)) continue;
    seen.add(page);
    starts.push({ item, page });
  }
  if (starts.length === 0) {
    return [
      {
        index: 0,
        title: reader.document?.metadata.title ?? '全书',
        nodeId: '',
        startPage: 0,
        endPage: total - 1,
      },
    ];
  }
  starts.sort((a, b) => a.page - b.page);
  return starts.map((entry, index) => ({
    index,
    title: entry.item.title.trim() === '' ? `第 ${index + 1} 章` : entry.item.title,
    nodeId: entry.item.nodeId ?? '',
    startPage: index === 0 ? 0 : entry.page,
    endPage: index + 1 < starts.length ? (starts[index + 1] as { page: number }).page - 1 : total - 1,
  }));
}

/** 取目录中指定层级的节点（同级平铺，不展开更深层） */
function collectOutlineAtLevel(items: readonly OutlineItem[], level: number): OutlineItem[] {
  const out: OutlineItem[] = [];
  const walk = (list: readonly OutlineItem[]): void => {
    for (const item of list) {
      if (item.level === level) out.push(item);
      else if (item.level < level) walk(item.children);
    }
  };
  walk(items);
  return out;
}

/* =========================================================================
 * 单页截图
 * ========================================================================= */

/** 截图来源选项（与 BtBookView 的视觉来源一致） */
export interface ImageCaptureSourceOptions {
  /** 主题令牌（缺省 DEFAULT_THEME） */
  tokens?: Readonly<Record<string, string | undefined>>;
  /** 正文字体族令牌键（古籍传 FONT_TOKENS.CLASSICAL_BODY） */
  fontToken?: string;
  /** 功能样式表（与阅读器同源） */
  features?: FeatureStyleSheet;
  /** 命名样式集合（与阅读器同源） */
  namedStyles?: NamedStyleSet;
}

/** 截图任务信息 */
export interface PageImageInfo {
  /** 所在章序号（0 起） */
  chapterIndex: number;
  /** 全书页序（0 起，用于总进度） */
  index: number;
  /** 总页数 */
  total: number;
}

/** 单页截图结果（宽高为 CSS px，data 为按 DPR 缩放的图片字节） */
export interface CapturedPageImage {
  chapterIndex: number;
  pageIndex: number;
  width: number;
  height: number;
  data: Uint8Array;
}

/** 单页截图端口（测试 / 宿主可注入自定义实现，如 Electron 原生捕获） */
export interface PageCapture {
  capturePage(pageIndex: number, info: PageImageInfo): CapturedPageImage | Promise<CapturedPageImage>;
  /** 释放离屏页框 / 注入样式 */
  dispose?(): void;
}

/** DOM 截图的输入（Reader 以外的视觉来源 + 截图选项） */
export interface DomPageCaptureOptions extends ImageCaptureSourceOptions, PageImageOptions {
  /** 覆盖全局 document（缺省 `globalThis.document`） */
  document?: Document;
}

const CAPTURE_CSS_ID = 'bt-image-css';
const CAPTURE_HOST_ID = 'bt-image-host';
const EMPTY_GUTTER_TEXTS = {
  bookTitle: '',
  volumeTitle: '',
  chapterTitle: '',
  pageNumber: '',
} as const;

/** 页首块 margin 吞掉（与 BtBookView 的 PAGE_START_RULE 同源） */
const PAGE_START_RULE = '\n.bt-reader-page__flow > :first-child {\n  margin-block-start: 0;\n}\n';

/**
 * 创建浏览器端单页截图器（离屏页框 + SVG foreignObject，零第三方依赖）。
 *
 * 页框结构与 BtBookView 同源：书册样式表（`.bt-reader-page` 作用域）+
 * 页框 inline 样式（尺寸 / 页边距 / 排版）+ 页眉页脚 / 页底注区 / 版心。
 */
export function createDomPageCapture(
  reader: Reader,
  options: DomPageCaptureOptions = {},
): PageCapture {
  const doc = options.document ?? (typeof document === 'undefined' ? undefined : document);
  if (doc === undefined) {
    throw new BibliotypeError(
      'IMAGE_EXPORT_UNSUPPORTED',
      '当前环境没有 DOM，无法截图导出图片。',
      {
        hint: '请在浏览器 / Electron 渲染进程调用；Node 环境请改用 EPUB / DOCX 导出。',
      },
    );
  }
  const image = resolvePageImageOptions(options);
  const tokens = options.tokens ?? DEFAULT_THEME;
  const layout = reader.layout;
  const pageSize = layout.pageSize;
  let host: HTMLElement | undefined;
  let cssText = '';
  let fontsReady: Promise<void> | undefined;

  const ensureHost = (): HTMLElement => {
    if (host !== undefined) return host;
    const element = doc.createElement('div');
    element.id = CAPTURE_HOST_ID;
    element.setAttribute('aria-hidden', 'true');
    element.style.cssText =
      'position:absolute;left:-100000px;top:0;visibility:hidden;pointer-events:none;contain:layout size style;';
    doc.body.appendChild(element);
    host = element;
    return element;
  };

  const ensureCss = (): void => {
    const css =
      buildBookCss({
        tokens,
        options: layout,
        fontToken: options.fontToken,
        features: options.features,
        namedStyles: options.namedStyles,
        pageDecoration: layout.facsimile !== undefined,
        containerSelector: '.bt-reader-page',
      }) + PAGE_START_RULE;
    let element = doc.getElementById(CAPTURE_CSS_ID) as HTMLStyleElement | null;
    if (element === null) {
      element = doc.createElement('style');
      element.id = CAPTURE_CSS_ID;
      doc.head.appendChild(element);
    }
    if (element.textContent !== css) element.textContent = css;
    cssText = css;
  };

  return {
    async capturePage(pageIndex, info) {
      ensureHost();
      ensureCss();
      fontsReady ??= waitForFonts(doc);
      await fontsReady;
      const page = buildPageElement(reader, pageIndex, tokens, options, doc);
      (host as HTMLElement).appendChild(page);
      try {
        const canvas = await rasterizeElement(page, cssText, pageSize, image, doc, pageIndex);
        const data = await canvasToBytes(canvas, image);
        return {
          chapterIndex: info.chapterIndex,
          pageIndex,
          width: pageSize.width,
          height: pageSize.height,
          data,
        };
      } finally {
        page.remove();
      }
    },
    dispose() {
      host?.remove();
      host = undefined;
      doc.getElementById(CAPTURE_CSS_ID)?.remove();
    },
  };
}

/** 构建与 BtBookView 同构的单页 DOM（离屏，不参与可见布局） */
function buildPageElement(
  reader: Reader,
  pageIndex: number,
  tokens: Readonly<Record<string, string | undefined>>,
  source: ImageCaptureSourceOptions,
  doc: Document,
): HTMLElement {
  const layout = reader.layout;
  const pageSize = layout.pageSize;
  const page = doc.createElement('div');
  page.className = 'bt-reader-page';
  const style = {
    ...buildPageStyle(pageSize, tokens),
    ...buildRootStyle({ tokens, options: layout, fontToken: source.fontToken }),
  };
  for (const [prop, value] of Object.entries(style)) {
    page.style.setProperty(prop, String(value));
  }

  const chrome = reader.getPageChromeTexts(pageIndex);
  if (chrome?.header !== undefined && chrome.header !== '') {
    const header = doc.createElement('div');
    header.className = 'bt-page-header';
    header.textContent = chrome.header;
    page.appendChild(header);
  }

  const columns = reader.getPageColumns(pageIndex);
  const flow = doc.createElement('div');
  flow.className = columns > 1 ? 'bt-reader-page__flow is-multicolumn' : 'bt-reader-page__flow';
  if (columns > 1) {
    flow.style.columnCount = String(columns);
    flow.style.columnGap = 'var(--bt-column-gap)';
    flow.style.columnFill = 'auto';
  }
  const nodes = reader.getPageFragments(pageIndex).filter((node) => !isTextNode(node));
  flow.innerHTML = nodes.map((node) => serializeNode(node)).join('\n');
  page.appendChild(flow);

  const notesHtml = serializePageNotes(reader.getPageNotes(pageIndex), {
    continued: reader.isPageNotesContinued(pageIndex),
  });
  if (notesHtml !== '') {
    const notes = doc.createElement('div');
    notes.className = 'bt-page-notes-host';
    notes.innerHTML = notesHtml;
    page.appendChild(notes);
  }

  const gutterHtml = serializePageGutter(
    reader.getPageGutterTexts(pageIndex) ?? EMPTY_GUTTER_TEXTS,
    layout.facsimile,
  );
  if (gutterHtml !== '') {
    const gutter = doc.createElement('div');
    gutter.className = 'bt-page-gutter-host';
    gutter.innerHTML = gutterHtml;
    page.appendChild(gutter);
  }

  const showPageNumber =
    chrome === undefined && !reader.isCoverPage(pageIndex) && nodes.length > 0;
  if (chrome?.footer !== undefined && chrome.footer !== '') {
    const footer = doc.createElement('footer');
    footer.className = 'bt-page-footer';
    footer.textContent = chrome.footer;
    page.appendChild(footer);
  } else if (showPageNumber) {
    const footer = doc.createElement('footer');
    footer.className = 'bt-page-number';
    footer.textContent = formatPageNumber(
      pageIndex + 1,
      layout.pageNumberStyle as PageNumberStyle,
    );
    page.appendChild(footer);
  }
  return page;
}

/** 把离屏页框栅格化为 canvas（SVG foreignObject + 内嵌书册样式表） */
async function rasterizeElement(
  page: HTMLElement,
  cssText: string,
  pageSize: PageSize,
  image: ResolvedPageImageOptions,
  doc: Document,
  pageIndex: number,
): Promise<HTMLCanvasElement> {
  const { width, height } = pageSize;
  const clone = page.cloneNode(true) as HTMLElement;
  const wrapperStyle = `margin:0;padding:0;width:${width}px;height:${height}px;overflow:hidden;background:${
    image.background ?? 'transparent'
  };`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<foreignObject width="100%" height="100%">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="${escapeXmlText(wrapperStyle)}">` +
    `<style>${escapeXmlText(cssText)}\n.bt-reader-page *, .bt-reader-page *::before, .bt-reader-page *::after{animation:none!important;transition:none!important;}</style>` +
    clone.outerHTML +
    `</div></foreignObject></svg>`;
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const imageElement = doc.createElement('img');
  await new Promise<void>((resolve, reject) => {
    imageElement.onload = () => resolve();
    imageElement.onerror = () => {
      reject(
        new BibliotypeError(
          'IMAGE_EXPORT_FAILED',
          `第 ${pageIndex + 1} 页截图失败：浏览器拒绝渲染 SVG foreignObject。`,
          {
            details: { pageIndex },
            hint: '检查该页是否含跨域图片 / 未就绪的网络字体；IR 约定图片应内联为 data URI。',
          },
        ),
      );
    };
    imageElement.src = url;
  });

  const pixel = resolvePagePixelSize(pageSize, image.dpr);
  const canvas = doc.createElement('canvas');
  canvas.width = pixel.width;
  canvas.height = pixel.height;
  const context = canvas.getContext('2d');
  if (context === null) {
    throw new BibliotypeError('IMAGE_EXPORT_UNSUPPORTED', '当前环境没有 Canvas 2D 上下文，无法导出图片。', {
      hint: '请在浏览器 / Electron 渲染进程调用；happy-dom / jsdom 需注入自定义截图实现。',
    });
  }
  context.scale(image.dpr, image.dpr);
  if (image.background !== null) {
    context.fillStyle = image.background;
    context.fillRect(0, 0, width, height);
  }
  context.drawImage(imageElement, 0, 0, width, height);
  return canvas;
}

/** XML 文本转义（CSS / 内联样式进 SVG foreignObject 前必须处理 `<` 与 `&`） */
function escapeXmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 等待字体就绪（`document.fonts.ready`；无 FontFaceSet 环境为 no-op） */
export async function waitForFonts(doc?: Document): Promise<void> {
  const target = doc ?? (typeof document === 'undefined' ? undefined : document);
  const fonts = target?.fonts as FontFaceSet | undefined;
  if (fonts !== undefined && typeof fonts.ready?.then === 'function') await fonts.ready;
}

/** canvas → 图片字节（PNG / JPEG） */
export async function canvasToBytes(
  canvas: HTMLCanvasElement,
  options: PageImageOptions = {},
): Promise<Uint8Array> {
  const image = resolvePageImageOptions(options);
  const type = image.format === 'jpeg' ? 'image/jpeg' : 'image/png';
  if (typeof canvas.toBlob !== 'function') {
    throw new BibliotypeError('IMAGE_EXPORT_UNSUPPORTED', '当前环境不支持 canvas.toBlob()。', {
      hint: '请在浏览器 / Electron 渲染进程调用，或改用宿主原生截图实现。',
    });
  }
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, type, image.quality),
  );
  if (blob === null) {
    throw new BibliotypeError('IMAGE_EXPORT_FAILED', '图片编码失败：canvas.toBlob() 返回空。', {
      hint: '尝试降低 DPR 或改用 JPEG 格式后重试。',
    });
  }
  return new Uint8Array(await blob.arrayBuffer());
}

/* =========================================================================
 * 批量导出（按章 ZIP）
 * ========================================================================= */

/** 导出进度 */
export interface ImageExportProgress {
  phase: 'capture' | 'zip';
  /** 已完成页数 */
  done: number;
  /** 总页数 */
  total: number;
  chapterIndex: number;
  pageIndex: number;
}

/** 按章导出选项 */
export interface ChapterImageExportOptions extends ImageCaptureSourceOptions {
  /** 截图选项（DPR / 格式 / 质量 / 底色） */
  image?: PageImageOptions;
  /** 自定义截图实现（缺省为 DOM 截图） */
  capture?: PageCapture;
  /** 单页失败重试次数（缺省 1，即最多两次） */
  retries?: number;
  /** 章节分组层级（缺省 0，目录顶层） */
  chapterLevel?: number;
  /** 进度回调（每页截图后、打包后各触发一次） */
  onProgress?: (progress: ImageExportProgress) => void;
}

/** 按章导出结果 */
export interface ChapterImageExportResult {
  chapters: ChapterImagePlan[];
  pages: CapturedPageImage[];
  /** ZIP 字节（按章分目录，文件名为页序） */
  zip: Uint8Array;
}

/**
 * 按章截图并打包为 ZIP。
 *
 * 产物结构：`01-章名/001.png`、`01-章名/002.png`、`02-章名/001.png`……
 * 章名经文件系统安全清洗，页序全书连续编号（跨章不重置）。
 */
export async function exportChapterImages(
  reader: Reader,
  options: ChapterImageExportOptions = {},
): Promise<ChapterImageExportResult> {
  const chapters = planChapterImages(reader, { level: options.chapterLevel });
  if (chapters.length === 0) {
    throw new BibliotypeError('IMAGE_EXPORT_FAILED', '文档为空，没有可导出的页面。', {
      hint: '先 reader.loadDocument(doc) 载入文档并完成分页。',
    });
  }
  const image = resolvePageImageOptions(options.image);
  const retries = Math.max(0, Math.trunc(options.retries ?? 1));
  const capture =
    options.capture ??
    createDomPageCapture(reader, { ...options, ...options.image });
  const total = chapters.reduce(
    (sum, chapter) => sum + (chapter.endPage - chapter.startPage + 1),
    0,
  );
  const pages: CapturedPageImage[] = [];
  const files: ZipFileInput[] = [];
  let done = 0;
  try {
    for (const chapter of chapters) {
      for (let pageIndex = chapter.startPage; pageIndex <= chapter.endPage; pageIndex += 1) {
        const info: PageImageInfo = { chapterIndex: chapter.index, index: done, total };
        const captured = await captureWithRetry(capture, pageIndex, info, retries);
        pages.push(captured);
        files.push({
          name: `${chapterFolderName(chapter)}/${pageFileName(pageIndex, image.format)}`,
          data: captured.data,
        });
        done += 1;
        options.onProgress?.({
          phase: 'capture',
          done,
          total,
          chapterIndex: chapter.index,
          pageIndex,
        });
      }
    }
    const zip = createStoredZip(files);
    const last = chapters[chapters.length - 1] as ChapterImagePlan;
    options.onProgress?.({
      phase: 'zip',
      done: files.length,
      total,
      chapterIndex: last.index,
      pageIndex: last.endPage,
    });
    return { chapters, pages, zip };
  } finally {
    capture.dispose?.();
  }
}

/** 截图 + 失败重试（重试次数用尽后包一层统一错误，保留根因） */
async function captureWithRetry(
  capture: PageCapture,
  pageIndex: number,
  info: PageImageInfo,
  retries: number,
): Promise<CapturedPageImage> {
  let last: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await capture.capturePage(pageIndex, info);
    } catch (error) {
      last = error;
    }
  }
  throw new BibliotypeError(
    'IMAGE_EXPORT_FAILED',
    `第 ${pageIndex + 1} 页截图失败（已重试 ${retries} 次）。`,
    {
      details: { pageIndex, attempts: retries + 1 },
      hint: '检查该页是否含跨域图片 / 未就绪字体，或降低 DPR 后重试。',
      cause: last,
    },
  );
}

/** 章目录名（`01-章名`；标题清洗为空时回退 `chapter`） */
export function chapterFolderName(plan: ChapterImagePlan): string {
  const seq = String(plan.index + 1).padStart(2, '0');
  return `${seq}-${sanitizeImagePathSegment(plan.title, 'chapter')}`;
}

/** 页文件名（001.png / 001.jpg） */
export function pageFileName(pageIndex: number, format: ImageExportFormat): string {
  const seq = String(pageIndex + 1).padStart(3, '0');
  return `${seq}.${format === 'jpeg' ? 'jpg' : 'png'}`;
}

/** 文件系统 / ZIP 路径片段清洗（去掉非法字符与控制符，限制长度） */
export function sanitizeImagePathSegment(value: string, fallback = 'chapter'): string {
  const cleaned = value
    .replace(/[\\/:*?"<>|]/g, '-')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 48)
    .trim();
  return cleaned === '' ? fallback : cleaned;
}

/* =========================================================================
 * ZIP（STORE 不压缩：PNG / JPEG 已压缩，省 CPU 且产物确定）
 * ========================================================================= */

/** ZIP 条目输入 */
export interface ZipFileInput {
  /** 条目路径（UTF-8，`/` 分隔） */
  name: string;
  data: Uint8Array;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32（IEEE 802.3，ZIP 校验用） */
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = (CRC_TABLE[(crc ^ data[i]!) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** DOS 时间戳（1980-01-01 00:00:00，固定值保证产物可复现） */
const DOS_TIME = 0;
const DOS_DATE = 0x0021;

/**
 * 生成 STORE（不压缩）ZIP。
 *
 * 图片本身已是压缩格式，STORE 省去二次压缩的 CPU；固定时间戳使同一批
 * 输入产出逐字节一致的 ZIP，便于测试与缓存。
 */
export function createStoredZip(files: readonly ZipFileInput[]): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.data);
    const size = file.data.length;

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, DOS_TIME, true);
    lv.setUint16(12, DOS_DATE, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);
    chunks.push(local, file.data);

    const header = new Uint8Array(46 + name.length);
    const cv = new DataView(header.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, DOS_TIME, true);
    cv.setUint16(14, DOS_DATE, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    header.set(name, 46);
    central.push(header);

    offset += local.length + size;
  }

  const centralSize = central.reduce((sum, chunk) => sum + chunk.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  return concatBytes([...chunks, ...central, end]);
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/* =========================================================================
 * 长图
 * ========================================================================= */

/** 长图布局选项 */
export interface LongImageLayoutOptions {
  /** 同章页间距（px，缺省 16） */
  pageGap?: number;
  /** 分章分隔带高度（px，缺省 48；0 = 不留分隔） */
  chapterGap?: number;
  /** 四周留白（px，缺省 0） */
  padding?: number;
}

/** 长图渲染选项（布局 + 绘制） */
export interface LongImageOptions extends LongImageLayoutOptions, PageImageOptions {
  /** 分章分隔带是否绘制章名（缺省 true） */
  chapterTitle?: boolean;
  /** 分隔带底色（缺省 `#f2f2f2`） */
  separatorColor?: string;
  /** 章名字体（canvas font，缺省 `600 14px sans-serif`） */
  chapterTitleFont?: string;
  /** 章名颜色（缺省 `#666666`） */
  chapterTitleColor?: string;
}

/** 长图章节输入 */
export interface LongImageChapterInput {
  /** 章序号（0 起） */
  index: number;
  /** 章标题 */
  title: string;
  /** 本章各页尺寸（CSS px） */
  pages: readonly { width: number; height: number }[];
}

/** 页在长图中的位置（CSS px） */
export interface LongImagePagePlacement {
  chapterIndex: number;
  pageIndex: number;
  top: number;
  left: number;
  width: number;
  height: number;
}

/** 分章分隔带位置（CSS px） */
export interface LongImageSeparatorPlacement {
  chapterIndex: number;
  top: number;
  height: number;
  title: string;
}

/** 长图布局结果 */
export interface LongImageLayout {
  width: number;
  height: number;
  pages: LongImagePagePlacement[];
  separators: LongImageSeparatorPlacement[];
}

/**
 * 计算长图布局（纯函数，不依赖 DOM）。
 *
 * 规则：同章页间留 `pageGap`，章间留 `chapterGap` 分隔带（分隔带不计入页间
 * 间距）；页在最大页宽内水平居中，四周留 `padding`。高度 = 各页高度之和 +
 * 页间距 + 分隔带高度。
 */
export function layoutLongImage(
  chapters: readonly LongImageChapterInput[],
  options: LongImageLayoutOptions = {},
): LongImageLayout {
  const pageGap = nonNegative(options.pageGap, 16);
  const chapterGap = nonNegative(options.chapterGap, 48);
  const padding = nonNegative(options.padding, 0);
  const visible = chapters.filter((chapter) => chapter.pages.length > 0);
  const maxPageWidth = visible.reduce(
    (max, chapter) => Math.max(max, ...chapter.pages.map((page) => page.width)),
    0,
  );
  const width = Math.max(1, Math.ceil(maxPageWidth + padding * 2));
  const pages: LongImagePagePlacement[] = [];
  const separators: LongImageSeparatorPlacement[] = [];
  let top = padding;
  visible.forEach((chapter, order) => {
    if (order > 0) {
      separators.push({
        chapterIndex: chapter.index,
        top,
        height: chapterGap,
        title: chapter.title,
      });
      top += chapterGap;
    }
    chapter.pages.forEach((page, pageIndex) => {
      if (pageIndex > 0) top += pageGap;
      pages.push({
        chapterIndex: chapter.index,
        pageIndex,
        top,
        left: padding + (width - padding * 2 - page.width) / 2,
        width: page.width,
        height: page.height,
      });
      top += page.height;
    });
  });
  return { width, height: Math.max(1, Math.ceil(top + padding)), pages, separators };
}

/** 长图合成输入（页图片字节，与布局的 chapterIndex / pageIndex 对应） */
export interface LongImagePageImage {
  chapterIndex: number;
  pageIndex: number;
  data: Uint8Array;
}

/**
 * 把各页图片竖向拼接为一张长图（浏览器 Canvas）。
 *
 * 页眉页脚随页截图自带（Reader 页眉页脚启用时）；分隔带绘制章名。整书页数
 * 很多时高度可能超过浏览器画布上限（Chrome ~32767px），此时建议用按章 ZIP。
 */
export async function composeLongImage(
  layout: LongImageLayout,
  images: readonly LongImagePageImage[],
  options: LongImageOptions = {},
): Promise<HTMLCanvasElement> {
  if (typeof document === 'undefined') {
    throw new BibliotypeError('IMAGE_EXPORT_UNSUPPORTED', '当前环境没有 DOM，无法合成分享长图。', {
      hint: '请在浏览器 / Electron 渲染进程调用。',
    });
  }
  const image = resolvePageImageOptions(options);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(layout.width * image.dpr));
  canvas.height = Math.max(1, Math.round(layout.height * image.dpr));
  const context = canvas.getContext('2d');
  if (context === null) {
    throw new BibliotypeError('IMAGE_EXPORT_UNSUPPORTED', '当前环境没有 Canvas 2D 上下文，无法合成长图。');
  }
  context.scale(image.dpr, image.dpr);
  if (image.background !== null) {
    context.fillStyle = image.background;
    context.fillRect(0, 0, layout.width, layout.height);
  }

  const separatorColor = options.separatorColor ?? '#f2f2f2';
  const titleFont = options.chapterTitleFont ?? '600 14px sans-serif';
  const titleColor = options.chapterTitleColor ?? '#666666';
  for (const separator of layout.separators) {
    context.fillStyle = separatorColor;
    context.fillRect(0, separator.top, layout.width, separator.height);
    if (options.chapterTitle !== false && separator.height > 0) {
      context.fillStyle = titleColor;
      context.font = titleFont;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(separator.title, layout.width / 2, separator.top + separator.height / 2);
    }
  }

  const byKey = new Map<string, Uint8Array>();
  for (const entry of images) byKey.set(`${entry.chapterIndex}:${entry.pageIndex}`, entry.data);
  for (const placement of layout.pages) {
    const data = byKey.get(`${placement.chapterIndex}:${placement.pageIndex}`);
    if (data === undefined) continue;
    const source = await decodeImageData(data, image.format);
    context.drawImage(source, placement.left, placement.top, placement.width, placement.height);
    closeImageSource(source);
  }
  return canvas;
}

/** 图片字节 → CanvasImageSource（优先 createImageBitmap，回退 <img> + objectURL） */
async function decodeImageData(
  data: Uint8Array,
  format: ImageExportFormat,
): Promise<CanvasImageSource> {
  const type = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  // 拷贝到独立 ArrayBuffer：源 Uint8Array 可能是 SharedArrayBuffer 视图，不能直接作 BlobPart
  const bytes = new Uint8Array(data.byteLength);
  bytes.set(data);
  const blob = new Blob([bytes.buffer], { type });
  if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
  const url = URL.createObjectURL(blob);
  try {
    const element = new Image();
    await new Promise<void>((resolve, reject) => {
      element.onload = () => resolve();
      element.onerror = () => reject(new Error('图片解码失败'));
      element.src = url;
    });
    return element;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function closeImageSource(source: CanvasImageSource): void {
  if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) source.close();
}

/** 长图导出选项 */
export interface LongImageExportOptions extends ChapterImageExportOptions {
  /** 长图布局 / 渲染选项 */
  longImage?: LongImageOptions;
}

/** 长图导出结果 */
export interface LongImageExportResult {
  chapters: ChapterImagePlan[];
  pages: CapturedPageImage[];
  layout: LongImageLayout;
  /** 长图字节（PNG / JPEG，按 `image` 选项编码） */
  data: Uint8Array;
}

/**
 * 导出分享长图：按章截图 → 竖向拼接 → 编码为图片字节。
 *
 * 与 `exportChapterImages` 共用截图选项与失败重试；页眉页脚随页截图自带，
 * 章与章之间插入分隔带（可绘制章名）。
 */
export async function exportLongImage(
  reader: Reader,
  options: LongImageExportOptions = {},
): Promise<LongImageExportResult> {
  const { chapters, pages } = await exportChapterImages(reader, options);
  const layout = layoutLongImage(
    chapters.map((chapter) => ({
      index: chapter.index,
      title: chapter.title,
      pages: pages
        .filter((page) => page.chapterIndex === chapter.index)
        .map((page) => ({ width: page.width, height: page.height })),
    })),
    options.longImage,
  );
  const canvas = await composeLongImage(layout, pages, {
    ...options.image,
    ...options.longImage,
  });
  const data = await canvasToBytes(canvas, { ...options.image, ...options.longImage });
  return { chapters, pages, layout, data };
}
