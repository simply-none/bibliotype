/**
 * IDS 解析测试（K6）
 *
 * 覆盖：结构解析、往返序列化、组件不足 / 超深 / 空串的错误路径。
 */
import { describe, expect, it } from 'vitest';
import {
  IDS_OPERATORS,
  countIdsLeaves,
  formatIds,
  idsOperatorArity,
  isIdsOperator,
  parseIds,
} from '../ids.js';

describe('parseIds', () => {
  it('解析左右结构与嵌套结构', () => {
    const parsed = parseIds('⿰山夆');
    expect(parsed.issues).toEqual([]);
    expect(parsed.tree).toEqual({
      kind: 'compound',
      operator: '⿰',
      children: [
        { kind: 'leaf', char: '山' },
        { kind: 'leaf', char: '夆' },
      ],
    });

    const nested = parseIds('⿱⿰山夆水');
    expect(nested.issues).toEqual([]);
    expect(nested.tree?.kind).toBe('compound');
    if (nested.tree?.kind === 'compound') {
      expect(nested.tree.children).toHaveLength(2);
      expect(nested.tree.children[0]?.kind).toBe('compound');
    }
  });

  it('三组件运算符（⿲ / ⿳）', () => {
    const parsed = parseIds('⿲山水土');
    expect(parsed.issues).toEqual([]);
    if (parsed.tree?.kind === 'compound') {
      expect(parsed.tree.children).toHaveLength(3);
    }
  });

  it('空白字符被忽略', () => {
    expect(parseIds('⿰ 山 夆').tree).toEqual(parseIds('⿰山夆').tree);
  });

  it('组件不足时给出中文 issue 并保留已解析部分', () => {
    const parsed = parseIds('⿰山');
    expect(parsed.issues[0]?.message).toContain('缺少组件');
    expect(parsed.tree?.kind).toBe('compound');
  });

  it('空描述与纯运算符返回 issue', () => {
    expect(parseIds('').tree).toBeUndefined();
    expect(parseIds('').issues[0]?.message).toContain('为空');
    expect(parseIds('⿰').tree).toBeUndefined();
  });

  it('超过最大深度时停止解析', () => {
    const parsed = parseIds('⿰⿰山夆水', { maxDepth: 1 });
    expect(parsed.issues.some((issue) => issue.message.includes('嵌套超过'))).toBe(true);
  });

  it('多余组件给出提示', () => {
    const parsed = parseIds('⿰山夆水');
    expect(parsed.issues.some((issue) => issue.message.includes('未使用'))).toBe(true);
  });
});

describe('IDS 工具', () => {
  it('运算符识别与元数', () => {
    expect(isIdsOperator('⿰')).toBe(true);
    expect(isIdsOperator('山')).toBe(false);
    expect(idsOperatorArity('⿲')).toBe(3);
    expect(idsOperatorArity('山')).toBe(0);
    // 表里 12 个运算符（U+2FF0–U+2FFB）
    expect(Object.keys(IDS_OPERATORS)).toHaveLength(12);
  });

  it('formatIds 与 parseIds 往返一致', () => {
    const source = '⿱⿰山夆水';
    const tree = parseIds(source).tree;
    expect(tree).toBeDefined();
    expect(formatIds(tree!)).toBe(source);
  });

  it('countIdsLeaves 统计叶子数', () => {
    expect(countIdsLeaves(parseIds('⿰山夆').tree!)).toBe(2);
    expect(countIdsLeaves(parseIds('⿲山水土').tree!)).toBe(3);
  });
});
