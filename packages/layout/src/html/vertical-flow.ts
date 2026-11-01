/**
 * 直排行内流序列化（古籍直排 v2 批 2）
 *
 * **为什么是行内流**：CSS 直排块流中每个块级段落独占整列（段段换列、
 * 版面半空），而古籍正文各段同列连排、段界靠格位标记（低格 / 抬头 / 提行）。
 * 本序列化器把页片段改写为**行内流**：段落 → 行内 span，双行夹注 →
 * 1 大字位宽 × 动态高度的多对双列小字盒（{@link planDoubleNoteColumns}
 * 按列容量拆右 / 左子列——竖排 block 流自右向左，DOM 序即阅读序；直排
 * multicol 轴向不可靠，已实测排除），提行 / 平抬 → `<br>` 断列，抬升 /
 * 低格 → 段首空位盒。容器（`.bt-vflow`）在 `writing-mode: vertical-rl`
 * 下自然换列，列宽由根行高（= 列距）决定——与界行网格天然咬合。
 *
 * 段落行内化的代价与取舍：块级 margin / 块级样式随盒消失，段界语义全部由
 * 行内标记承载（空位 / 断列），这是古籍行款的原生形态（连排本无段间距）。
 * 章题同样连排（提行 + 题文，列内接排正文）；版式块（牌记 / 眉批 / 表格 /
 * 图）不参与连排，原样整块输出（保持既有样式）。
 *
 * 消费方：预览 `BtBookView`（直排分支）、量尺 `pagination-measure`（同形态
 * 实测——行边界与夹注原子性自洽）、导出 paged 与打印同源。
 */
import { NODE_TYPES, isTextNode, type BookNode } from '@bibliotype/core';
import { planDoubleNoteColumns, collectNodeTextOf } from '../double-note-split.js';
import { escapeHtml, serializeNode, type SerializeNodeOptions } from './html-serializer.js';
import { sliceNodeByCharRange } from '../node-slice.js';
import { resolveLineRule, flowBoundarySlots, type LineRule } from '../line-rules.js';

/** 行内流序列化选项 */
export interface SerializeVerticalFlowOptions {
  /** 每行大字数（版心高 ÷ 字位步进；夹注每子列小字容量 = 本值 × 2） */
  charsPerColumn: number;
  /**
   * 续排片段：跳过行款前缀（空位 / 断列）
   *
   * 行切片的续页片段（fromLine > 0）是段落中段——低格 / 抬头属于段首，
   * 重发会造成续页重复缩进；调用方（分页画布）按片段起点传值。
   */
  omitRulePrefix?: boolean;
  /**
   * 行内节点序列化选项透传（tagOverrides / rewriteSrc / verticalText /
   * revisionView）——导出路径与预览共享同一序列化行为
   */
  nodeOptions?: SerializeNodeOptions;
}

/** 双行夹注类型（classical 插件节点，layout 不依赖 classical，按 kebab-case 字符串表列——与 reader 分块口径一致） */
const DOUBLE_NOTE_TYPE = 'double-note';

/** 携带行款规则的连排段落（正文段落 + 引文） */
const FLOW_PARAGRAPH_TYPES: ReadonlySet<string> = new Set([
  NODE_TYPES.PARAGRAPH,
  NODE_TYPES.QUOTE,
]);

/**
 * 章题（heading）：随文连排，但**自带提行**
 *
 * 古籍直排的章题是「另起一列顶格起写的一句」，列内继续接排正文——不是
 * 独占整列的版式块。块级呈现的代价是每道题白扔一整列（2em 字号 × 继承的
 * 行高比例 = 2 列），满版目标的首要残源。
 */
const FLOW_HEADING_TYPES: ReadonlySet<string> = new Set([NODE_TYPES.HEADING]);

/**
 * 节点是否参与行内流连排（段落 / 引文 / 章题）
 *
 * 供渲染通道判定（预览 / 编辑画布 / 打印 / 量尺同口径）：命中者以行内流
 * 序列化并作行内呈现，其余（表格 / 图 / 注文 / 牌记 / 眉批…）保持整块。
 */
export function isFlowInlineType(type: string): boolean {
  return FLOW_PARAGRAPH_TYPES.has(type) || FLOW_HEADING_TYPES.has(type);
}

/**
 * 是否为携带行款规则的连排段落（低格 / 抬头 / 提行语义只属于段落，章题恒提行）
 *
 * 分页器据此区分「断列来源」：非本类型（含章题 / 表格 / 图 / 注文）在直排流
 * 里必落列首，需要 `breakColumn` 对齐列宽。
 */
export function isFlowParagraphType(type: string): boolean {
  return FLOW_PARAGRAPH_TYPES.has(type);
}

/** 空位盒：N 字位高（1em 宽）——低格 / 挪抬的列首空位与抬升列首 */
function padBox(n: number): string {
  return `<span class="bt-vpad" data-n="${n}"></span>`;
}

/** 抬头断列标记：`<br>` 另起一列 + 列首空位盒（高出 N 字 = 顶格降 N 字起写） */
function liftPrefix(rule: LineRule): string {
  if (rule.breakLine || rule.lift === 'newline') {
    const pad = rule.lift === 'newline' ? rule.liftLevel : 0;
    return `<br class="bt-vbreak">${pad > 0 ? padBox(pad) : ''}`;
  }
  return '';
}

/**
 * 双行夹注 → 1 字位宽 × 动态高度的多对双列小字盒
 *
 * 按「每子列容量 = 每行大字数 × 2」拆右 / 左子列（右列满读到底续左列，
 * 「从上排到底」的古籍形制）；竖排 block 流自右向左，DOM 序即阅读序。
 * 超过一对容量的注文继续输出后续对（古籍超长注占多字位，每对 1 大字位宽）。
 *
 * 切分窗口由 {@link planDoubleNoteColumns} 一次算清（UTF-16 码元轴，与
 * `sliceNodeByCharRange` 同源，代理对防劈）——窗口与子列文本出自同一份
 * 计划，不会漂移；每对消耗 2×容量 个码元，窗口按对错开、互不重叠。
 */
function serializeDoubleNote(
  node: BookNode,
  charsPerColumn: number,
  nodeOptions: SerializeNodeOptions | undefined,
  indentFirstPair: boolean,
): string {
  const text = collectNodeTextOf(node);
  const plans = planDoubleNoteColumns(text, charsPerColumn * 2, { indentFirstPair });
  const extras = Object.entries(node.attrs ?? {})
    .filter(([key]) => key !== 'char')
    .map(([key, value]) => ` data-${key}="${escapeHtml(String(value))}"`)
    .join('');
  /* 子列内容按码元窗口切片：夹注内的行内标记（专名号 / 着重等）随所在
   * 子列保留；切片函数返回同类型节点，此处只取其子内容序列化
   * （不嵌套容器标签） */
  const serializeChildrenOf = (sliced: BookNode): string =>
    (sliced.children ?? []).map((child) => serializeNode(child, nodeOptions)).join('');

  const pairsHtml = plans
    .map((plan) => {
      const rightHtml = serializeChildrenOf(
        sliceNodeByCharRange(node, plan.right.start, plan.right.end),
      );
      const leftHtml = serializeChildrenOf(
        sliceNodeByCharRange(node, plan.left.start, plan.left.end),
      );
      /* 注首低一格：仅当首对真实缩格（indented）时在右列首补 1 字位空位盒，
       * 与该列少排的一位严格配对（见 planDoubleNoteColumns） */
      const pad = plan.indented === true ? padBox(1) : '';
      return `<span class="bt-vnote-col">${pad}${rightHtml}</span><span class="bt-vnote-col">${leftHtml}</span>`;
    })
    .join('');

  return `<span class="bt-vnote"${extras}>${pairsHtml}</span>`;
}

/** 段落子节点 → 行内流 HTML（夹注替换为 vnote 盒，其余原样序列化） */
function serializeFlowChildren(
  node: BookNode,
  charsPerColumn: number,
  nodeOptions: SerializeNodeOptions | undefined,
): string {
  const parts: string[] = [];
  /* 行中起注判定：夹注之前已有任何子内容（文本 / 行内元素）时，注首低一格
   * （古籍形制：被注字之后起注、回行对齐注首）；段首夹注顶格不缩 */
  let hasPrecedingContent = false;
  for (const child of node.children ?? []) {
    if (isTextNode(child)) {
      parts.push(serializeNode(child, nodeOptions));
      if ((child.text ?? '').length > 0) hasPrecedingContent = true;
    } else if (child.type === DOUBLE_NOTE_TYPE) {
      parts.push(
        serializeDoubleNote(child, charsPerColumn, nodeOptions, hasPrecedingContent),
      );
      hasPrecedingContent = true;
    } else {
      parts.push(serializeNode(child, nodeOptions));
      hasPrecedingContent = true;
    }
  }
  return parts.join('');
}

/**
 * 页片段 → 直排行内流 HTML
 *
 * @param nodes 页片段节点（`reader.getPageFragments` 产物；跨页片段已按行
 *   切片，被切开的夹注在行内流下由量尺实测行边界规避——估算路径可能切注，
 *   记为已知限制）
 * @param options 见 {@link SerializeVerticalFlowOptions}
 * @returns HTML 文本：段落为行内 span 序列、标题 / 版式块原样整块，交给
 *   `.bt-vflow` 容器自然连排（列宽由根行高决定，与界行网格咬合）
 */
export function serializeVerticalFlow(
  nodes: readonly BookNode[],
  options: SerializeVerticalFlowOptions,
): string {
  const chars = Math.max(1, Math.round(options.charsPerColumn));
  const parts: string[] = [];
  for (const node of nodes) {
    if (isTextNode(node)) continue;
    if (FLOW_HEADING_TYPES.has(node.type)) {
      /* 章题随文连排 + 恒提行：`<br class="bt-vbreak">` 另起一列顶格，题文
       * 之后正文在同一列接排（块级呈现会整列白扔）。行盒厚度由 book-css
       * 锁到列距（2em 字号 × 继承的行高比例会把一列撑成两列）。 */
      parts.push(`<br class="bt-vbreak">${serializeNode(node, options.nodeOptions)}`);
      continue;
    }
    if (!FLOW_PARAGRAPH_TYPES.has(node.type)) {
      /* 版式块（眉批、旁批等）同样透传 nodeOptions：打印路径经本函数
       * 序列化眉批 / 旁批，丢选项会丢竖排字形转换 / 修订视图 / tagOverrides */
      parts.push(serializeNode(node, options.nodeOptions));
      continue;
    }
    const rule = resolveLineRule(node);
    /*
     * 段首标记：提行 / 平抬断列（br）+ 抬升空位；**段界恒低一格**
     *
     * 连排下段与段同列接排，块级外边距随行内化消失——不给段首空位盒，
     * 整页就是一面字墙（真实古籍 EPUB 实测：一页 33 段 bt-vpad 数为 0，
     * 目录 / 版权页条目全部粘连）。空位盒在段起处占 N 字位高，无论段起
     * 位于列首还是列中，语义均为「低 N 格起写」✓；显式低格 / 挪抬取
     * 较大值（flowBoundarySlots）。
     */
    const indent = flowBoundarySlots(rule);
    const prefix =
      options.omitRulePrefix === true
        ? ''
        : `${liftPrefix(rule)}${padBox(indent)}`;
    parts.push(
      `${prefix}<span class="bt-vpara">${serializeFlowChildren(node, chars, options.nodeOptions)}</span>`,
    );
  }
  return parts.join('');
}

/**
 * 页片段的截位分组（两截本 / 三截本，v2 批 5）
 *
 * 结构节点声明 `bands` 时，内容节点带 `band` 属性（'upper' / 'middle' /
 * 'lower'，缺省最下截）。本函数探测页内是否存在分截内容并按截位分组；
 * 非分截页返回 undefined（调用方走普通行内流）。
 *
 * @param nodes 页内节点序列
 * @param bandsCount 可选的截数声明（来自结构节点 bands）；未提供时按显式 max 推断
 * @returns 截位数组（索引 = 截位序号；元素为该截片段节点），或 undefined
 */
export function groupNodesByBand(
  nodes: readonly BookNode[],
  bandsCount?: number,
): readonly (readonly BookNode[])[] | undefined {
  const isBanded = (node: BookNode): boolean =>
    node.attrs?.['band'] === 'upper' ||
    node.attrs?.['band'] === 'middle' ||
    node.attrs?.['band'] === 'lower';
  const bandOf = (node: BookNode): number => {
    const raw = node.attrs?.['band'];
    return raw === 'upper' ? 0 : raw === 'middle' ? 1 : 2;
  };
  const banded = nodes.filter((node) => !isTextNode(node) && isBanded(node));
  if (banded.length === 0) return undefined;
  const hasDefault = nodes.some((node) => !isBanded(node));
  const explicitMax = Math.max(...banded.map(bandOf));
  /* 截数优先取 bandsCount 声明（来自结构节点 bands，与分页器同源）；
   * 未声明时按显式 max + 是否有缺省内容推断 */
  const count = Math.max(1, bandsCount ?? explicitMax + (hasDefault ? 2 : 1));
  const groups: BookNode[][] = Array.from({ length: count }, () => []);
  for (const node of nodes) {
    /* 未标注节点（含裸文本——页片段顶层不应有，兜底不丢内容）归最下截；
     * 显式截位越界（如声明 2 截却标 middle）夹到最下截，绝不静默丢弃 */
    groups[isBanded(node) ? Math.min(bandOf(node), count - 1) : count - 1]!.push(node);
  }
  return groups;
}
