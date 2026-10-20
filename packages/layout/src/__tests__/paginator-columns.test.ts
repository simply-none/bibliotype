/**
 * B4 分栏分页：页容量放大、栏数变化开新页、单栏产物不变
 */
import { describe, expect, it } from 'vitest';
import { paginate, type MeasurableBlock } from '../paginator.js';

function block(id: string, mainSize: number, columns?: number): MeasurableBlock {
  return { id, mainSize, ...(columns === undefined ? {} : { columns }) };
}

describe('paginate 分栏', () => {
  it('两栏页容量翻倍', () => {
    const result = paginate([block('a', 80, 2), block('b', 80, 2), block('c', 80, 2)], {
      pageMainSize: 100,
    });
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0]?.columns).toBe(2);
    expect(result.pages[0]?.items.map((item) => item.block.id)).toEqual(['a', 'b']);
    expect(result.pages[1]?.items.map((item) => item.block.id)).toEqual(['c']);
  });

  it('三栏页容量按三倍计算', () => {
    const result = paginate(
      [block('a', 90, 3), block('b', 90, 3), block('c', 90, 3), block('d', 90, 3)],
      { pageMainSize: 100 },
    );
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0]?.items.map((item) => item.block.id)).toEqual(['a', 'b', 'c']);
    expect(result.pages[0]?.columns).toBe(3);
  });

  it('栏数变化时开启新页', () => {
    const result = paginate([block('a', 50, 1), block('b', 50, 2)], { pageMainSize: 100 });
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0]?.columns).toBeUndefined();
    expect(result.pages[1]?.columns).toBe(2);
  });

  it('单栏产物不含 columns 字段（向后兼容）', () => {
    const result = paginate([block('a', 50)], { pageMainSize: 100 });
    expect(result.pages[0]?.columns).toBeUndefined();
  });

  it('空输入仍校验 pageMainSize', () => {
    expect(() => paginate([], { pageMainSize: 0 })).toThrow(RangeError);
  });
});
