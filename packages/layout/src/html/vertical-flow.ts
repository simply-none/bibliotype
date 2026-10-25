/**
 * 直排行内流序列化（古籍直排 v2 批 2）
 *
 * **为什么是行内流**：CSS 直排块流中每个块级段落独占整列（段段换列、
 * 版面半空），而古籍正文各段同列连排、段界靠格位标记（低格 / 抬头 / 提行）。
 * 本序列化器把页片段改写为**行内流**：段落 → 行内 span，双行夹注 →
 * 恒 1 大字位宽 × 整列高的**固定双列**小字盒（{@link splitDoubleNoteLines}
 * 按列容量拆右 / 左子列——竖排 block 流自右向左，DOM 序即阅读序；直排
 * multicol 轴向不可靠，已实测排除），提行 / 平抬 → `<br>` 断列，抬升 /
 * 低格 → 段首空位盒。容器（`.bt-vflow`）在 `writing-mode: vertical-rl`
 * 下自然换列，列宽由根行高（= 列距）决定——与界行网格天然咬合。
 *
 * 段落行内化的代价与取舍：块级 margin / 块级样式随盒消失，段界语义全部由
 * 行内标记承载（空位 / 断列），这是古籍行款的原生形态（连排本无段间距）。
 * 标题 / 版式块（牌记 / 眉批等）不参与连排，原样整块输出（保持既有样式）。
 *
 * 消费方：预览 `BtBookView`（直排分支）、量尺 `pagination-measure`（同形态
 * 实测——行边界与夹注原子性自洽）、导出 paged 与打印同源。
 */
import { NODE_TYPES, isTextNode, type BookNode } from '@bibliotype/core';
import { splitDoubleNoteLines, collectNodeTextOf } from '../double-note-split.js';
import { escapeHtml, serializeNode, type SerializeNodeOptions } from './html-serializer.js';
import { sliceNodeByCharRange } from '../node-slice.js';
import { resolveLineRule, type LineRule } from '../line-rules.js';

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

/** 参与连排的段落类节点（正文段落 + 引文；标题与版式块不连排） */
const FLOW_PARAGRAPH_TYPES: ReadonlySet<string> = new Set([
  NODE_TYPES.PARAGRAPH,
  NODE_TYPES.QUOTE,
]);

/**
 * 节点是否参与行内流连排（段落 / 引文）
 *
 * 供分页画布判定片段的渲染通道：连排片段以行内流序列化并作行内呈现，
 * 其余（标题 / 版式块）保持整块。
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
 * 双行夹注 → 1 字位宽 × 整列高的固定双列小字盒
 *
 * 按「每子列容量 = 每行大字数 × 2」拆右 / 左子列（右列满读到底续左列，
 * 「从上排到底」的古籍形制）；竖排 block 流自右向左，DOM 序即阅读序。
 * 超过两子列容量的注文截断（古籍超长注占多字位，列为后续扩展）。
 */
function serializeDoubleNote(
  node: BookNode,
  charsPerColumn: number,
  nodeOptions: SerializeNodeOptions | undefined,
): string {
  const text = collectNodeTextOf(node);
  const [[right, left]] = splitDoubleNoteLines(text, charsPerColumn * 2);
  const extras = Object.entries(node.attrs ?? {})
    .filter(([key]) => key !== 'char')
    .map(([key, value]) => ` data-${key}="${escapeHtml(String(value))}"`)
    .join('');
  /* 子列内容按字符区间切片：夹注内的行内标记（专名号 / 着重等）随所在
   * 子列保留（右列 [0, cap)、左列 [cap, 末)，与 splitDoubleNoteLines 同口径）；
   * 切片函数返回同类型节点，此处只取其子内容序列化（不嵌套容器标签） */
  const cap = Math.min(text.length, charsPerColumn * 2);
  const serializeChildrenOf = (sliced: BookNode): string =>
    (sliced.children ?? []).map((child) => serializeNode(child, nodeOptions)).join('');
  const rightHtml = serializeChildrenOf(sliceNodeByCharRange(node, 0, cap));
  const leftHtml = serializeChildrenOf(sliceNodeByCharRange(node, cap, Number.MAX_SAFE_INTEGER));
  return (
    `<span class="bt-vnote"${extras}>` +
    `<span class="bt-vnote-col">${rightHtml}</span>` +
    `<span class="bt-vnote-col">${leftHtml}</span>` +
    `</span>`
  );
}

/** 段落子节点 → 行内流 HTML（夹注替换为 vnote 盒，其余原样序列化） */
function serializeFlowChildren(
  node: BookNode,
  charsPerColumn: number,
  nodeOptions: SerializeNodeOptions | undefined,
): string {
  const parts: string[] = [];
  for (const child of node.children ?? []) {
    if (isTextNode(child)) {
      parts.push(serializeNode(child, nodeOptions));
    } else if (child.type === DOUBLE_NOTE_TYPE) {
      parts.push(serializeDoubleNote(child, charsPerColumn, nodeOptions));
    } else {
      parts.push(serializeNode(child, nodeOptions));
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
    if (!FLOW_PARAGRAPH_TYPES.has(node.type)) {
      parts.push(serializeNode(node));
      continue;
    }
    const rule = resolveLineRule(node);
    /*
     * 段首标记：提行 / 平抬断列（br）+ 抬升空位；低格 / 挪抬用段首空位盒
     * （inline span 的 text-indent 无效——空位盒在段起处占 N 字位高，
     * 无论段起位于列首还是列中，语义均为「低 N 格起写」✓）
     */
    const indent = rule.indentChars + (rule.lift === 'space' ? 1 : 0);
    const prefix =
      options.omitRulePrefix === true
        ? ''
        : `${liftPrefix(rule)}${indent > 0 ? padBox(indent) : ''}`;
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
 * @returns 截位数组（索引 = 截位序号；元素为该截片段节点），或 undefined
 */
export function groupNodesByBand(
  nodes: readonly BookNode[],
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
  const hasDefault = nodes.some((node) => !isTextNode(node) && !isBanded(node));
  const explicitMax = Math.max(...banded.map(bandOf));
  /* 缺省（无 band 属性）节点归最下截：两截本 upper 显式 + 正文缺省 → 2 截；
   * 三截本 upper / middle 显式 + lower 缺省 → 3 截。全显式时 = 显式数。 */
  const count = explicitMax + (hasDefault ? 2 : 1);
  const groups: BookNode[][] = Array.from({ length: count }, () => []);
  for (const node of nodes) {
    if (isTextNode(node)) continue;
    groups[isBanded(node) ? bandOf(node) : count - 1]!.push(node);
  }
  return groups;
}
