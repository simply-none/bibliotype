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

describe('paginate 多栏（单序列模型回归）', () => {
  it('阅读顺序恒等于文档顺序（块不再按栏切分重排）', () => {
    /* 曾按块数均分栏再按栏页合并：文档序 b 在 c 前，c 却出现在更早的合并页 */
    const result = paginate(
      [block('a', 80, 2), block('b', 10, 2), block('c', 80, 2), block('d', 80, 2)],
      { pageMainSize: 100 },
    );
    const order = result.pages.flatMap((page) => page.items.map((item) => item.block.id));
    expect(order).toEqual(['a', 'b', 'c', 'd']);
  });

  it('不可拆块放不进当前列剩余空间时对齐下一列首（弃列尾空白）', () => {
    /* a(80) 占列 1；b(80) 放不进剩余 20px → 对齐列 2（used=100）；c 对齐页 2 */
    const result = paginate([block('a', 80, 2), block('b', 80, 2), block('c', 80, 2)], {
      pageMainSize: 100,
    });
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0]!.items.map((item) => item.block.id)).toEqual(['a', 'b']);
    expect(result.pages[1]!.items.map((item) => item.block.id)).toEqual(['c']);
    /* 第 0 页入账含列尾弃用空白（对齐到 2×100 容量内） */
    expect(result.pages[0]!.usedMainSize).toBeLessThanOrEqual(200.5);
  });

  it('多栏页保留页底注（曾合并丢 notes）', () => {
    /* 注块与正文同栏数组（抽取链路按结构树继承 columns） */
    const blocks: MeasurableBlock[] = [
      { id: 'a', mainSize: 80, columns: 2 },
      { id: 'fn1', mainSize: 40, floatToBottom: true, columns: 2 },
      { id: 'b', mainSize: 80, columns: 2 },
    ];
    const result = paginate(blocks, { pageMainSize: 100, noteArea: { maxRatio: 0.4 } });
    const first = result.pages[0]!;
    expect(first.columns).toBe(2);
    expect(first.notes?.map((n) => n.block.id)).toEqual(['fn1']);
    const order = result.pages.flatMap((page) => page.items.map((item) => item.block.id));
    expect(order).toEqual(['a', 'b']);
  });
});
