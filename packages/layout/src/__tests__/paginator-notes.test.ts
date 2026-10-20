/**
 * 页底浮注（B5）：注区动态收缩正文、注区满则续注、未开启时行为不变。
 */
import { describe, expect, it } from 'vitest';
import { paginate, type MeasurableBlock } from '../paginator.js';

function body(id: string, size: number): MeasurableBlock {
  return { id, mainSize: size };
}

function note(id: string, size: number): MeasurableBlock {
  return { id, mainSize: size, floatToBottom: true };
}

function ids(items: readonly { block: MeasurableBlock }[]): string[] {
  return items.map((item) => item.block.id);
}

describe('paginate 页底注区', () => {
  it('注文落在本页注区，正文容量随之扣减并提前换页', () => {
    const result = paginate(
      [body('p1', 200), note('fn1', 60), body('p2', 250), body('p3', 250)],
      { pageMainSize: 600, noteArea: { maxRatio: 0.4 } },
    );

    expect(result.pages).toHaveLength(2);
    const first = result.pages[0]!;
    expect(ids(first.items)).toEqual(['p1', 'p2']);
    expect(ids(first.notes ?? [])).toEqual(['fn1']);
    expect(first.noteMainSize).toBe(60);
    /* 正文入账不含注文，且不超「容量 − 注区」= 540 */
    expect(first.usedMainSize).toBe(450);
    expect(first.usedMainSize).toBeLessThanOrEqual(540);
    expect(ids(result.pages[1]!.items)).toEqual(['p3']);
  });

  it('注区超过页面上限时整条续到下一页页底', () => {
    const result = paginate([note('fn1', 100), note('fn2', 100)], {
      pageMainSize: 600,
      noteArea: { maxRatio: 0.2 },
    });

    expect(result.pages).toHaveLength(2);
    expect(ids(result.pages[0]!.notes ?? [])).toEqual(['fn1']);
    expect(ids(result.pages[1]!.notes ?? [])).toEqual(['fn2']);
    expect(result.pages[1]!.noteMainSize).toBe(100);
  });

  it('单条注超过上限也不死循环（独占一页）', () => {
    const result = paginate([note('fn-big', 300), body('p1', 100)], {
      pageMainSize: 600,
      noteArea: { maxRatio: 0.1 },
    });
    expect(result.pages[0]!.notes?.[0]?.block.id).toBe('fn-big');
    expect(result.pages[0]!.noteMainSize).toBe(300);
    expect(ids(result.pages[0]!.items)).toEqual(['p1']);
  });

  it('未开启 noteArea 时注块按普通块排，页对象不出现 notes 字段', () => {
    const result = paginate([body('p1', 200), note('fn1', 60), body('p2', 250)], {
      pageMainSize: 600,
    });

    expect(result.pages[0]!.notes).toBeUndefined();
    expect(result.pages[0]!.noteMainSize).toBeUndefined();
    expect(ids(result.pages[0]!.items)).toEqual(['p1', 'fn1', 'p2']);
  });

  it('注区上限可按 maxRatio 调整：0.1 时第二条注更早续页', () => {
    const tight = paginate([note('fn1', 50), note('fn2', 50)], {
      pageMainSize: 600,
      noteArea: { maxRatio: 0.2 },
    });
    expect(tight.pages).toHaveLength(1);

    const tiny = paginate([note('fn1', 50), note('fn2', 50)], {
      pageMainSize: 600,
      noteArea: { maxRatio: 0.05 },
    });
    /* 上限 30：单条 50 自身超限 → 各自独占一页 */
    expect(tiny.pages).toHaveLength(2);
  });
});
