/**
 * 文档块提取测试
 */
import { describe, expect, it } from 'vitest';
import { NODE_TYPES, createEmptyDocument, type BookDocument } from '@bibliotype/core';
import {
  DEFAULT_MEASURE_CONTEXT,
  defaultEstimator,
  extractBlocks,
  extractBlocksIndexed,
} from '../document-blocks.js';

/** 构造：书 > 卷 > 章（标题 + 两段） + 章（一段） */
function sampleDoc(): BookDocument {
  const doc = createEmptyDocument({ title: '样本' });
  doc.root.children = [
    {
      type: NODE_TYPES.VOLUME,
      id: 'vol-1',
      children: [
        {
          type: NODE_TYPES.CHAPTER,
          id: 'chap-1',
          children: [
            {
              type: NODE_TYPES.HEADING,
              id: 'h-1',
              children: [{ type: 'text', text: '学而第一' }],
            },
            {
              type: NODE_TYPES.PARAGRAPH,
              id: 'p-1',
              children: [{ type: 'text', text: '子曰' }],
            },
            {
              type: NODE_TYPES.PARAGRAPH,
              id: 'p-2',
              children: [{ type: 'text', text: '有朋自远方来' }],
            },
          ],
        },
        {
          type: NODE_TYPES.CHAPTER,
          id: 'chap-2',
          children: [
            {
              type: NODE_TYPES.PARAGRAPH,
              id: 'p-3',
              children: [{ type: 'text', text: '为政以德' }],
            },
          ],
        },
      ],
    },
  ];
  return doc;
}

describe('extractBlocks', () => {
  it('展开为叶块序列（结构容器不入块）', () => {
    const blocks = extractBlocks(sampleDoc());
    expect(blocks.map((b) => b.id)).toEqual(['h-1', 'p-1', 'p-2', 'p-3']);
  });

  it('章首块标记 breakBefore（章的第一个叶块）', () => {
    const blocks = extractBlocks(sampleDoc());
    const h1 = blocks.find((b) => b.id === 'h-1');
    const p3 = blocks.find((b) => b.id === 'p-3');
    expect(h1?.breakBefore).toBe(true);
    expect(p3?.breakBefore).toBe(true);
    expect(blocks.find((b) => b.id === 'p-1')?.breakBefore).toBeUndefined();
  });

  it('分页符块（break variant=page）标记 breakAfter，其他变体不标记', () => {
    const doc = createEmptyDocument({ title: '分页符' });
    doc.root.children = [
      {
        type: NODE_TYPES.CHAPTER,
        id: 'chap-1',
        children: [
          { type: NODE_TYPES.PARAGRAPH, id: 'p-1', children: [{ type: 'text', text: '上页' }] },
          { type: NODE_TYPES.BREAK, id: 'br-page', attrs: { variant: 'page' } },
          { type: NODE_TYPES.PARAGRAPH, id: 'p-2', children: [{ type: 'text', text: '新页' }] },
          { type: NODE_TYPES.BREAK, id: 'br-hr', attrs: { variant: 'hr' } },
          { type: NODE_TYPES.PARAGRAPH, id: 'p-3', children: [{ type: 'text', text: '分隔线后' }] },
        ],
      },
    ];
    const blocks = extractBlocks(doc);
    expect(blocks.map((b) => b.id)).toEqual(['p-1', 'br-page', 'p-2', 'br-hr', 'p-3']);
    expect(blocks.find((b) => b.id === 'br-page')?.breakAfter).toBe(true);
    expect(blocks.find((b) => b.id === 'br-hr')?.breakAfter).toBeUndefined();
    // 分页符自身不是正文段：不可拆，也不继承前后块的换页标记
    expect(blocks.find((b) => b.id === 'br-page')?.splittable).toBeUndefined();
    expect(blocks.find((b) => b.id === 'p-2')?.breakAfter).toBeUndefined();
  });

  it('分页符作为结构容器首块时不带 breakBefore（否则它独占一页多出一张空白页）', () => {
    const doc = createEmptyDocument({ title: '卷首分页符' });
    doc.root.children = [
      {
        type: NODE_TYPES.CHAPTER,
        id: 'chap-1',
        children: [
          { type: NODE_TYPES.BREAK, id: 'br-page', attrs: { variant: 'page' } },
          { type: NODE_TYPES.PARAGRAPH, id: 'p-1', children: [{ type: 'text', text: '正文' }] },
        ],
      },
    ];
    const blocks = extractBlocks(doc);
    expect(blocks.map((b) => b.id)).toEqual(['br-page', 'p-1']);
    // 结构容器首块本应带 breakBefore，分页符例外：它的 breakAfter 已足够让后继另起一页
    expect(blocks[0]?.breakBefore).toBeUndefined();
    expect(blocks[0]?.breakAfter).toBe(true);
    expect(blocks[1]?.breakBefore).toBeUndefined();
  });

  it('标题块标记 keepWithNext', () => {
    const blocks = extractBlocks(sampleDoc());
    expect(blocks.find((b) => b.id === 'h-1')?.keepWithNext).toBe(true);
    expect(blocks.find((b) => b.id === 'p-1')?.keepWithNext).toBeUndefined();
  });

  it('正文段落标 splittable + lineSize，标题不标（纸书行级续排）', () => {
    const blocks = extractBlocks(sampleDoc());
    const p1 = blocks.find((b) => b.id === 'p-1');
    expect(p1?.splittable).toBe(true);
    expect(p1?.lineSize).toBe(DEFAULT_MEASURE_CONTEXT.lineSize);
    // 标题恒整块，不标可拆
    expect(blocks.find((b) => b.id === 'h-1')?.splittable).toBeUndefined();
  });

  it('lineSize 随估算上下文行高联动', () => {
    const blocks = extractBlocks(sampleDoc(), { context: { lineSize: 42 } });
    expect(blocks.find((b) => b.id === 'p-2')?.lineSize).toBe(42);
  });

  it('无 id 节点使用稳定的路径 id', () => {
    const doc = createEmptyDocument({ title: '无 id' });
    doc.root.children = [
      {
        type: NODE_TYPES.PARAGRAPH,
        children: [{ type: 'text', text: '第一段' }],
      },
      {
        type: NODE_TYPES.PARAGRAPH,
        children: [{ type: 'text', text: '第二段' }],
      },
    ];
    const first = extractBlocks(doc).map((b) => b.id);
    const second = extractBlocks(doc).map((b) => b.id);
    expect(first).toEqual(second);
    expect(first).toEqual(['/0', '/1']);
  });

  it('默认估算器按文本长度折算尺寸', () => {
    const node = {
      type: NODE_TYPES.PARAGRAPH,
      children: [{ type: 'text', text: '甲'.repeat(53) }],
    };
    // 53 字符 / 每行 26 → 3 行 → 3×30 + 12
    const size = defaultEstimator(node, DEFAULT_MEASURE_CONTEXT);
    expect(size).toBe(3 * 30 + 12);
  });

  it('自定义估算器与上下文可覆盖', () => {
    const blocks = extractBlocks(sampleDoc(), {
      estimator: () => 7,
      context: { charsPerLine: 1 },
    });
    expect(blocks.every((b) => b.mainSize === 7)).toBe(true);
  });

  it('blockSizes 命中且为正的块采用实测尺寸，其余回退估算', () => {
    const baseline = extractBlocks(sampleDoc());
    const blocks = extractBlocks(sampleDoc(), {
      blockSizes: new Map([
        ['p-1', 500], // 命中→实测
        ['p-3', 0], // 非正→回退估算
      ]),
    });
    expect(blocks.find((b) => b.id === 'p-1')?.mainSize).toBe(500);
    // p-3 实测 0 无效，与基线估算一致
    expect(blocks.find((b) => b.id === 'p-3')?.mainSize).toBe(
      baseline.find((b) => b.id === 'p-3')?.mainSize,
    );
    // 未提供的块保持估算
    expect(blocks.find((b) => b.id === 'h-1')?.mainSize).toBe(
      baseline.find((b) => b.id === 'h-1')?.mainSize,
    );
  });

  it('blockSizes 不改变分块结构与 flags', () => {
    const blocks = extractBlocks(sampleDoc(), { blockSizes: new Map([['p-1', 400]]) });
    expect(blocks.map((b) => b.id)).toEqual(['h-1', 'p-1', 'p-2', 'p-3']);
    expect(blocks.find((b) => b.id === 'h-1')?.keepWithNext).toBe(true);
    expect(blocks.find((b) => b.id === 'p-3')?.breakBefore).toBe(true);
  });

  it('lineOffsets 命中时 splittable 段落行高改用实测均高并显式给定行数', () => {
    const blocks = extractBlocks(sampleDoc(), {
      blockSizes: new Map([['p-1', 608], ['p-2', 40]]), // p-1 实渲 20 行×30.4；p-2 单行
      lineOffsets: new Map([['p-1', Array.from({ length: 20 }, (_, i) => i * 26)]]),
    });
    // 多行命中：均高 608/20=30.4（而非估算 30，消除 paginate 幽灵行页底空白）
    const p1 = blocks.find((b) => b.id === 'p-1');
    expect(p1?.lineSize).toBeCloseTo(30.4);
    // 行数显式给定：mainSize 含块尾间距时不再被 round 折算出幽灵行
    expect(p1?.lineCount).toBe(20);
    // 未命中 lineOffsets：回退 context 行高，不标行数
    const p2 = blocks.find((b) => b.id === 'p-2');
    expect(p2?.lineSize).toBe(30);
    expect(p2?.lineCount).toBeUndefined();
    // 不可拆块不标 lineSize
    expect(blocks.find((b) => b.id === 'h-1')?.lineSize).toBeUndefined();
  });

  it('lineSizes 命中时行高优先用真实行高（自身高÷行数，不含块间距）', () => {
    const blocks = extractBlocks(sampleDoc(), {
      // 推进量 624 = 20 行×30.4 + 块尾折叠外边距 16；旧口径会摊成 31.2/行
      blockSizes: new Map([['p-1', 624]]),
      lineOffsets: new Map([['p-1', Array.from({ length: 20 }, (_, i) => i * 26)]]),
      lineSizes: new Map([['p-1', 608 / 20]]),
    });
    const p1 = blocks.find((b) => b.id === 'p-1');
    expect(p1?.lineSize).toBeCloseTo(30.4);
    expect(p1?.lineCount).toBe(20);
    expect(p1?.mainSize).toBe(624);
  });

  it('bodySizes 命中时产出 bodyMainSize（页内追加代价按体高计）', () => {
    const blocks = extractBlocks(sampleDoc(), {
      // 推进量 624 = 体高 608（20 行×30.4）+ 与下一块的折叠间距 16
      blockSizes: new Map([['p-1', 624]]),
      lineOffsets: new Map([['p-1', Array.from({ length: 20 }, (_, i) => i * 26)]]),
      lineSizes: new Map([['p-1', 608 / 20]]),
      bodySizes: new Map([['p-1', 608]]),
    });
    const p1 = blocks.find((b) => b.id === 'p-1');
    expect(p1?.mainSize).toBe(624);
    expect(p1?.bodyMainSize).toBeCloseTo(608, 6);
    // 未实测推进量的块走估算口径（1 行×30 + 间距 12 → 体高 30）
    const p2 = blocks.find((b) => b.id === 'p-2');
    expect(p2?.mainSize).toBe(42);
    expect(p2?.bodyMainSize).toBe(30);
  });

  it('bodySizes 未命中时多行可拆段按「行数 × 真实行高」折算体高', () => {
    const blocks = extractBlocks(sampleDoc(), {
      blockSizes: new Map([['p-1', 624]]),
      lineOffsets: new Map([['p-1', Array.from({ length: 20 }, (_, i) => i * 26)]]),
      lineSizes: new Map([['p-1', 608 / 20]]),
    });
    expect(blocks.find((b) => b.id === 'p-1')?.bodyMainSize).toBeCloseTo(608, 6);
  });

  it('推进量与体高相差不足 0.5px 属亚像素噪声 → 不产出 bodyMainSize', () => {
    const blocks = extractBlocks(sampleDoc(), {
      blockSizes: new Map([['p-1', 30.3]]),
      bodySizes: new Map([['p-1', 30]]),
    });
    expect(blocks.find((b) => b.id === 'p-1')?.bodyMainSize).toBeUndefined();
  });

  it('估算口径同样按行高回折体高（不把 blockSpacing 重复计入代价）', () => {
    // 默认估算：1 行 × 30 + 块间距 12 = 42 推进量 → 体高 30
    const blocks = extractBlocks(sampleDoc());
    const p1 = blocks.find((b) => b.id === 'p-1');
    expect(p1?.mainSize).toBe(42);
    expect(p1?.bodyMainSize).toBe(30);
    // 不可拆的标题块同样受益（UA 外边距不重复扣）
    expect(blocks.find((b) => b.id === 'h-1')?.bodyMainSize).toBe(30);
  });

  it('含行内载体（空元素/纯文本载体）的块不拆开', () => {
    const doc = createEmptyDocument({ title: '行内载体' });
    doc.root.children = [
      {
        type: NODE_TYPES.PARAGRAPH,
        id: 'p-inline',
        children: [
          { type: 'text', text: '子曰学而时习之' },
          // 校勘符号：无子元素的空元素载体
          { type: 'collation-mark', id: 'mark-1', attrs: { symbol: '○' } },
          // 避讳字：仅含文本子节点的行内载体
          {
            type: 'taboo-char',
            id: 'char-1',
            children: [{ type: 'text', text: '丘' }],
          },
        ],
      },
    ];
    const blocks = extractBlocks(doc);
    expect(blocks.map((b) => b.id)).toEqual(['p-inline']);
    // 度量按整体文本（含载体文本）折算
    expect(blocks[0]?.mainSize).toBeGreaterThan(0);
  });

  it('版式文本容器规范化后整体成块（编辑保存形态：容器 + 段落）', () => {
    const doc = createEmptyDocument({ title: '注文规范化' });
    doc.root.children = [
      {
        type: NODE_TYPES.CHAPTER,
        id: 'chap-1',
        children: [
          {
            type: 'double-note',
            id: 'note-1',
            children: [
              {
                type: NODE_TYPES.PARAGRAPH,
                children: [{ type: 'text', text: '朱子曰：学之为言效也。' }],
              },
            ],
          },
          {
            type: NODE_TYPES.FOOTNOTE,
            id: 'fn-1',
            children: [
              {
                type: NODE_TYPES.PARAGRAPH,
                children: [{ type: 'text', text: '注① 愠，怒也。' }],
              },
            ],
          },
          {
            type: 'collation-note',
            id: 'colla-1',
            children: [
              {
                type: NODE_TYPES.PARAGRAPH,
                children: [
                  { type: 'text', text: '校勘记：' },
                  { type: 'collation-mark', attrs: { symbol: '○' } },
                ],
              },
            ],
          },
        ],
      },
    ];

    const blocks = extractBlocks(doc);
    /* 容器整体成块：稳定 id 保留，内部无 id 段落不单独成块 */
    expect(blocks.map((b) => b.id)).toEqual(['note-1', 'fn-1', 'colla-1']);
    /* 度量按容器全文折算 */
    expect(blocks[0]?.mainSize).toBeGreaterThan(0);
  });

  it('结构页容器（封面/书名页/版权页/封底）首块 mark breakBefore', () => {
    const doc = createEmptyDocument({ title: '结构页' });
    const pageChild = (type: string, id: string) => ({
      type,
      id,
      children: [
        { type: NODE_TYPES.PARAGRAPH, id: `${id}-p`, children: [{ type: 'text', text: '内容' }] },
      ],
    });
    doc.root.children = [
      pageChild(NODE_TYPES.COVER, 'cover'),
      pageChild(NODE_TYPES.TITLE_PAGE, 'title'),
      pageChild(NODE_TYPES.COPYRIGHT_PAGE, 'copyright'),
      pageChild(NODE_TYPES.BACK_COVER, 'back'),
      pageChild(NODE_TYPES.PREFACE, 'preface'),
      pageChild(NODE_TYPES.APPENDIX, 'appendix'),
      pageChild(NODE_TYPES.POSTSCRIPT, 'postscript'),
      pageChild(NODE_TYPES.TOC, 'toc'),
    ];
    const blocks = extractBlocks(doc);
    for (const id of [
      'cover-p',
      'title-p',
      'copyright-p',
      'back-p',
      'preface-p',
      'appendix-p',
      'postscript-p',
      'toc-p',
    ]) {
      expect(blocks.find((b) => b.id === id)?.breakBefore).toBe(true);
    }
  });
});

describe('extractBlocksIndexed', () => {
  it('blocks 与 extractBlocks 一致，nodeById 为块 id → 源节点索引', () => {
    const doc = sampleDoc();
    const indexed = extractBlocksIndexed(doc);
    expect(indexed.blocks.map((b) => b.id)).toEqual(extractBlocks(doc).map((b) => b.id));
    expect([...indexed.nodeById.keys()]).toEqual(['h-1', 'p-1', 'p-2', 'p-3']);
    // 节点引用指向源 IR 树（切片 / 渲染免二次全树查找）
    const volume = doc.root.children?.[0] as { children?: Array<{ children?: Array<{ id?: string }> }> };
    expect(indexed.nodeById.get('h-1')).toBe(volume.children?.[0]?.children?.[0]);
    expect(indexed.nodeById.get('p-3')).toBe(volume.children?.[1]?.children?.[0]);
  });

  it('路径 id 的块同样入索引', () => {
    const doc = createEmptyDocument({ title: '无 id' });
    doc.root.children = [
      { type: NODE_TYPES.PARAGRAPH, children: [{ type: 'text', text: '第一段' }] },
    ];
    const indexed = extractBlocksIndexed(doc);
    expect(indexed.nodeById.get('/0')).toBe(doc.root.children?.[0]);
  });
});
