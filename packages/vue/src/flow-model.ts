/**
 * 流式阅读视图模型（D5，纯函数无 DOM 依赖）
 *
 * 把「分块 → 估算高度 → 计算视口挂载窗口 → 锚点定位 → 滚动补偿」拆成可单测的
 * 纯函数，组件只负责把结果落到 DOM，宿主也能整体替换（如用真实度量替代估算）。
 */
import type { FlowChunk } from '@bibliotype/reader';

/** 估算单个分块高度所需的版式度量 */
export interface FlowMetrics {
  /** 正文列宽（px），用于推算每行字数 */
  width: number;
  /** 正文字号（px） */
  fontSize: number;
  /** 行高倍率（相对字号，如 1.8） */
  lineHeight: number;
  /** 段间距（px）；缺省按 `fontSize * 0.9` 推算 */
  paragraphSpacing?: number;
}

/** 缺省度量（非法输入时回落，避免 NaN 撑爆滚动条） */
const FALLBACK_METRICS: Required<Omit<FlowMetrics, 'width'>> = {
  fontSize: 16,
  lineHeight: 1.8,
  paragraphSpacing: 14.4,
};

/**
 * 估算一个分块高度（px）
 *
 * 公式：`ceil(字数 / 每行字数) × 行高 + 段数 × 段间距`；加权不依赖真实 DOM，
 * 仅作骨架占位用，挂载后用 `ResizeObserver` 实测覆盖。空分块返回 0。
 */
export function estimateFlowChunkHeight(chunk: FlowChunk, metrics: FlowMetrics): number {
  const width = Number.isFinite(metrics.width) && metrics.width > 0 ? metrics.width : 640;
  const fontSize =
    Number.isFinite(metrics.fontSize) && metrics.fontSize > 0
      ? metrics.fontSize
      : FALLBACK_METRICS.fontSize;
  const lineHeight =
    Number.isFinite(metrics.lineHeight) && metrics.lineHeight > 0
      ? metrics.lineHeight
      : FALLBACK_METRICS.lineHeight;
  const paragraphSpacing =
    Number.isFinite(metrics.paragraphSpacing) && metrics.paragraphSpacing! > 0
      ? metrics.paragraphSpacing!
      : FALLBACK_METRICS.paragraphSpacing;
  if (chunk.charCount <= 0) return 0;
  const blockCount = chunk.nodes.length > 0 ? chunk.nodes.length : chunk.nodeIds.length;
  if (blockCount === 0) return 0;
  const charsPerLine = Math.max(1, Math.floor(width / fontSize));
  const lines = Math.max(1, Math.ceil(chunk.charCount / charsPerLine));
  return lines * fontSize * lineHeight + blockCount * paragraphSpacing;
}

/** 挂载窗口（含首尾索引，闭区间） */
export interface FlowMountWindow {
  /** 首个需挂载的分块序号（含） */
  start: number;
  /** 末个需挂载的分块序号（含）；为 -1 表示无 */
  end: number;
}

/** 计算挂载窗口的输入 */
export interface ResolveMountWindowInput {
  /** 各分块顶部绝对偏移（与 `heights` 等长；索引即分块序号） */
  offsets: readonly number[];
  /** 各分块当前高度（已挂载为实测、未挂载为估算；缺失按 0） */
  heights: readonly number[];
  /** 当前滚动位置（px） */
  scrollTop: number;
  /** 视口高度（px） */
  viewportHeight: number;
  /** 视口外额外预挂载余量（px），缺省 800 */
  overscan?: number;
}

/**
 * 计算当前应挂载的分块区间
 *
 * 采用线性扫描（分块数通常数百，单帧成本可忽略），对「上方块高度变化」也安全。
 * 区间闭合 `[start, end]`，`end = -1` 表示无内容。
 */
export function resolveMountWindow(input: ResolveMountWindowInput): FlowMountWindow {
  const { offsets, heights, scrollTop, viewportHeight } = input;
  const overscan = input.overscan ?? 800;
  const n = offsets.length;
  if (n === 0) return { start: 0, end: -1 };
  const top = scrollTop - overscan;
  const bottom = scrollTop + viewportHeight + overscan;
  let start = -1;
  let end = -1;
  for (let i = 0; i < n; i += 1) {
    const offset = offsets[i]!;
    // 块整体落在视口下方：其后块更靠下，停止扫描
    if (offset > bottom) break;
    // 块整体落在视口上方：继续
    if (offset + (heights[i] ?? 0) < top) continue;
    if (start === -1) start = i;
    end = i;
  }
  if (start === -1) start = 0;
  return { start, end };
}

/**
 * 解析锚点所在分块序号
 *
 * 优先精确匹配分块内块 id（含合成 `flow-*`）或章容器 id；命中返回索引，
 * 否则返回 -1（宿主可在挂载全部后重试，或回落分页页码）。
 */
export function resolveAnchorChunkIndex(
  chunks: readonly FlowChunk[],
  nodeId: string,
): number {
  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i]!;
    if (chunk.containerId === nodeId) return i;
    if (chunk.nodeIds.includes(nodeId)) return i;
  }
  return -1;
}

/** 滚动补偿输入 */
export interface AdjustScrollOffsetInput {
  /** 变化前的各分块高度 */
  previousHeights: readonly number[];
  /** 变化后的各分块高度 */
  heights: readonly number[];
  /** 锚点分块序号（其上方高度变化需补偿到 scrollTop） */
  anchorIndex: number;
  /** 当前滚动位置 */
  scrollTop: number;
}

/**
 * 计算滚动补偿值：锚点分块上方高度变化量
 *
 * 分块实测高度回写后，若其上方的累计高度变了，需把 `scrollTop` 偏移相同量，
 * 使「用户正在读的那一段」视觉位置不变。返回应加到 `scrollTop` 的增量。
 */
export function adjustScrollOffset(input: AdjustScrollOffsetInput): number {
  const { previousHeights, heights, anchorIndex, scrollTop } = input;
  let delta = 0;
  const count = Math.min(anchorIndex, previousHeights.length, heights.length);
  for (let i = 0; i < count; i += 1) {
    delta += (heights[i] ?? 0) - (previousHeights[i] ?? 0);
  }
  return scrollTop + delta;
}

/** 累加 `[0, index)` 的高度（用于计算某分块顶部偏移） */
export function sumHeights(heights: readonly number[], index: number): number {
  let sum = 0;
  const end = Math.min(index, heights.length);
  for (let i = 0; i < end; i += 1) sum += heights[i] ?? 0;
  return sum;
}
