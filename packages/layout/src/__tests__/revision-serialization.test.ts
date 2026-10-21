/**
 * 修订视图序列化（C5）：标记 / 终稿 / 原稿三种输出。
 */
import { describe, expect, it } from 'vitest';
import { MARK_TYPES, NODE_TYPES } from '@bibliotype/core';
import type { BookNode } from '@bibliotype/core';
import { serializeNode } from '../html/html-serializer.js';

function text(value: string, marks?: BookNode['marks']): BookNode {
  return marks === undefined ? { type: 'text', text: value } : { type: 'text', text: value, marks };
}

const paragraph: BookNode = {
  type: NODE_TYPES.PARAGRAPH,
  children: [
    text('保留'),
    text('新增', [
      { type: MARK_TYPES.INSERTION, attrs: { changeId: 'c-ins', author: '甲', timestamp: 100 } },
    ]),
    text('删除', [{ type: MARK_TYPES.DELETION, attrs: { changeId: 'c-del', author: '乙' } }]),
    text('格式', [
      { type: MARK_TYPES.FORMAT_CHANGE, attrs: { changeId: 'c-fmt', previous: '[]' } },
      { type: MARK_TYPES.STRONG },
    ]),
  ],
};

describe('revisionView 序列化', () => {
  it('缺省输出修订标记与元信息', () => {
    const html = serializeNode(paragraph);
    expect(html).toContain('<ins class="bt-mark-insertion"');
    expect(html).toContain('data-change-id="c-ins"');
    expect(html).toContain('data-author="甲"');
    expect(html).toContain('<del class="bt-mark-deletion"');
    expect(html).toContain('<span class="bt-mark-format-change"');
    expect(html).toContain('删除');
  });

  it('final 呈现终稿：删除隐去、插入去标记', () => {
    const html = serializeNode(paragraph, { revisionView: 'final' });
    expect(html).toContain('保留');
    expect(html).toContain('新增');
    expect(html).not.toContain('删除');
    expect(html).not.toContain('bt-mark-insertion');
    expect(html).not.toContain('bt-mark-deletion');
    expect(html).not.toContain('bt-mark-format-change');
    // 格式变更被接受：保留当前 strong
    expect(html).toContain('<strong>格式</strong>');
  });

  it('original 呈现原稿：插入隐去、删除复原、格式回滚', () => {
    const html = serializeNode(paragraph, { revisionView: 'original' });
    expect(html).toContain('保留');
    expect(html).not.toContain('新增');
    expect(html).toContain('删除');
    expect(html).not.toContain('bt-mark-insertion');
    expect(html).not.toContain('bt-mark-deletion');
    expect(html).not.toContain('<strong>格式</strong>');
    expect(html).toContain('格式');
  });

  it('marked 显式指定时与缺省一致', () => {
    expect(serializeNode(paragraph, { revisionView: 'marked' })).toBe(serializeNode(paragraph));
  });
});
