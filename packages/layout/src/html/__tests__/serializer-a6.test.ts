/**
 * A6 序列化：条件内容裁剪、页眉页脚标签
 */
import { describe, expect, it } from 'vitest';
import { NODE_TYPES } from '@bibliotype/core';
import type { BookNode } from '@bibliotype/core';
import { serializeNode } from '../html-serializer.js';

function paragraph(text: string): BookNode {
  return { type: NODE_TYPES.PARAGRAPH, id: `p-${text}`, children: [{ type: 'text', text }] };
}

describe('A6 序列化', () => {
  it('条件表达式命中时输出子树', () => {
    const node: BookNode = {
      type: NODE_TYPES.CONDITION,
      id: 'cond-1',
      attrs: { when: 'platform=epub' },
      children: [paragraph('教师用内容')],
    };
    const html = serializeNode(node, { conditionContext: { platform: 'epub' } });
    expect(html).toContain('教师用内容');
  });

  it('条件表达式不命中时输出空串', () => {
    const node: BookNode = {
      type: NODE_TYPES.CONDITION,
      id: 'cond-1',
      attrs: { when: 'platform=epub' },
      children: [paragraph('教师用内容')],
    };
    expect(serializeNode(node, { conditionContext: { platform: 'site' } })).toBe('');
  });

  it('缺省上下文保留内容', () => {
    const node: BookNode = {
      type: NODE_TYPES.CONDITION,
      id: 'cond-1',
      attrs: { when: 'platform=epub' },
      children: [paragraph('保留')],
    };
    expect(serializeNode(node)).toContain('保留');
  });

  it('页眉输出 header 标签与类名', () => {
    const node: BookNode = {
      type: NODE_TYPES.PAGE_HEADER,
      id: 'h-1',
      children: [paragraph('书名')],
    };
    const html = serializeNode(node);
    expect(html).toContain('<header');
    expect(html).toContain('bt-page-header');
  });
});
