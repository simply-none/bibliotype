/**
 * 目录视图模型测试：默认展开、折叠、活动态祖先展开、搜索过滤与标题高亮分段。
 */
import { describe, expect, it } from 'vitest';
import type { OutlineItem } from '@bibliotype/reader';
import {
  buildTocViewItems,
  splitTocTitle,
  toggleTocExpanded,
  type TocViewItem,
} from '../toc-model.js';

/** 构造：卷一 > 学而（含一节） / 为政 > 朱熹章句 */
function sampleOutline(): OutlineItem[] {
  return [
    {
      nodeId: 'vol-1',
      type: 'volume',
      title: '卷一',
      level: 0,
      children: [
        {
          nodeId: 'chap-1',
          type: 'chapter',
          title: '学而第一',
          level: 1,
          children: [
            {
              nodeId: 'sec-1',
              type: 'section',
              title: '学而篇上',
              level: 2,
              children: [],
            },
          ],
        },
        {
          nodeId: 'chap-2',
          type: 'chapter',
          title: '为政第二',
          level: 1,
          children: [
            {
              nodeId: 'sec-2',
              type: 'section',
              title: '朱熹章句',
              level: 2,
              children: [],
            },
          ],
        },
      ],
    },
  ];
}

function keysOf(rows: readonly TocViewItem[]): string[] {
  return rows.map((row) => row.key);
}

describe('buildTocViewItems：折叠与活动态', () => {
  it('未传 expandedKeys 时全展开（向后兼容旧目录）', () => {
    const rows = buildTocViewItems(sampleOutline());
    expect(keysOf(rows)).toEqual(['vol-1', 'chap-1', 'sec-1', 'chap-2', 'sec-2']);
    expect(rows.map((row) => row.depth)).toEqual([0, 1, 2, 1, 2]);
    expect(rows[0]?.expanded).toBe(true);
    expect(rows[2]?.hasChildren).toBe(false);
    expect(rows[2]?.expanded).toBe(false);
  });

  it('折叠父项后隐藏其子项，父项自身仍在', () => {
    const rows = buildTocViewItems(sampleOutline(), {
      expandedKeys: ['vol-1', 'chap-2'],
    });
    expect(keysOf(rows)).toEqual(['vol-1', 'chap-1', 'chap-2', 'sec-2']);
    expect(rows[1]?.expanded).toBe(false);
  });

  it('全部收起时只剩顶层', () => {
    const rows = buildTocViewItems(sampleOutline(), { expandedKeys: [] });
    expect(keysOf(rows)).toEqual(['vol-1']);
    expect(rows[0]?.expanded).toBe(false);
  });

  it('未受控时活动项祖先自动展开并标记 active', () => {
    const rows = buildTocViewItems(sampleOutline(), {
      activeKey: 'sec-2',
      expandByDefault: false,
    });
    // 祖先展开后同级的其他章节也随之可见（展开的是父项，不是只挑命中链）
    expect(keysOf(rows)).toEqual(['vol-1', 'chap-1', 'chap-2', 'sec-2']);
    expect(rows.filter((row) => row.active).map((row) => row.key)).toEqual(['sec-2']);
    // 活动项自身若无子项不会被误标展开
    expect(rows[3]?.expanded).toBe(false);
  });

  it('受控折叠集合优先于活动项：用户收起后不因翻页被摊开', () => {
    const rows = buildTocViewItems(sampleOutline(), {
      activeKey: 'sec-2',
      expandedKeys: [],
    });
    expect(keysOf(rows)).toEqual(['vol-1']);
    expect(rows.some((row) => row.active)).toBe(false);
  });

  it('活动项是含子项的章节时不强行摊开子级', () => {
    const rows = buildTocViewItems(sampleOutline(), {
      activeKey: 'chap-1',
      expandedKeys: ['vol-1'],
    });
    expect(keysOf(rows)).toEqual(['vol-1', 'chap-1', 'chap-2']);
    expect(rows[1]?.active).toBe(true);
    expect(rows[1]?.expanded).toBe(false);
  });

  it('无 nodeId 的目录项按路径键命中活动态（与 reader.outlineKeyOf 同源）', () => {
    const outline: OutlineItem[] = [
      {
        nodeId: undefined,
        type: 'volume',
        title: '卷',
        level: 0,
        children: [{ nodeId: undefined, type: 'chapter', title: '章', level: 1, children: [] }],
      },
    ];
    const rows = buildTocViewItems(outline, {
      activeKey: 'outline:0.0',
      expandedKeys: ['outline:0'],
    });
    expect(keysOf(rows)).toEqual(['outline:0', 'outline:0.0']);
    expect(rows[1]?.active).toBe(true);
  });
});

describe('buildTocViewItems：目录内搜索', () => {
  it('只保留命中项与祖先链，并强制展开祖先', () => {
    const rows = buildTocViewItems(sampleOutline(), {
      query: '朱熹',
      expandedKeys: [],
    });
    expect(keysOf(rows)).toEqual(['vol-1', 'chap-2', 'sec-2']);
    expect(rows.map((row) => row.matched)).toEqual([false, false, true]);
    // 命中项的祖先被强制展开
    expect(rows[0]?.expanded).toBe(true);
    expect(rows[1]?.expanded).toBe(true);
  });

  it('搜索词去首尾空格且大小写不敏感', () => {
    const outline: OutlineItem[] = [
      { nodeId: 'h-1', type: 'heading', title: 'Analects 学而', level: 0, children: [] },
    ];
    expect(buildTocViewItems(outline, { query: '  analects ' })).toHaveLength(1);
    expect(buildTocViewItems(outline, { query: 'analects' })[0]?.matched).toBe(true);
  });

  it('无命中时返回空行（空态由组件呈现）', () => {
    expect(buildTocViewItems(sampleOutline(), { query: '不存在' })).toEqual([]);
  });

  it('空搜索词等同于不筛选', () => {
    expect(buildTocViewItems(sampleOutline(), { query: '   ' })).toHaveLength(5);
  });
});

describe('toggleTocExpanded', () => {
  it('展开追加、收起删除，且不改原数组', () => {
    const source = ['a'];
    expect(toggleTocExpanded(source, 'b')).toEqual(['a', 'b']);
    expect(toggleTocExpanded(source, 'a')).toEqual([]);
    expect(source).toEqual(['a']);
  });

  it('连续切换两次回到原状态', () => {
    const once = toggleTocExpanded([], 'vol-1');
    expect(toggleTocExpanded(once, 'vol-1')).toEqual([]);
  });
});

describe('splitTocTitle', () => {
  it('把命中片段单独切出（可多次命中）', () => {
    expect(splitTocTitle('朱熹与朱子学', '朱')).toEqual([
      { text: '朱', matched: true },
      { text: '熹与', matched: false },
      { text: '朱', matched: true },
      { text: '子学', matched: false },
    ]);
  });

  it('空搜索词返回整段非命中', () => {
    expect(splitTocTitle('学而', '')).toEqual([{ text: '学而', matched: false }]);
  });

  it('大小写不敏感且保留原文大小写', () => {
    expect(splitTocTitle('Analects', 'anal')).toEqual([
      { text: 'Anal', matched: true },
      { text: 'ects', matched: false },
    ]);
  });
});
