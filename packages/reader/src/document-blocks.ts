/**
 * 文档块提取（BookDocument → MeasurableBlock[]）
 *
 * 将 IR 树展开为线性可测量块序列，供 layout.paginate 分页：
 * - 结构容器（结构页/卷/章/节/序/附录/后记/目录）逐层深入，
 *   其首个叶块标记 breakBefore（另起页）；
 * - 叶块（纯文本容器，如段落/标题/注文）各自成块；
 *   含「行内载体」子元素的块不拆开（载体随父块整体渲染与度量）；
 *   版式文本容器（注文/牌记/题记）无论子级形态恒整体成块（防
 *   编辑保存的「容器 + 段落」规范化导致容器样式与稳定 id 丢失）；
 * - 标题块标记 keepWithNext（与下段同页）；
 * - 尺寸估算可插拔（默认按文本长度 × 每行字符数估算行数）。
 */
import { NODE_TYPES, isTextNode, type BookDocument, type BookNode } from '@bibliotype/core';
import type { MeasurableBlock } from '@bibliotype/layout';

/** 结构容器类型（其首个叶块另起页） */
const STRUCTURE_TYPES: ReadonlySet<string> = new Set([
  NODE_TYPES.COVER,
  NODE_TYPES.TITLE_PAGE,
  NODE_TYPES.COPYRIGHT_PAGE,
  NODE_TYPES.BACK_COVER,
  NODE_TYPES.VOLUME,
  NODE_TYPES.CHAPTER,
  NODE_TYPES.SECTION,
  NODE_TYPES.PREFACE,
  NODE_TYPES.POSTSCRIPT,
  NODE_TYPES.APPENDIX,
  NODE_TYPES.TOC,
]);

/**
 * 版式文本容器类型（渲染时必须整体成块）
 *
 * 这类容器的版式语义附着在容器自身（如双行注分栏小字、脚注注线、
 * 校勘记出校边框、题记下缘线）：编辑保存链路会把容器内直挂文本规范
 * 化为「容器 + 段落」（编辑器严格树），若仍按「含元素子节点即逐层
 * 深入」处理，容器将退居中间层而不入块序列——容器样式随之丢失，
 * 稳定 id 也退化为内部无 id 段落的路径 id。
 * 故此处显式声明：无论子级是直挂文本还是段落，都整体成块（渲染与
 * 导出时连容器 class 一并序列化）。结构容器（卷/章等）与列表 / 表格 /
 * 引文等复合块仍走逐层深入策略。
 *
 * 古籍类型以 kebab-case 字符串表列（reader 不依赖 @bibliotype/classical）。
 */
const TEXT_CONTAINER_TYPES: ReadonlySet<string> = new Set([
  /* core 注释 */
  NODE_TYPES.FOOTNOTE,
  NODE_TYPES.ENDNOTE,
  NODE_TYPES.MARGIN_NOTE,
  /* classical 注疏与版记 */
  'double-note',
  'head-note',
  'tail-note',
  'collation-note',
  'imprint',
  'colophon',
]);

/** 尺寸估算上下文 */
export interface BlockMeasureContext {
  /** 每行可容纳字符数（按页面主轴与字号估算） */
  charsPerLine: number;
  /** 每行主轴尺寸（行高，px） */
  lineSize: number;
  /** 块间附加间距（px） */
  blockSpacing: number;
}

/** 默认估算上下文（16px 字号 × 1.9 行高，A5 单栏近似） */
export const DEFAULT_MEASURE_CONTEXT: BlockMeasureContext = {
  charsPerLine: 26,
  lineSize: 30,
  blockSpacing: 12,
};

/** 块尺寸估算器（可插拔：接入 DOM 实测或字体度量时替换） */
export type BlockSizeEstimator = (
  node: BookNode,
  context: BlockMeasureContext,
) => number;

/** 递归收集节点全部文本 */
export function collectNodeText(node: BookNode): string {
  if (isTextNode(node)) return node.text ?? '';
  return (node.children ?? []).map(collectNodeText).join('');
}

/** 默认估算器：按字符数折算行数 */
export const defaultEstimator: BlockSizeEstimator = (node, context) => {
  const length = collectNodeText(node).length;
  const lines = Math.max(1, Math.ceil(length / Math.max(1, context.charsPerLine)));
  return lines * context.lineSize + context.blockSpacing;
};

/** 块提取选项 */
export interface ExtractBlocksOptions {
  /** 自定义估算器（默认 defaultEstimator） */
  estimator?: BlockSizeEstimator;
  /** 估算上下文覆盖 */
  context?: Partial<BlockMeasureContext>;
  /**
   * 按块 id 给定的实测主轴尺寸（px）
   *
   * 渲染层（DOM 实测）产出「块 id → 真实尺寸」映射并传入：命中且为正数时
   * 直接采用实测值，否则回退到 estimator 估算。用于让分页归属与真实渲染一致，
   * 消除按字符数估算导致的预览裁切 / 空白。分块结构与 flags 不受影响。
   */
  blockSizes?: ReadonlyMap<string, number>;
}

/** 当前处理中的叶块标记 */
interface PendingFlags {
  breakBefore?: boolean;
}

/**
 * 叶块判定：版式文本容器；无元素子节点；或含与元素子节点混排的文本
 *
 * 第二类对应「行内载体」场景（如段落文本中嵌校勘符号/避讳字载体）：
 * 拆开会丢失与载体混排的裸文本，故整块渲染与度量。
 * 第一类（注文 / 牌记 / 题记）恒整体成块：子级无论是直挂文本还是
 * 编辑保存后规范化的段落，容器样式与稳定 id 都不能丢。
 * 纯元素容器（卷/章等结构容器，及列表 / 表格 / 引文等复合块）仍逐层深入。
 * 与 extractBlocks 的分块规则保持一致（findNodeById / indexNodeAnchors 复用）。
 */
export function isLeafBlock(node: BookNode): boolean {
  if (TEXT_CONTAINER_TYPES.has(node.type)) {
    return true;
  }
  const children = node.children ?? [];
  const hasElement = children.some((child) => !isTextNode(child));
  return !hasElement || children.some(isTextNode);
}

/**
 * 把文档树展开为块序列
 *
 * 块 id 优先取节点 id；无 id 时按树路径生成（如 "/0/1/2"），
 * 保证同一文档多次提取结果稳定（目录跳转依赖其确定性）。
 */
export function extractBlocks(
  doc: BookDocument,
  options: ExtractBlocksOptions = {},
): MeasurableBlock[] {
  const estimator = options.estimator ?? defaultEstimator;
  const blockSizes = options.blockSizes;
  const context: BlockMeasureContext = {
    ...DEFAULT_MEASURE_CONTEXT,
    ...options.context,
  };

  const blocks: MeasurableBlock[] = [];

  const walk = (node: BookNode, path: string, flags: PendingFlags): void => {
    if (isLeafBlock(node)) {
      // 空书根不产块；其余叶块（或空容器）产出可测量块
      if (node.type === NODE_TYPES.BOOK) return;
      const id = node.id ?? path;
      // 实测尺寸优先（命中且为正），否则回退估算
      const measured = blockSizes?.get(id);
      blocks.push({
        id,
        mainSize: measured !== undefined && measured > 0 ? measured : estimator(node, context),
        ...(flags.breakBefore === true ? { breakBefore: true } : {}),
        ...(node.type === NODE_TYPES.HEADING ? { keepWithNext: true } : {}),
      });
      return;
    }

    const elementChildren = (node.children ?? []).filter((child) => !isTextNode(child));
    const isStructure = STRUCTURE_TYPES.has(node.type);
    let first = true;
    elementChildren.forEach((child, index) => {
      walk(child, `${path}/${index}`, {
        breakBefore: isStructure && first ? true : undefined,
      });
      first = false;
    });
  };

  walk(doc.root, '', {});
  return blocks;
}
