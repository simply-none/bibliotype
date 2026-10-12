/**
 * 目录提取测试
 */
import { describe, expect, it } from 'vitest';
import { NODE_TYPES, type BookNode } from '@bibliotype/core';
import {
  countOutlineItems,
  extractOutline,
  resolveNodeTitle,
} from '../outline.js';

/** 构造：书 > 卷 > 章 > 节 / 标题 */
function sampleRoot(): BookNode {
  return {
    type: NODE_TYPES.BOOK,
    children: [
      {
        type: NODE_TYPES.VOLUME,
        id: 'vol-1',
        attrs: { title: '卷一' },
        children: [
          {
            type: NODE_TYPES.CHAPTER,
            id: 'chap-1',
            children: [{ type: 'text', text: '学而第一' }],
          },
          {
            type: NODE_TYPES.CHAPTER,
            id: 'chap-2',
            attrs: { title: '为政第二' },
            children: [
              {
                type: NODE_TYPES.SECTION,
                id: 'sec-1',
                attrs: { title: '为政篇上' },
                children: [],
              },
            ],
          },
          { type: NODE_TYPES.CHAPTER, id: 'chap-empty', children: [] },
        ],
      },
    ],
  };
}

describe('resolveNodeTitle', () => {
  it('优先 attrs.title', () => {
    expect(
      resolveNodeTitle({ type: 'chapter', attrs: { title: '学而' } }),
    ).toBe('学而');
  });

  it('回退到首个文本子节点', () => {
    expect(
      resolveNodeTitle({
        type: 'chapter',
        children: [{ type: 'text', text: '为政' }],
      }),
    ).toBe('为政');
  });

  it('递归深入查找嵌套文本', () => {
    expect(
      resolveNodeTitle({
        type: 'heading',
        children: [
          { type: 'paragraph', children: [{ type: 'text', text: '标题在此' }] },
        ],
      }),
    ).toBe('标题在此');
  });

  it('无标题返回空串', () => {
    expect(resolveNodeTitle({ type: 'chapter' })).toBe('');
  });
});

describe('extractOutline', () => {
  it('生成层级目录（卷 → 章 → 节）', () => {
    const outline = extractOutline(sampleRoot());
    expect(outline).toHaveLength(1);

    const volume = outline[0];
    expect(volume).toMatchObject({ nodeId: 'vol-1', type: 'volume', title: '卷一', level: 0 });
    // chap-empty 无标题被跳过
    expect(volume?.children.map((c) => c.nodeId)).toEqual(['chap-1', 'chap-2']);

    const chap2 = volume?.children[1];
    expect(chap2?.title).toBe('为政第二');
    expect(chap2?.children[0]).toMatchObject({
      nodeId: 'sec-1',
      type: 'section',
      level: 2,
    });
  });

  it('includeEmpty 时纳入无标题空容器', () => {
    const outline = extractOutline(sampleRoot(), { includeEmpty: true });
    expect(outline[0]?.children.map((c) => c.nodeId)).toContain('chap-empty');
  });

  it('默认不含 heading，includeHeadings 时纳入', () => {
    const root = sampleRoot();
    // 在章内插入一个标题节点
    root.children?.[0]?.children?.[0]?.children?.push({
      type: NODE_TYPES.HEADING,
      id: 'h-1',
      attrs: { title: '章内标题' },
    });

    const byDefault = extractOutline(root);
    expect(byDefault[0]?.children[0]?.children.map((c) => c.nodeId)).toEqual([]);

    const withHeadings = extractOutline(root, { includeHeadings: true });
    expect(withHeadings[0]?.children[0]?.children.map((c) => c.nodeId)).toEqual(['h-1']);
  });

  it('countOutlineItems 统计全部层级', () => {
    expect(countOutlineItems(extractOutline(sampleRoot()))).toBe(4); // 卷1 + 章2 + 节1
  });
});
