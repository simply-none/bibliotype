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

  it('无结构容器（仅 heading + paragraph）时回退用标题建目', () => {
    // 导入的 Markdown / DOCX / EPUB 常见形态：根下没有卷 / 章 / 节
    const root: BookNode = {
      type: NODE_TYPES.BOOK,
      children: [
        { type: NODE_TYPES.HEADING, id: 'h-1', children: [{ type: 'text', text: '学而' }] },
        { type: NODE_TYPES.PARAGRAPH, id: 'p-1', children: [{ type: 'text', text: '子曰' }] },
        { type: NODE_TYPES.HEADING, id: 'h-2', attrs: { title: '为政' } },
        { type: NODE_TYPES.HEADING, id: 'h-empty', children: [] },
      ],
    };

    const outline = extractOutline(root);
    expect(outline.map((i) => i.nodeId)).toEqual(['h-1', 'h-2']);
    expect(outline.map((i) => i.title)).toEqual(['学而', '为政']);
    expect(outline.every((i) => i.level === 0)).toBe(true);

    // 回退只在「整本无条目」时触发：有结构节点的文档不会混入标题（避免重复）
    expect(extractOutline(sampleRoot()).every((i) => i.type !== NODE_TYPES.HEADING)).toBe(true);
  });

  it('节点无 id 时以树路径作 nodeId（与 extractBlocks 口径一致）', () => {
    const root: BookNode = {
      type: NODE_TYPES.BOOK,
      children: [
        {
          type: NODE_TYPES.VOLUME,
          children: [
            // 文本子节点不成块、不占路径位（extractBlocks 先过滤再按序号取名）
            { type: 'text', text: '卷首噪声' },
            { type: NODE_TYPES.CHAPTER, attrs: { title: '学而第一' } },
          ],
        },
        { type: NODE_TYPES.HEADING, attrs: { title: '篇末标题' } },
      ],
    };

    const outline = extractOutline(root);
    expect(outline.map((i) => i.nodeId)).toEqual(['/0']);
    expect(outline[0]?.children.map((i) => i.nodeId)).toEqual(['/0/0']);
    // 回退到标题建目时同样拿到路径 id
    expect(extractOutline(root, { includeHeadings: true })[1]?.nodeId).toBe('/1');
  });

  it('countOutlineItems 统计全部层级', () => {
    expect(countOutlineItems(extractOutline(sampleRoot()))).toBe(4); // 卷1 + 章2 + 节1
  });

  it('无结构容器时按 heading 级别建父子（h2 挂到最近的 h1 之下）', () => {
    const root: BookNode = {
      type: NODE_TYPES.BOOK,
      children: [
        { type: NODE_TYPES.HEADING, id: 'h-1', attrs: { level: 1, title: '卷一' } },
        { type: NODE_TYPES.PARAGRAPH, id: 'p-1', children: [{ type: 'text', text: '正文' }] },
        { type: NODE_TYPES.HEADING, id: 'h-2', attrs: { level: 2, title: '第一章' } },
        { type: NODE_TYPES.HEADING, id: 'h-3', attrs: { level: 3, title: '第一节' } },
        { type: NODE_TYPES.HEADING, id: 'h-4', attrs: { level: 2, title: '第二章' } },
      ],
    };

    const outline = extractOutline(root);
    expect(outline.map((item) => item.nodeId)).toEqual(['h-1']);
    expect(outline[0]?.level).toBe(0);
    expect(outline[0]?.children.map((item) => item.nodeId)).toEqual(['h-2', 'h-4']);
    expect(outline[0]?.children[0]?.level).toBe(1);
    expect(outline[0]?.children[0]?.children.map((item) => item.nodeId)).toEqual(['h-3']);
    expect(outline[0]?.children[0]?.children[0]?.level).toBe(2);
  });

  it('跳级标题挂到最近更高级，同级标题并列', () => {
    const root: BookNode = {
      type: NODE_TYPES.BOOK,
      children: [
        { type: NODE_TYPES.HEADING, id: 'h-1', attrs: { level: 1, title: '第一章' } },
        /* h1 后直接出现 h3：挂到最近更高级的 h1 之下，而不是漏掉 */
        { type: NODE_TYPES.HEADING, id: 'h-3a', attrs: { level: 3, title: '一节' } },
        { type: NODE_TYPES.HEADING, id: 'h-3b', attrs: { level: 3, title: '二节' } },
        { type: NODE_TYPES.HEADING, id: 'h-2', attrs: { level: 1, title: '第二章' } },
      ],
    };

    const outline = extractOutline(root);
    expect(outline.map((item) => item.nodeId)).toEqual(['h-1', 'h-2']);
    expect(outline[0]?.children.map((item) => item.nodeId)).toEqual(['h-3a', 'h-3b']);
    expect(outline[1]?.children).toEqual([]);
  });
});
