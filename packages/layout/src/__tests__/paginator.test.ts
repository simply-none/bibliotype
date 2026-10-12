/**
 * 分页器测试
 */
import { describe, expect, it } from 'vitest';
import { paginate, type MeasurableBlock } from '../paginator.js';

const block = (
  id: string,
  mainSize: number,
  extra: Partial<MeasurableBlock> = {},
): MeasurableBlock => ({ id, mainSize, ...extra });

describe('paginate', () => {
  it('贪心装箱：超出页面主轴尺寸时换页', () => {
    const result = paginate(
      [block('a', 60), block('b', 60), block('c', 60)],
      { pageMainSize: 100 },
    );
    expect(result.totalPages).toBe(3);
    expect(result.pages[0]?.blocks.map((b) => b.id)).toEqual(['a']);
    expect(result.pages[1]?.usedMainSize).toBe(60);
  });

  it('同页容纳多块', () => {
    const result = paginate(
      [block('a', 40), block('b', 40), block('c', 40)],
      { pageMainSize: 100 },
    );
    expect(result.totalPages).toBe(2);
    expect(result.pages[0]?.blocks.map((b) => b.id)).toEqual(['a', 'b']);
    expect(result.pages[1]?.blocks.map((b) => b.id)).toEqual(['c']);
  });

  it('breakBefore 强制章首换页', () => {
    const result = paginate(
      [block('a', 20), block('chapter', 20, { breakBefore: true }), block('c', 20)],
      { pageMainSize: 1000 },
    );
    expect(result.totalPages).toBe(2);
    expect(result.pages[1]?.blocks[0]?.id).toBe('chapter');
  });

  it('breakAfter 强制其后换页', () => {
    const result = paginate(
      [block('volume-end', 20, { breakAfter: true }), block('next', 20)],
      { pageMainSize: 1000 },
    );
    expect(result.totalPages).toBe(2);
    expect(result.pages[0]?.blocks[0]?.id).toBe('volume-end');
  });

  it('keepWithNext：标题与首段放不下时整体换页', () => {
    const result = paginate(
      [
        block('filler', 70),
        block('heading', 20, { keepWithNext: true }),
        block('para', 20),
      ],
      { pageMainSize: 100 },
    );
    // filler 独占第一页；heading+para 同页（70+20+20 > 100）
    expect(result.totalPages).toBe(2);
    expect(result.pages[1]?.blocks.map((b) => b.id)).toEqual(['heading', 'para']);
  });

  it('超大块独占一页且不陷入循环', () => {
    const result = paginate(
      [block('big', 500), block('small', 10)],
      { pageMainSize: 100 },
    );
    expect(result.totalPages).toBe(2);
    expect(result.pages[0]?.blocks.map((b) => b.id)).toEqual(['big']);
  });

  it('空输入返回空结果', () => {
    const result = paginate([], { pageMainSize: 100 });
    expect(result.pages).toEqual([]);
    expect(result.totalPages).toBe(0);
    expect(result.totalBlocks).toBe(0);
  });

  it('非法参数抛出 RangeError', () => {
    expect(() => paginate([], { pageMainSize: 0 })).toThrow(RangeError);
    expect(() => paginate([block('x', -1)], { pageMainSize: 100 })).toThrow(RangeError);
  });
});
