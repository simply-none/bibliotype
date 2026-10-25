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
import { escapeHtml, serializeNode } from './html-serializer.js';
import { resolveLineRule, type LineRule } from '../line-rules.js';

/** 行内流序列化选项 */
export interface SerializeVerticalFlowOptions {
  /** 每行大字数（版心高 ÷ 字位步进；夹注每子列小字容量 = 本值 × 2） */
  charsPerColumn: number;
}

/** 双行夹注类型（classical 插件节点，layout 不依赖 classical，按 kebab-case 字符串表列——与 reader 分块口径一致） */
const DOUBLE_NOTE_TYPE = 'double-note';

/** 参与连排的段落类节点（正文段落 + 引文；标题与版式块不连排） */
const FLOW_PARAGRAPH_TYPES: ReadonlySet<string> = new Set([
  NODE_TYPES.PARAGRAPH,
  NODE_TYPES.QUOTE,
]);

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
function serializeDoubleNote(node: BookNode, charsPerColumn: number): string {
  const text = collectNodeTextOf(node);
  const [[right, left]] = splitDoubleNoteLines(text, charsPerColumn * 2);
  const extras = Object.entries(node.attrs ?? {})
    .filter(([key]) => key !== 'char')
    .map(([key, value]) => ` data-${key}="${escapeHtml(String(value))}"`)
    .join('');
  return (
    `<span class="bt-vnote"${extras}>` +
    `<span class="bt-vnote-col">${escapeHtml(right)}</span>` +
    `<span class="bt-vnote-col">${escapeHtml(left)}</span>` +
    `</span>`
  );
}

/** 段落子节点 → 行内流 HTML（夹注替换为 vnote 盒，其余原样序列化） */
function serializeFlowChildren(node: BookNode, charsPerColumn: number): string {
  const parts: string[] = [];
  for (const child of node.children ?? []) {
    if (isTextNode(child)) {
      parts.push(serializeNode(child));
    } else if (child.type === DOUBLE_NOTE_TYPE) {
      parts.push(serializeDoubleNote(child, charsPerColumn));
    } else {
      parts.push(serializeNode(child));
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
    const prefix = `${liftPrefix(rule)}${indent > 0 ? padBox(indent) : ''}`;
    parts.push(
      `${prefix}<span class="bt-vpara">${serializeFlowChildren(node, chars)}</span>`,
    );
  }
  return parts.join('');
}
