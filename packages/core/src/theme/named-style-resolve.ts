/**
 * 命名样式继承链解析与校验
 *
 * `NamedStyle.basedOn` 指向另一命名样式，声明按「祖先在前、后代覆盖」合并。
 * CSS 不支持跨规则继承，因此渲染侧（`buildFeatureCss`）必须先用本模块把链
 * 扁平化成单条声明，再输出 `[data-style-id]` 规则。
 *
 * 设计约束：
 * - 纯函数、无副作用；
 * - **断链 / 成环不抛异常**：返回已收集到的部分声明，避免损坏的样式设置
 *   让整本书无法渲染；问题通过 `validateNamedStyleSet` 结构化上报；
 * - 合并时跳过空值（空串 = 不覆盖），与 `normalizeFeatureSheet` 的稀疏语义一致。
 */
import type { FeatureDeclarations, NamedStyle, NamedStyleSet } from './feature-style.js';

/** 命名样式集合的结构问题代码 */
export const NAMED_STYLE_ISSUE_CODES = {
  /** 同 id 出现多次 */
  DUPLICATE_ID: 'duplicate-id',
  /** basedOn 指向不存在的样式 */
  MISSING_BASED_ON: 'missing-based-on',
  /** basedOn 指向自身 */
  SELF_REFERENCE: 'self-reference',
  /** basedOn 链成环 */
  CIRCULAR_BASED_ON: 'circular-based-on',
} as const;

/** 命名样式问题代码联合 */
export type NamedStyleIssueCode =
  (typeof NAMED_STYLE_ISSUE_CODES)[keyof typeof NAMED_STYLE_ISSUE_CODES];

/** 命名样式集合的结构问题 */
export interface NamedStyleIssue {
  /** 问题代码 */
  code: NamedStyleIssueCode;
  /** 出问题的样式 id */
  styleId: string;
  /** 中文说明（可直接展示） */
  message: string;
}

/** 按 id 查样式（内部用，避免与公开 `findNamedStyle` 的导出入参耦合） */
function lookup(set: NamedStyleSet, id: string): NamedStyle | undefined {
  return set.styles.find((style) => style.id === id);
}

/**
 * 取命名样式的继承链（根 → 叶）
 *
 * 断链（basedOn 指向不存在的 id）或成环时提前停止，返回已收集部分；
 * 返回值只读，供 UI 展示「依据来源」。
 */
export function resolveNamedStyleChain(
  set: NamedStyleSet,
  id: string,
): readonly NamedStyle[] {
  const stack: NamedStyle[] = [];
  const visited = new Set<string>();
  let current = lookup(set, id);
  while (current !== undefined) {
    if (visited.has(current.id)) break;
    visited.add(current.id);
    stack.push(current);
    const parentId = current.basedOn;
    if (parentId === undefined || parentId === '') break;
    current = lookup(set, parentId);
  }
  return stack.reverse();
}

/**
 * 解析命名样式的有效声明（沿 basedOn 链合并）
 *
 * 合并顺序为「祖先在前、后代覆盖」；同一属性后出现的值胜出。样式 id 不存在、
 * 断链或成环时返回已收集部分（可能为空对象），不抛异常。
 */
export function resolveNamedStyleDeclarations(
  set: NamedStyleSet,
  id: string,
): FeatureDeclarations {
  const merged: FeatureDeclarations = {};
  for (const style of resolveNamedStyleChain(set, id)) {
    for (const [property, value] of Object.entries(style.declarations)) {
      if (value === '') continue;
      merged[property] = value;
    }
  }
  return merged;
}

/**
 * 校验命名样式集合
 *
 * 覆盖四类结构问题：重复 id、自引用、缺失依据、继承环。校验只报告问题，
 * 不修改入参；渲染侧仍可通过 `resolveNamedStyleDeclarations` 安全降级。
 */
export function validateNamedStyleSet(set: NamedStyleSet): NamedStyleIssue[] {
  const issues: NamedStyleIssue[] = [];
  const seen = new Set<string>();

  for (const style of set.styles) {
    if (seen.has(style.id)) {
      issues.push({
        code: NAMED_STYLE_ISSUE_CODES.DUPLICATE_ID,
        styleId: style.id,
        message: `命名样式 id "${style.id}" 重复：请重新分配唯一 id。`,
      });
    } else {
      seen.add(style.id);
    }
  }

  for (const style of set.styles) {
    const parentId = style.basedOn;
    if (parentId === undefined || parentId === '') continue;
    if (parentId === style.id) {
      issues.push({
        code: NAMED_STYLE_ISSUE_CODES.SELF_REFERENCE,
        styleId: style.id,
        message: `命名样式 "${style.name}" 不能以自身为依据。`,
      });
      continue;
    }
    if (!seen.has(parentId)) {
      issues.push({
        code: NAMED_STYLE_ISSUE_CODES.MISSING_BASED_ON,
        styleId: style.id,
        message: `命名样式 "${style.name}" 的依据 "${parentId}" 不存在。`,
      });
      continue;
    }
    if (hasCycle(set, style.id)) {
      issues.push({
        code: NAMED_STYLE_ISSUE_CODES.CIRCULAR_BASED_ON,
        styleId: style.id,
        message: `命名样式 "${style.name}" 的依据链成环：请断开循环引用。`,
      });
    }
  }

  return issues;
}

/** 从 id 出发沿 basedOn 上溯，是否能回到起点 */
function hasCycle(set: NamedStyleSet, id: string): boolean {
  const visited = new Set<string>([id]);
  let current = lookup(set, id)?.basedOn;
  while (current !== undefined && current !== '') {
    if (visited.has(current)) return current === id;
    visited.add(current);
    current = lookup(set, current)?.basedOn;
  }
  return false;
}
