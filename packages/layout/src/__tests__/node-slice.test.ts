/**
 * IR 节点行级切片测试（sliceNodeByCharRange）
 */
import { describe, expect, it } from 'vitest';
import { NODE_TYPES, type BookNode } from '@bibliotype/core';
import { sliceNodeByCharRange } from '../node-slice.js';

/** 段落：两段文本，第二段带 strong 标记 */
function para(): BookNode {
  return {
    type: NODE_TYPES.PARAGRAPH,
    id: 'p-1',
    attrs: { align: 'left' },
    children: [
      { type: 'text', text: '子曰学而' },
      { type: 'text', text: '时习之', marks: [{ type: 'strong' }] },
    ],
  };
}

describe('sliceNodeByCharRange', () => {
  it('完整区间原样返回同一引用（免复制）', () => {
    const node = para();
    expect(sliceNodeByCharRange(node, 0, 999)).toBe(node);
  });

  it('单文本叶子内裁剪', () => {
    const node: BookNode = {
      type: NODE_TYPES.PARAGRAPH,
      children: [{ type: 'text', text: 'ABCDEFGH' }],
    };
    const out = sliceNodeByCharRange(node, 2, 5);
    expect(out.children?.[0]?.text).toBe('CDE');
  });

  it('跨文本叶子切片并保留各段 marks', () => {
    // 总文本：子曰学而(0~3) + 时习之(4~6)；切 [2,6) → 学而时习
    const out = sliceNodeByCharRange(para(), 2, 6);
    const children = out.children ?? [];
    expect(children.map((c) => c.text).join('')).toBe('学而时习');
    // 保留容器类型与属性
    expect(out.type).toBe(NODE_TYPES.PARAGRAPH);
    expect(out.attrs).toEqual({ align: 'left' });
    // 命中带 strong 的片段（偏移 4~6 落在第二段「时习」）
    const strong = children.find((c) => c.marks?.some((m) => m.type === 'strong'));
    expect(strong?.text).toBe('时习');
  });

  it('空区间返回无子节点副本', () => {
    const out = sliceNodeByCharRange(para(), 3, 3);
    expect(out.children).toEqual([]);
  });

  it('越界钳制：from/to 超出总长不报错（完整覆盖复用原节点）', () => {
    const node = para();
    const out = sliceNodeByCharRange(node, -5, 100);
    expect(out).toBe(node);
    expect(out.children?.map((c) => c.text).join('')).toBe('子曰学而时习之');
  });

  it('行内元素载体（零文本）按位置整体归属', () => {
    const node: BookNode = {
      type: NODE_TYPES.PARAGRAPH,
      children: [
        { type: 'text', text: 'AB' },
        { type: NODE_TYPES.MATH_INLINE, attrs: { tex: 'x' } }, // 零文本，位于偏移 2
        { type: 'text', text: 'CD' },
      ],
    };
    // 片段 [0,2)：载体在偏移 2，不在区间内
    const head = sliceNodeByCharRange(node, 0, 2);
    expect(head.children?.some((c) => c.type === NODE_TYPES.MATH_INLINE)).toBe(false);
    // 片段 [2,4)：载体偏移 2 落入区间
    const tail = sliceNodeByCharRange(node, 2, 4);
    expect(tail.children?.some((c) => c.type === NODE_TYPES.MATH_INLINE)).toBe(true);
  });
});
