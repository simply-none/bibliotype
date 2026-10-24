/**
 * 字图（缺字替代图）识别与归一化（K6）
 *
 * 字体没有的字用图片顶替时，这张图本质是**一个字**，必须随文字流内联排版；
 * 但主流来源（Word / 网页 / EPUB）里它常以块级 `image` 节点夹在段落之间，
 * 分页时独立占位成「洞」。本模块在导入边界做一次归一化：识别出「字图特征」
 * 的块级 image，转为行内 `glyph-image` 节点并入相邻段落——阅读 / 分页 / 编辑 /
 * 导出四条链随之天然一致，不再各自特判。
 *
 * 识别走「排除项 + 强/弱信号」评分，全部阈值可配置；判定不确定的保守保留
 * 块级并进报告，**绝不丢数据**。归一化返回新文档，原档不可变。
 *
 * 归并语义：字图本质是句子中被抠掉的字——`auto` 且两侧都是段落、前段未收尾时，
 * 前后两段正是被它切断的同一句话，按「前段 + 字图 + 后段」三合一复原；
 * 强制 `merge: 'prev' / 'next'` 时只缝单侧不复原（兼容逐图定向迁移）。
 */
import { NODE_TYPES } from './ir/node-types.js';
import type { BookDocument } from './ir/document.js';
import type { Attrs } from './ir/types.js';
import type { BookNode } from './ir/nodes.js';

/** 识别选项（全部可配置，缺省见 {@link DEFAULT_GLYPH_IMAGE_OPTIONS}） */
export interface GlyphImageDetectOptions {
  /**
   * 像素阈值：attrs 宽或高超过即判插图（缺省 64）
   *
   * 正文 1em ≈ 18~24px，缺字图通常一字位（≤32px）；64 留出高 DPI 余量。
   */
  maxGlyphPx?: number;
  /** 近方形宽高比区间（缺省 0.6~1.6；单字图近方，横幅 / 竖长图是插图特征） */
  aspectRange?: [number, number];
  /** alt 视为原字标记的最大字符数（缺省 2；如 alt="贔"） */
  maxAltChars?: number;
  /** 弱信号：src 特征词（缺省 /glyph|zi[/\-]|char/i） */
  srcHints?: RegExp;
  /** 归并方向（缺省 'auto'：并前段，前段段落收尾则并后段） */
  merge?: 'auto' | 'prev' | 'next';
}

/** 缺省识别选项 */
export const DEFAULT_GLYPH_IMAGE_OPTIONS: Required<Omit<GlyphImageDetectOptions, 'srcHints'>> & {
  srcHints: RegExp;
} = {
  maxGlyphPx: 64,
  aspectRange: [0.6, 1.6],
  maxAltChars: 2,
  srcHints: /glyph|zi[/\-]|char/i,
  merge: 'auto',
};

/** 单条归并记录 */
export interface GlyphImageMergeRecord {
  /** 原块级 image 的 id（无 id 时为空串） */
  imageId: string;
  /** 识别出的原字（取自 alt 单字；无则为 undefined） */
  char?: string;
  /** 归并位置：复原被切断段落（前段+字图+后段三合一）/ 缝前段尾 / 缝后段头 */
  position: 'restore' | 'prev-end' | 'next-start';
}

/** 保留块级记录（判定未通过或无法归并） */
export interface GlyphImageKeptRecord {
  /** 原块级 image 的 id（无 id 时为空串） */
  id: string;
  /** 保留原因（中文，直接可展示） */
  reason: string;
}

/** 归一化报告 */
export interface GlyphImageReport {
  /** 已归并为行内字图的记录（按文档序） */
  merged: GlyphImageMergeRecord[];
  /** 保留块级的记录（按文档序） */
  kept: GlyphImageKeptRecord[];
}

/** 归一化结果：新文档（原档不可变）+ 报告 */
export interface NormalizeGlyphImagesResult {
  document: BookDocument;
  report: GlyphImageReport;
}

/** 段落收尾符：前段以此收尾时，缝在后段头上（字图属后段起头） */
const PARAGRAPH_CLOSERS = /[。！？；…”』」》〉】〕）…·—]$/u;

/** 归一化选项（内部全量形态） */
interface ResolvedOptions extends Required<Omit<GlyphImageDetectOptions, 'srcHints'>> {
  srcHints?: RegExp;
}

/** 用缺省值补齐选项 */
function resolveOptions(options?: GlyphImageDetectOptions): ResolvedOptions {
  const merged = { ...DEFAULT_GLYPH_IMAGE_OPTIONS, ...options };
  return {
    maxGlyphPx: merged.maxGlyphPx,
    aspectRange: merged.aspectRange,
    maxAltChars: merged.maxAltChars,
    srcHints: options?.srcHints ?? DEFAULT_GLYPH_IMAGE_OPTIONS.srcHints,
    merge: merged.merge,
  };
}

/** 读节点数字属性 */
function numAttr(node: BookNode, key: string): number | undefined {
  const value = node.attrs?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** 读节点字符串属性 */
function strAttr(node: BookNode, key: string): string | undefined {
  const value = node.attrs?.[key];
  return typeof value === 'string' ? value : undefined;
}

/** 扩展名是否为字图常见格式（照片插图一般 jpg/jpeg/webp） */
function isGlyphLikeExtension(src: string): boolean {
  const path = src.split(/[?#]/)[0] ?? '';
  return /\.(png|svg|gif)$/i.test(path);
}

/** src 是否为内嵌位图 data URI（docx / epub 导入的主流形态，取不到扩展名；
 * svg+xml 一并计入——EPUB 缺字图大量以内联 SVG 顶替，与位图同为「一字位小图」形态） */
function isEmbeddedBitmap(src: string): boolean {
  return /^data:image\/(png|gif|jpeg|webp|svg\+xml)[;,]/i.test(src);
}

/**
 * 判定块级 image 是否为字图候选
 *
 * @returns `undefined` = 判定字图；字符串 = 保留原因
 */
function keepReasonOf(
  node: BookNode,
  prev: BookNode | undefined,
  next: BookNode | undefined,
  options: ResolvedOptions,
): string | undefined {
  const src = strAttr(node, 'src');
  /* 无 src 是占位（渲染为空 img），既不是字图也不是插图，不动它 */
  if (src === undefined || src === '') return '占位图（无 src）';
  /* 排除项：caption 配对（图注跟随插图）与明确大图 */
  if (prev?.type === NODE_TYPES.CAPTION || next?.type === NODE_TYPES.CAPTION) {
    return '与图注配对（插图）';
  }
  const width = numAttr(node, 'width');
  const height = numAttr(node, 'height');
  const measured = [width, height].filter((v): v is number => v !== undefined);
  if (measured.some((v) => v > options.maxGlyphPx)) {
    return `尺寸 ${measured.join('×')} 超过字图阈值 ${options.maxGlyphPx}px（插图）`;
  }

  /* 强信号 */
  let strong = 0;
  const alt = strAttr(node, 'alt');
  if (alt !== undefined && alt.length > 0 && [...alt].length <= options.maxAltChars) strong += 1;
  if (measured.length === 2) {
    const [w, h] = measured;
    const ratio = w / h;
    if (
      ratio >= options.aspectRange[0] &&
      ratio <= options.aspectRange[1] &&
      w <= options.maxGlyphPx &&
      h <= options.maxGlyphPx
    ) {
      strong += 1;
    }
  }

  /* 弱信号 */
  let weak = 0;
  if (options.srcHints !== undefined && options.srcHints.test(src)) weak += 1;
  if (isGlyphLikeExtension(src)) weak += 1;
  if (isEmbeddedBitmap(src)) weak += 1;
  /* 位置信号：切断句子（前段未收尾）——插图几乎不出现在句中，缺字图的主流落位。
   * 仅在该图无任何尺寸元数据时计入（有尺寸时尺寸本身就是更硬的证据，不重复计分） */
  if (measured.length === 0 && prev?.type === NODE_TYPES.PARAGRAPH && !prevParagraphClosed(prev)) {
    weak += 1;
  }

  if (strong >= 1) return undefined;
  if (weak >= 2) return undefined;
  return `仅有 ${weak} 条弱信号（保守保留，可调阈值重跑）`;
}

/** 前段末字符是否收尾（收尾 → 缝属后段起头） */
function prevParagraphClosed(prev: BookNode): boolean {
  const last = prev.children?.[prev.children.length - 1];
  const text = last !== undefined && typeof last.text === 'string' ? last.text : '';
  return text !== '' && PARAGRAPH_CLOSERS.test(text.slice(-1));
}

/** 块级 image → 行内字图节点（id / 原始尺寸保留，char 取 alt 单字） */
function toGlyphImage(node: BookNode): BookNode {
  const alt = strAttr(node, 'alt');
  const chars = alt !== undefined ? [...alt] : [];
  const char = alt !== undefined && chars.length === 1 ? alt : undefined;
  const attrs: Attrs = {};
  const src = strAttr(node, 'src');
  if (src !== undefined) attrs.src = src;
  if (alt !== undefined) attrs.alt = alt;
  if (char !== undefined) attrs.char = char;
  const width = numAttr(node, 'width');
  const height = numAttr(node, 'height');
  if (width !== undefined) attrs.width = width;
  if (height !== undefined) attrs.height = height;
  return {
    type: NODE_TYPES.GLYPH_IMAGE,
    ...(node.id !== undefined ? { id: node.id } : {}),
    ...(Object.keys(attrs).length > 0 ? { attrs } : {}),
  };
}

/**
 * 把判定为字图的节点并入相邻段落（就地改传入数组）
 *
 * `auto` 且两侧都是段落、前段未收尾 → 前段 + 字图 + 后段三合一（复原被切断
 * 的段落，`position: 'restore'`）；否则缝前段尾 / 后段头。
 *
 * @returns true = 归并成功（节点已从 siblings 移除）
 */
function mergeIntoSibling(
  siblings: BookNode[],
  index: number,
  node: BookNode,
  options: ResolvedOptions,
): { merged: boolean; position?: 'restore' | 'prev-end' | 'next-start' } {
  const prev = index > 0 ? siblings[index - 1] : undefined;
  const next = index < siblings.length - 1 ? siblings[index + 1] : undefined;
  const glyph = toGlyphImage(node);
  if (
    options.merge === 'auto' &&
    prev?.type === NODE_TYPES.PARAGRAPH &&
    !prevParagraphClosed(prev) &&
    next?.type === NODE_TYPES.PARAGRAPH
  ) {
    prev.children = [...(prev.children ?? []), glyph, ...(next.children ?? [])];
    siblings.splice(index, 2); // 字图与后段都并入前段
    return { merged: true, position: 'restore' };
  }
  const wantPrev = options.merge === 'prev' || options.merge === 'auto';
  const wantNext = options.merge === 'next' || options.merge === 'auto';
  if (
    wantPrev &&
    prev?.type === NODE_TYPES.PARAGRAPH &&
    (options.merge === 'prev' || !prevParagraphClosed(prev))
  ) {
    prev.children = [...(prev.children ?? []), glyph];
    siblings.splice(index, 1);
    return { merged: true, position: 'prev-end' };
  }
  if (wantNext && next?.type === NODE_TYPES.PARAGRAPH) {
    next.children = [glyph, ...(next.children ?? [])];
    siblings.splice(index, 1);
    return { merged: true, position: 'next-start' };
  }
  return { merged: false };
}

/** 在一层兄弟序列中扫描块级 image 并归并（index 走 while：删除后数组变短） */
function mergeSiblingsLevel(
  siblings: BookNode[],
  options: ResolvedOptions,
  report: GlyphImageReport,
): void {
  let index = 0;
  while (index < siblings.length) {
    const node = siblings[index]!;
    if (node.type === NODE_TYPES.IMAGE) {
      const prev = index > 0 ? siblings[index - 1] : undefined;
      const next = index < siblings.length - 1 ? siblings[index + 1] : undefined;
      const reason = keepReasonOf(node, prev, next, options);
      if (reason !== undefined) {
        report.kept.push({ id: node.id ?? '', reason });
      } else {
        const result = mergeIntoSibling(siblings, index, node, options);
        if (result.merged) {
          const alt = strAttr(node, 'alt');
          report.merged.push({
            imageId: node.id ?? '',
            char: alt !== undefined && [...alt].length === 1 ? alt : undefined,
            position: result.position!,
          });
          continue; // 已删除当前项，不推进 index
        }
        report.kept.push({ id: node.id ?? '', reason: '前后无段落可归并（保留块级）' });
      }
    }
    index += 1;
  }
}

/** 递归：先扫本层兄弟序列，再深入容器子节点 */
function walk(node: BookNode, options: ResolvedOptions, report: GlyphImageReport): void {
  if (node.children === undefined) return;
  mergeSiblingsLevel(node.children, options, report);
  for (const child of node.children) walk(child, options, report);
}

/**
 * 归一化文档中的字图（K6）
 *
 * 扫描全部块级 `image` 节点，把符合字图特征的转为行内 `glyph-image` 并入相邻
 * 段落；不确定的保守保留并进报告。返回新文档，入参不可变。
 *
 * @example
 * const { document, report } = normalizeGlyphImages(doc);
 * // report.merged: [{ imageId: 'img-7', char: '贔', position: 'prev-end' }]
 */
export function normalizeGlyphImages(
  doc: BookDocument,
  options?: GlyphImageDetectOptions,
): NormalizeGlyphImagesResult {
  const resolved = resolveOptions(options);
  const report: GlyphImageReport = { merged: [], kept: [] };
  const clone = structuredClone(doc);
  walk(clone.root, resolved, report);
  return { document: clone, report };
}

/**
 * 报告 → 中文摘要（导入面板 / 日志直接展示）
 *
 * @example
 * summarizeGlyphImageReport(report); // '已将 3 张缺字图归入文字流；2 张按插图保留'
 */
export function summarizeGlyphImageReport(report: GlyphImageReport): string {
  const parts: string[] = [];
  if (report.merged.length > 0) parts.push(`已将 ${report.merged.length} 张缺字图归入文字流`);
  if (report.kept.length > 0) parts.push(`${report.kept.length} 张按插图保留`);
  return parts.length > 0 ? parts.join('；') : '未发现缺字图';
}
