/**
 * IDS 缺字合成 SVG（K6）
 *
 * 字体没有该字时，用 IDS 描述（`⿰山夆`）把部件拼成一个方框字：
 * 纯字符串拼接、零依赖、零随机，同一描述输出逐字节一致（可直接快照 / 比对）。
 *
 * 定位是**可读的兜底**，不是字体级精确构形：分块比例按常见写法近似，
 * 包围结构只画外框、不还原笔势。真正的字形仍应由字体提供。
 */
import {
  IDS_OPERATORS,
  isIdsOperator,
  parseIds,
  type IdsTreeNode,
} from '@bibliotype/core';

/** 合成字形选项 */
export interface IdsGlyphOptions {
  /** IDS 描述（如 `⿰山夆`）；与 `tree` 二选一，优先 `description` */
  description?: string;
  /** 已解析的结构树 */
  tree?: IdsTreeNode;
  /** 是否绘制外框（缺字兜底时建议开启） */
  frame?: boolean;
  /** 尺寸（CSS 长度，缺省 `1em`，随字号缩放） */
  size?: string;
  /** 文字颜色（缺省 `currentColor`） */
  color?: string;
  /** 无障碍标签（缺省由描述生成） */
  label?: string;
}

/** 归一化画布 */
const VIEW_SIZE = 100;

/** 全包围 / 三包围运算符（画外框，组件内缩） */
const ENCLOSING_OPERATORS: ReadonlySet<string> = new Set(['⿴', '⿵', '⿶', '⿷', '⿸', '⿹', '⿺']);

/** XML 转义 */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 归一化矩形 */
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 按比例切分矩形 */
function split(rect: Rect, ratios: readonly number[], direction: 'row' | 'column'): Rect[] {
  const total = ratios.reduce((sum, value) => sum + value, 0);
  const result: Rect[] = [];
  let cursor = direction === 'row' ? rect.x : rect.y;
  for (const ratio of ratios) {
    const share = ratio / total;
    if (direction === 'row') {
      const w = rect.w * share;
      result.push({ x: cursor, y: rect.y, w, h: rect.h });
      cursor += w;
    } else {
      const h = rect.h * share;
      result.push({ x: rect.x, y: cursor, w: rect.w, h });
      cursor += h;
    }
  }
  return result;
}

/** 内缩矩形（包围结构） */
function inset(rect: Rect, ratio: number): Rect {
  return {
    x: rect.x + rect.w * ratio,
    y: rect.y + rect.h * ratio,
    w: rect.w * (1 - ratio * 2),
    h: rect.h * (1 - ratio * 2),
  };
}

/** 画外框 */
function frameSvg(rect: Rect, color: string): string {
  return (
    `<rect x="${rect.x.toFixed(1)}" y="${rect.y.toFixed(1)}" ` +
    `width="${rect.w.toFixed(1)}" height="${rect.h.toFixed(1)}" ` +
    `fill="none" stroke="${color}" stroke-width="2" opacity="0.55" />`
  );
}

/** 递归布局：把树画进矩形 */
function layoutNode(node: IdsTreeNode, rect: Rect, color: string, depth: number): string {
  if (node.kind === 'leaf') {
    const char = Array.from(node.char)[0] ?? '';
    if (char === '') return '';
    const fontSize = Math.min(rect.w, rect.h) * 0.92;
    const x = rect.x + rect.w / 2;
    const y = rect.y + rect.h / 2 + fontSize * 0.36;
    return (
      `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" ` +
      `font-size="${fontSize.toFixed(1)}" fill="${color}">${escapeXml(char)}</text>`
    );
  }

  const operator = node.operator;
  const children = node.children;
  if (!isIdsOperator(operator) || children.length === 0) return '';

  /* 包围结构：外框 + 内缩组件；其余按运算符切块 */
  if (ENCLOSING_OPERATORS.has(operator)) {
    const inner = inset(rect, 0.16);
    const parts = children.map((child) => layoutNode(child, inner, color, depth + 1));
    return frameSvg(rect, color) + parts.join('');
  }

  if (operator === '⿻') {
    /* 重叠：两个组件画在同一格，后一个略淡，避免完全糊死 */
    return children
      .map((child, index) =>
        index === 0
          ? layoutNode(child, rect, color, depth + 1)
          : `<g opacity="0.72">${layoutNode(child, rect, color, depth + 1)}</g>`,
      )
      .join('');
  }

  const arity = IDS_OPERATORS[operator] ?? 2;
  const direction: 'row' | 'column' =
    operator === '⿰' || operator === '⿲' ? 'row' : 'column';
  const rects = split(rect, children.map(() => 1), direction).slice(0, arity);
  return children
    .map((child, index) => {
      const target = rects[index];
      return target === undefined ? '' : layoutNode(child, target, color, depth + 1);
    })
    .join('');
}

/**
 * 渲染 IDS 合成字形
 *
 * @param options 描述或结构树，见 {@link IdsGlyphOptions}
 * @returns SVG 字符串；描述为空 / 解析失败时返回空串（调用方退化为方框占位）
 */
export function renderIdsSvg(options: IdsGlyphOptions): string {
  let tree = options.tree;
  if (options.description !== undefined && options.description.trim() !== '') {
    const parsed = parseIds(options.description);
    // 结构不完整（缺组件 / 超深）时宁可不画，避免拼出错字
    if (parsed.tree === undefined || parsed.issues.length > 0) return '';
    tree = parsed.tree;
  }
  if (tree === undefined) return '';

  const color = options.color ?? 'currentColor';
  const size = options.size ?? '1em';
  const label =
    options.label ??
    `合成字形：${options.description ?? (tree.kind === 'leaf' ? tree.char : 'IDS')}`;

  const body = layoutNode(tree, { x: 4, y: 4, w: 92, h: 92 }, color, 0);
  if (body === '') return '';

  const frame =
    options.frame === true
      ? `<rect x="2" y="2" width="96" height="96" rx="3" fill="none" ` +
        `stroke="${color}" stroke-width="2" opacity="0.35" />`
      : '';

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW_SIZE} ${VIEW_SIZE}" ` +
    `width="${size}" height="${size}" role="img" aria-label="${escapeXml(label)}" ` +
    `class="bt-ids-svg" font-family="STSong, SimSun, serif" ` +
    `style="vertical-align:-0.15em">${frame}${body}</svg>`
  );
}

/** HTML 转义（属性值） */
function escapeHtml(value: string): string {
  return escapeXml(value);
}

/**
 * 渲染可内联进书页的合成字形片段
 *
 * @returns `<span class="bt-glyph bt-glyph--ids" data-ids="…">svg</span>`；
 * 描述非法时返回空串，调用方保留原字符
 */
export function renderIdsGlyphHtml(description: string, options: IdsGlyphOptions = {}): string {
  const svg = renderIdsSvg({ ...options, description });
  if (svg === '') return '';
  return `<span class="bt-glyph bt-glyph--ids" data-ids="${escapeHtml(description)}">${svg}</span>`;
}
