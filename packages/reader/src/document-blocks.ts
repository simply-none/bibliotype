/**
 * 文档块提取（BookDocument → MeasurableBlock[]）
 *
 * 将 IR 树展开为线性可测量块序列，供 layout.paginate 分页：
 * - 结构容器（卷/章/节）逐层深入，其首个叶块标记 breakBefore（章首另起页）；
 * - 叶块（纯文本容器，如段落/标题/注文）各自成块；
 * - 标题块标记 keepWithNext（与下段同页）；
 * - 尺寸估算可插拔（默认按文本长度 × 每行字符数估算行数）。
 */
import { NODE_TYPES, isTextNode, type BookDocument, type BookNode } from '@bibliotype/core';
import type { MeasurableBlock } from '@bibliotype/layout';

/** 结构容器类型（其首个叶块另起页） */
const STRUCTURE_TYPES: ReadonlySet<string> = new Set([
  NODE_TYPES.VOLUME,
  NODE_TYPES.CHAPTER,
  NODE_TYPES.SECTION,
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
}

/** 当前处理中的叶块标记 */
interface PendingFlags {
  breakBefore?: boolean;
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
  const context: BlockMeasureContext = {
    ...DEFAULT_MEASURE_CONTEXT,
    ...options.context,
  };

  const blocks: MeasurableBlock[] = [];

  const walk = (node: BookNode, path: string, flags: PendingFlags): void => {
    const elementChildren = (node.children ?? []).filter((child) => !isTextNode(child));

    if (elementChildren.length === 0) {
      // 空书根不产块；其余叶块（或空容器）产出可测量块
      if (node.type === NODE_TYPES.BOOK) return;
      blocks.push({
        id: node.id ?? path,
        mainSize: estimator(node, context),
        ...(flags.breakBefore === true ? { breakBefore: true } : {}),
        ...(node.type === NODE_TYPES.HEADING ? { keepWithNext: true } : {}),
      });
      return;
    }

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
