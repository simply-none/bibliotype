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

/**
 * 恒整块呈现（不跨页拆分）的块类型
 *
 * 分页器只在块标记 `splittable` 时按行拆分；此前仅 `paragraph` 标记，
 * 于是任何「整章 / 整节坍成一个叶块」的容器（卷 / 章 / 节 / 前言等，
 * 常见于导入的 HTML：块级元素间夹换行空白、或正文直接裸挂在容器下）
 * 都只能整块塞进一页。直排页宽（列数）远小于横排页高（行数），
 * 被 `overflow: hidden` 裁掉后几乎看不到字，表现为「后半本 / 某章之后
 * 一片空白」，而横排因一页能容纳更多行看起来「只是短暂空白」。
 *
 * 故改为反向白名单：**除版式块外，含文本的叶块都可按行跨页**。
 * 版式块保持整块：标题（配合 keepWithNext 孤寡行控制）、图片、分隔线、
 * 封面 / 书名页 / 版权页 / 封底（单页版面），以及注文 / 牌记 / 题记
 * 等文本容器（版式语义附着在容器自身，拆开会丢样式）。
 */
const ATOMIC_BLOCK_TYPES: ReadonlySet<string> = new Set([
  NODE_TYPES.HEADING,
  NODE_TYPES.IMAGE,
  NODE_TYPES.BREAK,
  NODE_TYPES.COVER,
  NODE_TYPES.TITLE_PAGE,
  NODE_TYPES.COPYRIGHT_PAGE,
  NODE_TYPES.BACK_COVER,
  ...TEXT_CONTAINER_TYPES,
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
  /**
   * 块 → 每行起始字符偏移表（DOM 实测，与 blockSizes 同源产出）
   *
   * 可拆段落命中实测尺寸且有实测多行时，行数由此显式给定（lineCount），行高
   * 优先取 lineSizes（未命中回退「实测推进量 ÷ 真实行数」均高）：估算行高
   * （如 16px×1.9 取整 30 ≠ 实渲 30.4）会使 paginate round(mainSize/lineSize)
   * 多出幽灵行、页底空白逐段累积，改用实测口径后行数精确。未命中回退
   * context.lineSize。
   */
  lineOffsets?: ReadonlyMap<string, number[]>;
  /**
   * 块 id → 真实行高（px，DOM 实测：块自身高度 ÷ 真实行数，不含块间距）
   *
   * blockSizes 是到下一块的「推进量」（含折叠外边距），若用它除以行数会
   * 把块间距摊进行高，使 paginate 的 floor(avail/lineSize) 每页少放 1~2 行、
   * 页底留白；命中本映射时行高改用真实值，行数另由 lineOffsets 显式给定
   * （lineCount），块尾余量（间距）由 paginate 在末片段一次性结算。
   */
  lineSizes?: ReadonlyMap<string, number>;
  /**
   * 块 id → 块体高（px，DOM 实测自身盒高，不含任何外边距；与 blockSizes 同源产出）
   *
   * blockSizes 是到下一块上缘的「推进量」，已含与下一块的折叠外边距；那份间距
   * 无论本块留在本页还是换页都已被前一块的入账额支付，因而「往本页追加一块」
   * 的真实代价只是体高。命中本映射时给出 bodyMainSize，供 paginate 按体高判页，
   * 消除每页虚耗一份间距带来的页底空白（标题 UA 外边距 / 段后距可达半行～一行）。
   */
  bodySizes?: ReadonlyMap<string, number>;
}

/**
 * 分页符变体值（与 editor 的 `insertPageBreak` / `PAGE_BREAK_VARIANT` 同口径）
 *
 * reader 不依赖 @bibliotype/editor，故此处以字面量表列：`break(variant='page')`
 * 的叶块恒置 `breakAfter`，其后一块从新页页首起排（横排 / 直排同一逻辑，
 * 主轴方向由 layout.paginate 的调用方按书写方向传尺寸）。
 */
const PAGE_BREAK_VARIANT = 'page';

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
  // 结构容器（卷 / 章 / 节等）：仅「含实质裸文本」才整体成块。导入的 HTML / DOCX 几乎
  // 每个块级元素间都夹着换行 / 缩进等纯空白文本节点；若把它们也算作「混排文本」，整个
  // 章节会被判成一个叶块 → 一行都不拆、整章挤在一页后被裁切，后续章节内容被吞没（页数
  // 塌成接近章节数、后半本变空白）。纯空白文本不阻碍逐层下钻，只有真正的裸文本（无元素
  // 包裹、拆开会丢字的行内载体）才保护成整块；空结构容器则不下钻也不产块（不生成空页）。
  if (STRUCTURE_TYPES.has(node.type)) {
    return children.some((child) => isTextNode(child) && (child.text ?? '').trim() !== '');
  }
  return !hasElement || children.some(isTextNode);
}

/**
 * 按「节点类型名」判定是否为版式文本容器（恒整体成块）。
 *
 * 供渲染层（ProseMirror DOM 遍历）复用，使「块 → DOM 元素」的叶块口径与
 * extractBlocks 严格一致：注文 / 牌记 / 题记等容器在 IR 侧只出一个块、不下钻，
 * DOM 侧也必须把它当叶块整体取用（否则其内部段落被拆成多块，序列错位）。
 */
export function isLeafBlockTypeName(typeName: string): boolean {
  return TEXT_CONTAINER_TYPES.has(typeName);
}

/** extractBlocksIndexed 结果：块序列 + 块 id → 源节点索引 */
export interface ExtractedBlocks {
  /** 线性块序列（与 extractBlocks 输出一致） */
  blocks: MeasurableBlock[];
  /** 块 id → 源 IR 节点（id 口径与 blocks 一致；供切片 / 渲染免二次全树查找） */
  nodeById: Map<string, BookNode>;
}

/**
 * 把文档树展开为块序列，同时产出「块 id → 源节点」索引
 *
 * 块 id 优先取节点 id；无 id 时按树路径生成（如 "/0/1/2"），
 * 保证同一文档多次提取结果稳定（目录跳转依赖其确定性）。
 *
 * 索引版供高频管线（分页量尺 / 编辑态切片）复用：一次遍历同时拿到
 * 块序列与节点映射，替代逐块 findNodeById 的 O(N²) 全树查找。
 */
export function extractBlocksIndexed(
  doc: BookDocument,
  options: ExtractBlocksOptions = {},
): ExtractedBlocks {
  const estimator = options.estimator ?? defaultEstimator;
  const blockSizes = options.blockSizes;
  const lineOffsets = options.lineOffsets;
  const lineSizes = options.lineSizes;
  const bodySizes = options.bodySizes;
  const context: BlockMeasureContext = {
    ...DEFAULT_MEASURE_CONTEXT,
    ...options.context,
  };

  const blocks: MeasurableBlock[] = [];
  const nodeById = new Map<string, BookNode>();

  const walk = (node: BookNode, path: string, flags: PendingFlags): void => {
    if (isLeafBlock(node)) {
      // 空书根不产块；其余叶块（或空容器）产出可测量块
      if (node.type === NODE_TYPES.BOOK) return;
      const id = node.id ?? path;
      nodeById.set(id, node);
      // 实测尺寸优先（命中且为正），否则回退估算
      const measured = blockSizes?.get(id);
      const hasMeasured = measured !== undefined && measured > 0;
      // 可按行跨页续排（纸书逻辑）：正文段落与任何「整章坍成叶块」的容器（卷 / 章 /
      // 节 / 前言等）都标 splittable + 行高，供 paginate 行级拆分。只按 paragraph
      // 判定时，整章块不可拆、只能一整页盛放，直排页宽小 → 被裁成「看起来空白」。
      // 标题 / 注文 / 牌记 / 封面等版式块恒整块呈现（见 ATOMIC_BLOCK_TYPES），不标。
      const splittable = !ATOMIC_BLOCK_TYPES.has(node.type);
      // 分页符（break variant=page）：自身成一标记块，并强制其后一块另起一页
      const isPageBreak =
        node.type === NODE_TYPES.BREAK && node.attrs?.['variant'] === PAGE_BREAK_VARIANT;
      // 可拆段：行高用真实实测值（不含块间距），行数用实测行边界显式给定，
      // 消除「推进量÷行数」把间距摊入行高导致的每页少放 1~2 行页底空白
      const lines = lineOffsets?.get(id)?.length ?? 0;
      let lineSize = context.lineSize;
      if (splittable && hasMeasured && lines > 1) {
        lineSize = lineSizes?.get(id) ?? (measured as number) / lines;
      }
      // 页内追加代价：mainSize 是到下一块上缘的「推进量」（已含与下一块的折叠间距），
      // 那份间距在前一块的入账里就已被支付，故往本页追加一块的代价只取块体高
      const advance = hasMeasured ? (measured as number) : estimator(node, context);
      let bodyMainSize: number | undefined;
      if (hasMeasured) {
        // 实测口径：优先取量尺直接实测的体高；未命中时按「行数 × 真实行高」折算
        // （与量尺同源）。推进量与体高相差不足 0.5px 属亚像素噪声，不产出字段
        const direct = bodySizes?.get(id) ?? 0;
        const body =
          direct > 0
            ? direct
            : splittable && lines > 1
              ? lines * lineSize
              : 0;
        if (body > 0 && advance - body >= 0.5) bodyMainSize = body;
      } else {
        // 估算口径：defaultEstimator 产出「行数 × 行高 + 块间距」，按行高向下折算即体高
        // （与 paginate.lineCountOf 的 floor 折算同源，不会多扣 blockSpacing）
        const body = Math.max(1, Math.floor(advance / lineSize)) * lineSize;
        if (advance - body >= 0.5) bodyMainSize = body;
      }
      blocks.push({
        id,
        mainSize: advance,
        ...(splittable
          ? {
              splittable: true,
              lineSize,
              ...(hasMeasured && lines > 1 ? { lineCount: lines } : {}),
            }
          : {}),
        ...(bodyMainSize !== undefined ? { bodyMainSize } : {}),
        // 分页符自身不带走一页：它的 breakAfter 已保证后继另起一页，自身再
        // breakBefore（如它正好是结构容器首块）会只让它独占一页、中间多出一张空白页
        ...(flags.breakBefore === true && !isPageBreak ? { breakBefore: true } : {}),
        ...(isPageBreak ? { breakAfter: true } : {}),
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
  return { blocks, nodeById };
}

/**
 * 把文档树展开为块序列（extractBlocksIndexed 的便捷封装）
 */
export function extractBlocks(
  doc: BookDocument,
  options: ExtractBlocksOptions = {},
): MeasurableBlock[] {
  return extractBlocksIndexed(doc, options).blocks;
}
