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

  it('keepWithNext 角点：后段剩余行数不满足孤寡约束会整体换页时，标题随行不孤悬', () => {
    // 页高 100：filler 60 + 标题 20 后仅容 2 行；para 3 行 → 2 行落入本页会
    // 触发「末页片段 < minLast → 少取 → 首片段 < minFirst」而整体换页，
    // 标题若按「标题 + minFirst 行头部」验证容量将被孤悬页尾
    const result = paginate(
      [
        block('filler', 60),
        block('heading', 20, { keepWithNext: true }),
        { id: 'para', mainSize: 30, splittable: true, lineSize: 10 },
      ],
      { pageMainSize: 100 },
    );
    expect(result.pages[0]?.blocks.map((b) => b.id)).toEqual(['filler']);
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

  it('显式 lineCount：推进量含块尾间距时不折幽灵行，尾片段一次性结算余量', () => {
    // 页高 100；段推进量 96 = 8 行×10 + 块尾折叠外边距 16
    const result = paginate(
      [
        { id: 'head', mainSize: 25 },
        { id: 'para', mainSize: 96, lineSize: 10, lineCount: 8, splittable: true },
        { id: 'tail', mainSize: 20 },
      ],
      { pageMainSize: 100 },
    );
    // 第 1 页：head 25 → 余 75 → availLines=7，leftover=1<minLast → 只放 6 行（无 lineCount 会折出 10 行幽灵行）
    expect(result.pages[0]?.items.map((i) => [i.block.id, i.fromLine, i.lineCount, i.mainSize])).toEqual([
      ['head', 0, 0, 25],
      ['para', 0, 6, 60],
    ]);
    // 第 2 页：para 尾片段 2 行 + 块尾间距 16 一并结算 = 36
    expect(result.pages[1]?.items.map((i) => [i.block.id, i.fromLine, i.lineCount, i.mainSize])).toEqual([
      ['para', 6, 2, 36],
      ['tail', 0, 0, 20],
    ]);
  });

  it('lineCount 消除整块尾部的幽灵行页数', () => {
    // 推进量 116 = 10 行×10 + 间距 16；无 lineCount 时 round(116/10)=12 → 多占一页
    const result = paginate(
      [
        { id: 'para', mainSize: 116, lineSize: 10, lineCount: 10, splittable: true },
        { id: 'next', mainSize: 20 },
      ],
      { pageMainSize: 100 },
    );
    // para 整块未拆（lineCount=10 恰好放下）→ n=0；next 第 2 页
    expect(result.totalPages).toBe(2);
    expect(result.pages[0]?.items[0]?.lineCount).toBe(0);
    expect(result.pages[1]?.items[0]?.block.id).toBe('next');
  });
});

describe('paginate（增量续排 resume）', () => {
  /** 造一组固定尺寸的块 */
  function blocksOf(...ids: string[]): { id: string; mainSize: number }[] {
    return ids.map((id) => ({ id, mainSize: 40 }));
  }

  it('前缀页原样复用，续排结果与整本重排一致', () => {
    const blocks = blocksOf('a', 'b', 'c', 'd', 'e', 'f');
    const full = paginate(blocks, { pageMainSize: 100 });
    // 每页 2 块（40+40 ≤ 100，第 3 块 120 > 100）→ 3 页
    expect(full.totalPages).toBe(3);

    // 从第 5 块（e，索引 4）续排：前缀为前 2 页
    const resumed = paginate(blocks, {
      pageMainSize: 100,
      resume: { prefix: full.pages.slice(0, 2), startIndex: 4 },
    });
    expect(resumed.totalPages).toBe(3);
    expect(resumed.pages[0]).toEqual(full.pages[0]);
    expect(resumed.pages[1]).toEqual(full.pages[1]);
    expect(resumed.pages[2]?.items.map((item) => item.block.id)).toEqual(['e', 'f']);
  });

  it('续排起点块的尺寸变化只影响后续页', () => {
    const blocks = blocksOf('a', 'b', 'c', 'd', 'e', 'f');
    const full = paginate(blocks, { pageMainSize: 100 });
    // 目标块 d 变高：从 d 所在页（第 2 页）首块起重排
    const changed = blocks.map((block) => (block.id === 'd' ? { ...block, mainSize: 80 } : block));
    const resumed = paginate(changed, {
      pageMainSize: 100,
      resume: { prefix: full.pages.slice(0, 1), startIndex: 2 },
    });
    // 第 1 页不受影响
    expect(resumed.pages[0]).toEqual(full.pages[0]);
    // d(80) 独占一页，c 被挤到单独一页，其后 e/f 一页
    expect(resumed.pages[1]?.items.map((item) => item.block.id)).toEqual(['c']);
    expect(resumed.totalPages).toBe(4);
  });

  it('startIndex 越界时退化为仅返回前缀页', () => {
    const blocks = blocksOf('a', 'b');
    const full = paginate(blocks, { pageMainSize: 100 });
    const resumed = paginate(blocks, {
      pageMainSize: 100,
      resume: { prefix: full.pages, startIndex: blocks.length },
    });
    expect(resumed.totalPages).toBe(1);
    expect(resumed.pages[0]).toEqual(full.pages[0]);
  });
});
