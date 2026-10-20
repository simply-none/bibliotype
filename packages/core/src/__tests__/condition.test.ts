/**
 * A6 条件内容表达式测试
 */
import { describe, expect, it } from 'vitest';
import { evaluateCondition, isValidConditionExpression } from '../ir/condition.js';

describe('evaluateCondition', () => {
  it('空串恒真', () => {
    expect(evaluateCondition('', { platform: 'epub' })).toBe(true);
  });

  it('缺省上下文保留内容', () => {
    expect(evaluateCondition('platform=epub')).toBe(true);
  });

  it('等值匹配 / 不等', () => {
    expect(evaluateCondition('platform=epub', { platform: 'epub' })).toBe(true);
    expect(evaluateCondition('platform=epub', { platform: 'site' })).toBe(false);
    expect(evaluateCondition('platform!=site', { platform: 'epub' })).toBe(true);
    expect(evaluateCondition('platform!=epub', { platform: 'epub' })).toBe(false);
  });

  it('多子句按 AND 连接', () => {
    expect(evaluateCondition('platform=epub&role=teacher', { platform: 'epub', role: 'teacher' })).toBe(
      true,
    );
    expect(evaluateCondition('platform=epub&role=teacher', { platform: 'epub', role: 'reader' })).toBe(
      false,
    );
  });

  it('上下文缺少键时判假', () => {
    expect(evaluateCondition('role=teacher', { platform: 'epub' })).toBe(false);
  });

  it('表达式非法时保守返回 false', () => {
    expect(evaluateCondition('platform==epub', { platform: 'epub' })).toBe(false);
    expect(evaluateCondition('platform=', { platform: 'epub' })).toBe(false);
  });

  it('支持引号包裹的值', () => {
    expect(evaluateCondition('platform="epub"', { platform: 'epub' })).toBe(true);
  });
});

describe('isValidConditionExpression', () => {
  it('合法表达式', () => {
    expect(isValidConditionExpression('')).toBe(true);
    expect(isValidConditionExpression('platform=epub')).toBe(true);
    expect(isValidConditionExpression('platform=epub&role!=teacher')).toBe(true);
  });

  it('非法表达式', () => {
    expect(isValidConditionExpression('platform==epub')).toBe(false);
    expect(isValidConditionExpression('platform=')).toBe(false);
    expect(isValidConditionExpression('=epub')).toBe(false);
  });
});
