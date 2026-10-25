/**
 * 行款规则解析与折算（古籍直排 v2 批 2）
 *
 * 行款属性（批 1 登记于编辑规格 `LINE_RULE_ATTRS`，IR attrs）在此统一解析：
 * - `indent` 低 N 格：直排 = 列首空 N 字位（连排下段首的段界标记）；
 * - `lift` 抬头：`'space'` 空抬 / 挪抬（行内空一字）、`'newline'` 平抬（提行顶格）；
 * - `liftLevel` 单 / 双 / 三 / 四抬（提行高出 N 字）；
 * - `breakLine` 提行另起（行级断列，区别于另起页）。
 *
 * 双口径消费：
 * - 渲染侧：`serializeVerticalFlow` 据此输出行内流标记（段首缩进 / 断列 / 抬升）；
 * - 估算侧：无 DOM 导出路径按「字位折算」计入块容量（本模块纯函数提供）。
 *
 * 纯函数、零 DOM；非法值收敛为缺省（不抛错——行款属性来自用户输入）。
 */
import type { BookNode } from '@bibliotype/core';

/** 抬头形式 */
export type LiftType = 'none' | 'space' | 'newline';

/** 节点的行款规则（已收敛的规格化形态） */
export interface LineRule {
  /** 低格字位数（0~4；非法收敛 0） */
  indentChars: number;
  /** 抬头形式（缺省 none） */
  lift: LiftType;
  /** 抬头层级（1~4；仅 newline 生效，缺省 1） */
  liftLevel: number;
  /** 提行另起一列 */
  breakLine: boolean;
}

/** 全缺省行款（不参与任何行款行为的哨兵值） */
export const NO_LINE_RULE: Readonly<LineRule> = {
  indentChars: 0,
  lift: 'none',
  liftLevel: 1,
  breakLine: false,
};

/** 数值属性收敛（非法 / 越界回退） */
function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * 解析节点的行款规则
 *
 * 只读 `node.attrs` 的四个行款键（indent / lift / liftLevel / breakLine），
 * 未设置时返回全缺省（`NO_LINE_RULE` 的等价新对象，供调用方安全改写）。
 */
export function resolveLineRule(node: BookNode): LineRule {
  const attrs = node.attrs ?? {};
  const indentChars = clampInt(attrs['indent'], 0, 4, 0);
  const rawLift = attrs['lift'];
  const lift: LiftType =
    rawLift === 'space' || rawLift === 'newline' ? rawLift : 'none';
  const liftLevel = clampInt(attrs['liftLevel'], 1, 4, 1);
  const breakLine = attrs['breakLine'] === true;
  if (indentChars === 0 && lift === 'none' && !breakLine) {
    return { ...NO_LINE_RULE, liftLevel };
  }
  return { indentChars, lift, liftLevel, breakLine };
}

/**
 * 行款的估算折算（无 DOM 路径的容量口径）
 *
 * 低格与挪抬占字位、提行 / 平抬消耗剩余列容量——分页估算需要把这些
 * 折算为「本段首行有效容量扣减」与「段前断列」，与渲染侧行为同源。
 *
 * @returns 首行容量扣减字位数（低格 + 挪抬）；提行 / 平抬由分页器按
 *   `startsNewLine` 另行处理
 */
export function lineRuleOverhead(rule: LineRule): {
  /** 首行（列首）容量扣减字位（低格 + 空抬 / 挪抬） */
  firstLineIndentChars: number;
  /** 本段是否要求另起新列（提行 / 平抬及以上） */
  startsNewLine: boolean;
} {
  return {
    firstLineIndentChars: rule.indentChars + (rule.lift === 'space' ? 1 : 0),
    startsNewLine: rule.breakLine || rule.lift === 'newline',
  };
}
