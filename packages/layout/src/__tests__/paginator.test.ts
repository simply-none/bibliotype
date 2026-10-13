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

describe('paginate（行级拆分 / 孤寡行控制）', () => {
  // 页高 100、行高 10 → 每页最多 10 行；正文段落标 splittable + lineSize
  const para = (id: string, lines: number, extra: Partial<MeasurableBlock> = {}): MeasurableBlock => ({
    id,
    lineSize: 10,
    splittable: true,
    mainSize: lines * 10,
    ...extra,
  });

  it('未标 splittable 时行为与块原子版一致（整块挪页，不拆分）', () => {
    const result = paginate(
      [block('head', 20), block('para', 90)],
      { pageMainSize: 100 },
    );
    expect(result.totalPages).toBe(2);
    expect(result.pages[0]?.blocks.map((b) => b.id)).toEqual(['head']);
    expect(result.pages[1]?.blocks.map((b) => b.id)).toEqual(['para']);
  });

  it('装不下的可拆段落在行处断开跨页续排', () => {
    // head 占 20，剩 80 可放 8 行；para 共 12 行 → 首页片段 8 行 + 续页 4 行
    const result = paginate(
      [block('head', 20), para('para', 12)],
      { pageMainSize: 100 },
    );
    expect(result.totalPages).toBe(2);
    const p0 = result.pages[0];
    expect(p0?.items.some((it) => it.block.id === 'para' && it.fromLine === 0 && it.lineCount === 8)).toBe(true);
    const p1 = result.pages[1];
    expect(p1?.items.some((it) => it.block.id === 'para' && it.fromLine === 8 && it.lineCount === 4)).toBe(true);
  });

  it('孤行控制：首页片段不足 minFirst 行则整体换页，不留孤行', () => {
    // head 占 92，仅剩 8px（<1 行）→ para 换页；换页后从块首起完整落页（未拆分）
    const result = paginate(
      [block('head', 92), para('para', 3)],
      { pageMainSize: 100 },
    );
    expect(result.totalPages).toBe(2);
    const frag = result.pages[1]?.items.find((it) => it.block.id === 'para');
    expect(frag?.fromLine).toBe(0);
    expect(frag?.lineCount).toBe(0); // 未拆分（整块）
  });

  it('寡行控制：末页片段不足 minLast 行则从前片让行', () => {
    // para 共 11 行、整页可放 10 行；若取 10 则续页仅 1 行（<minLast 2）
    // → 首页让到 9 行，续页 2 行
    const result = paginate(
      [para('para', 11)],
      { pageMainSize: 100 },
    );
    expect(result.totalPages).toBe(2);
    expect(result.pages[0]?.items[0]?.lineCount).toBe(9);
    expect(result.pages[1]?.items[0]?.lineCount).toBe(2);
  });

  it('超高可拆块按每页行数连续跨页', () => {
    // 25 行、每页 10 行 → 10 + 10 + 5（末片 5 ≥ minLast）
    const result = paginate(
      [para('long', 25)],
      { pageMainSize: 100 },
    );
    expect(result.totalPages).toBe(3);
    expect(result.pages[0]?.items[0]?.lineCount).toBe(10);
    expect(result.pages[1]?.items[0]?.lineCount).toBe(10);
    expect(result.pages[2]?.items[0]?.lineCount).toBe(5);
  });

  it('keepWithNext + 可拆段：标题与段落头部同页，段落余下跨页', () => {
    // filler 占 85；heading(kwn)+para 头部 2 行需 20+20 → 85+40>100 整体换页
    // 新页：heading 20 + para 首片（剩 80→8 行，续页 2 行≥minLast）同页
    const result = paginate(
      [
        block('filler', 85),
        block('heading', 20, { keepWithNext: true }),
        para('para', 10),
      ],
      { pageMainSize: 100 },
    );
    expect(result.pages[0]?.blocks.map((b) => b.id)).toEqual(['filler']);
    const p1 = result.pages[1];
    expect(p1?.blocks.map((b) => b.id)).toEqual(['heading', 'para']);
    // para 首片与 heading 同页且 ≥ 2 行
    const head = p1?.items.find((it) => it.block.id === 'para');
    expect(head?.fromLine).toBe(0);
    expect((head?.lineCount ?? 0)).toBeGreaterThanOrEqual(2);
  });

  it('可自定义孤寡行阈值（widowControl）', () => {
    // minLast=1：para 11 行、页 10 行 → 首页取满 10、续页 1（不再让行）
    const result = paginate(
      [para('para', 11)],
      { pageMainSize: 100, widowControl: { minFirst: 1, minLast: 1 } },
    );
    expect(result.pages[0]?.items[0]?.lineCount).toBe(10);
    expect(result.pages[1]?.items[0]?.lineCount).toBe(1);
  });

  it('病态页（行高 > 整页）仍推进不死循环', () => {
    // lineSize 150 > pageMainSize 100 → 每页 1 行，3 行分 3 页
    const result = paginate(
      [{ id: 'huge', mainSize: 450, lineSize: 150, splittable: true }],
      { pageMainSize: 100 },
    );
    expect(result.totalPages).toBe(3);
    expect(result.pages.every((p) => p.items.length === 1)).toBe(true);
  });
});
