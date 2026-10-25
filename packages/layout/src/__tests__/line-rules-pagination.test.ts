/**
 * 行款分页折算测试（直排 v2 批 4）
 *
 * 覆盖：breakColumn 断列（直排当前列剩余弃用、块从新列起写；横排无操作）、
 * 估算器低格折算（首行容量扣减）。
 */
import { describe, expect, it } from 'vitest';
import { paginate, type MeasurableBlock } from '../paginator.js';

/** 直排块（axis column，lineSize = 列距） */
function vblock(id: string, size: number, extra: Partial<MeasurableBlock> = {}): MeasurableBlock {
  return { id, mainSize: size, lineSize: 20, splittable: true, axis: 'column', ...extra };
}

describe('paginate breakColumn（列级断列）', () => {
  it('直排：断列块从新列起写——当前列剩余空间弃用（usedMainSize 对齐列距）', () => {
    /* 页容量 100（5 列），a 占 45（2.25 列）；b 断列 → a 后对齐到 60（3 列），b 占 30 → 90 同页 */
    const result = paginate(
      [vblock('a', 45), vblock('b', 30, { breakColumn: true })],
      { pageMainSize: 100 },
    );
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]?.usedMainSize).toBe(90);
    expect(result.pages[0]?.items.map((item) => item.block.id)).toEqual(['a', 'b']);
  });

  it('断列后放不下则换页（原子块不挤入本页剩余）', () => {
    /* a 占 45 → 对齐 60；b 占 45 且原子（不可拆）→ 60+45 > 100 → b 换页。
     * 可拆块会被行级拆分放进剩余（断列只约束起点，不禁止续排） */
    const result = paginate(
      [vblock('a', 45), { ...vblock('b', 45, { breakColumn: true }), splittable: false }],
      { pageMainSize: 100 },
    );
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0]?.items.map((item) => item.block.id)).toEqual(['a']);
    expect(result.pages[0]?.usedMainSize).toBe(60);
    expect(result.pages[1]?.items.map((item) => item.block.id)).toEqual(['b']);
  });

  it('横排无操作：breakColumn 在 axis row 下不改变装箱', () => {
    const block = (id: string, size: number): MeasurableBlock => ({
      id,
      mainSize: size,
      lineSize: 20,
      splittable: true,
      breakColumn: true,
    });
    const result = paginate([block('a', 45), block('b', 45)], { pageMainSize: 100 });
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]?.usedMainSize).toBe(90);
  });

  it('页首块断列无操作（onFreshPage 不对齐）', () => {
    const result = paginate([vblock('a', 30, { breakColumn: true })], { pageMainSize: 100 });
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]?.usedMainSize).toBe(30);
  });
});
