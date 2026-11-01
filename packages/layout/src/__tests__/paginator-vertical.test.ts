/**
 * 直排分页行为基线（2026-11 满版根治轮）
 *
 * 锁定三个本轮修复的行为，防回归：
 * 1. br 断列（breakColumn）恰落在列界上时，模型多记一整列——浏览器的 <br>
 *    在「内容恰好排满一列」时仍会另起一列（空列），模型不同步则其后内容
 *    整体错位一列（页中出现整列空白）；
 * 2. 直排装箱容差按字位相对取（~0.01px），0.5px 的绝对亚像素容差会让页末
 *    近一字溢出列界被裁；
 * 3. 单栏直排产物不含 columns 字段（分栏是横排概念）。
 */
import { describe, expect, it } from 'vitest';
import { paginate, type MeasurableBlock } from '../paginator.js';

/** 直排块（axis column；columnMainSize = 列距 30） */
function vblock(
  id: string,
  mainSize: number,
  opts: Partial<MeasurableBlock> = {},
): MeasurableBlock {
  return {
    id,
    mainSize,
    axis: 'column',
    columnMainSize: 30,
    ...opts,
  };
}

describe('paginate 直排：br 断列在列界上产生空列（模型同步）', () => {
  it('前块恰满两列时，断列块另起一页（空列占满第三列）', () => {
    /* 页容量 90 = 3 列 × 30；块 A 恰好占满 2 列（60），块 B 断列占 1 列 */
    const a = vblock('a', 60, { splittable: true, lineSize: 1, lineCount: 60 });
    const b = vblock('b', 30, { breakColumn: true });
    const result = paginate([a, b], { pageMainSize: 90 });

    /* 旧行为（无空列记账）：B 挤进 page0 的第三列——渲染时 <br> 实际产生
     * 一个整列空白、B 落在第 4 列被裁（模型与渲染错位一列）。
     * 新行为：空列入账后 B 放不下，另起一页。 */
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0]?.items.map((item) => item.block.id)).toEqual(['a']);
    expect(result.pages[0]?.usedMainSize).toBe(90);
    expect(result.pages[1]?.items.map((item) => item.block.id)).toEqual(['b']);
  });

  it('断列点在列中（非列界）时仍按弃用列尾对齐，不多记', () => {
    /* 块 A 占 1.5 列（45px），断列块 B 对齐到第 2 列首（弃用 0.5 列） */
    const a = vblock('a', 45, { splittable: true, lineSize: 1, lineCount: 45 });
    const b = vblock('b', 30, { breakColumn: true });
    const result = paginate([a, b], { pageMainSize: 90 });

    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]?.items.map((item) => item.block.id)).toEqual(['a', 'b']);
    expect(result.pages[0]?.usedMainSize).toBe(90);
  });
});

describe('paginate 直排：容差按字位相对取', () => {
  it('页尾 0.4px 的碎块不再被 0.5px 绝对容差挤进本页', () => {
    /* 块 A 占 89.7px（页容量 90），碎块 B 仅 0.4px：旧绝对容差（+0.5px）
     * 会把 B 判进本页 → 渲染时 B 的字位越出列界被裁。新相对容差（约
     * 0.02px）判 B 换页。 */
    const a = vblock('a', 89.7, { splittable: true, lineSize: 1, lineCount: 89 });
    const b = vblock('b', 0.4);
    const result = paginate([a, b], { pageMainSize: 90 });

    expect(result.pages).toHaveLength(2);
    expect(result.pages[0]?.items.map((item) => item.block.id)).toEqual(['a']);
    expect(result.pages[1]?.items.map((item) => item.block.id)).toEqual(['b']);
  });
});

describe('paginate 直排：产物口径', () => {
  it('单栏直排产物不含 columns 字段（分栏是横排概念）', () => {
    const result = paginate([vblock('a', 30)], { pageMainSize: 90 });
    expect(result.pages[0]?.columns).toBeUndefined();
  });
});
