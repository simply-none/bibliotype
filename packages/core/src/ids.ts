/**
 * IDS（表意文字描述序列）解析（K6）
 *
 * 缺字兜底的最后一招是「用部件描述合成字形」，描述串形如 `⿰山夆`：
 * 前一个字符是结构运算符（U+2FF0–U+2FFB），后接对应数量的组件。
 *
 * 本模块只做**解析与结构校验**，不做字形渲染（渲染在 `layout`，需要 SVG）；
 * 解析失败一律返回中文 issue 与已解析部分，不抛错——缺字报告不应该因为一个
 * 坏描述就中断整篇扫描。
 */

/** IDS 运算符 → 组件数量 */
export const IDS_OPERATORS: Readonly<Record<string, number>> = {
  '⿰': 2, // 左右
  '⿱': 2, // 上下
  '⿲': 3, // 左中右
  '⿳': 3, // 上中下
  '⿴': 2, // 全包围
  '⿵': 2, // 上三包围
  '⿶': 2, // 下三包围
  '⿷': 2, // 左三包围
  '⿸': 2, // 左上包围
  '⿹': 2, // 右上包围
  '⿺': 2, // 左下包围
  '⿻': 2, // 重叠
};

/** 运算符的 Unicode 区间（U+2FF0–U+2FFB） */
const IDS_OPERATOR_RANGE: readonly [number, number] = [0x2ff0, 0x2ffb];

/** IDS 树节点：叶子（单字）或复合（运算符 + 组件） */
export type IdsTreeNode =
  | { kind: 'leaf'; char: string }
  | { kind: 'compound'; operator: string; children: IdsTreeNode[] };

/** 解析问题 */
export interface IdsIssue {
  /** 中文说明（直接进缺字报告） */
  message: string;
  /** 出问题的字符下标（按码点计，自 0 起） */
  index: number;
}

/** 解析结果：`tree` 可缺省（空串 / 完全非法） */
export interface IdsParseResult {
  tree?: IdsTreeNode;
  /** 结构问题（组件不足 / 深度超限 / 出现非运算符的空格等） */
  issues: IdsIssue[];
}

/** 解析选项 */
export interface IdsParseOptions {
  /** 最大嵌套深度（防御递归描述，缺省 32） */
  maxDepth?: number;
}

/** 是否为 IDS 运算符 */
export function isIdsOperator(char: string): boolean {
  const codePoint = char.codePointAt(0);
  return (
    codePoint !== undefined &&
    codePoint >= IDS_OPERATOR_RANGE[0] &&
    codePoint <= IDS_OPERATOR_RANGE[1] &&
    IDS_OPERATORS[char] !== undefined
  );
}

/** 运算符的组件数量 */
export function idsOperatorArity(operator: string): number {
  return IDS_OPERATORS[operator] ?? 0;
}

/** 解析游标状态 */
interface ParseState {
  chars: readonly string[];
  index: number;
  issues: IdsIssue[];
  maxDepth: number;
}

/**
 * 递归解析一个节点
 *
 * @returns 成功时为节点；组件不足 / 超深时返回已解析部分（`undefined` 表示无可解析内容）
 */
function parseNode(state: ParseState, depth: number): IdsTreeNode | undefined {
  const char = state.chars[state.index];
  if (char === undefined) return undefined;

  if (!isIdsOperator(char)) {
    state.index += 1;
    return { kind: 'leaf', char };
  }

  const operator = char;
  const arity = idsOperatorArity(operator);
  state.index += 1;

  if (depth >= state.maxDepth) {
    state.issues.push({
      message: `IDS 嵌套超过 ${state.maxDepth} 层，已停止解析`,
      index: state.index - 1,
    });
    return undefined;
  }

  const children: IdsTreeNode[] = [];
  for (let count = 0; count < arity; count += 1) {
    const child = parseNode(state, depth + 1);
    if (child === undefined) {
      state.issues.push({
        message: `运算符「${operator}」缺少组件（需要 ${arity} 个，实际 ${children.length} 个）`,
        index: state.index,
      });
      break;
    }
    children.push(child);
  }

  if (children.length === 0) return undefined;
  return { kind: 'compound', operator, children };
}

/**
 * 解析 IDS 描述
 *
 * @param description 如 `⿰山夆`；空格会被忽略，其余字符按组件处理
 * @param options 见 {@link IdsParseOptions}
 * @returns 树与结构问题（问题不抛错）
 */
export function parseIds(description: string, options: IdsParseOptions = {}): IdsParseResult {
  const chars = Array.from(description).filter((char) => !/\s/u.test(char));
  if (chars.length === 0) {
    return { issues: [{ message: 'IDS 描述为空', index: 0 }] };
  }

  const state: ParseState = {
    chars,
    index: 0,
    issues: [],
    maxDepth: Math.max(1, options.maxDepth ?? 32),
  };
  const tree = parseNode(state, 0);

  // 剩余的字符通常是运算符多写了组件：保留在 issues 里提示，不静默丢弃
  if (tree !== undefined && state.index < chars.length) {
    state.issues.push({
      message: `运算符组件数量不匹配，剩余「${chars.slice(state.index).join('')}」未使用`,
      index: state.index,
    });
  }

  return tree === undefined ? { issues: state.issues } : { tree, issues: state.issues };
}

/** 序列化回 IDS 描述（往返测试与「复制描述」用） */
export function formatIds(tree: IdsTreeNode): string {
  if (tree.kind === 'leaf') return tree.char;
  return tree.operator + tree.children.map((child) => formatIds(child)).join('');
}

/** 叶子数量（合成渲染按叶子均分格子） */
export function countIdsLeaves(tree: IdsTreeNode): number {
  if (tree.kind === 'leaf') return 1;
  return tree.children.reduce((sum, child) => sum + countIdsLeaves(child), 0);
}
