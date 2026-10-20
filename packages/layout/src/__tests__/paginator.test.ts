/**
 * 分页器测试
 */
import { describe, expect, it } from 'vitest';
import {
  blockAxisOf,
  paginate,
  type BlockAxis,
  type MeasurableBlock,
  type PaginationResult,
} from '../paginator.js';

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

  it('亚像素容差：推进量小数累加不挤掉实渲放得下的尾行 / 尾块', () => {
    // 行高 30.4×10 = 304 推进量（无块间距），页高 304：浮点上 304/30.4 = 9.999…
    // → 严格 floor 只得 9 行，会把尾行拆到续页（实渲恰好 10 行放得下）
    const result = paginate(
      [
        { id: 'p1', mainSize: 304, lineSize: 30.4, lineCount: 10, splittable: true },
        { id: 'p2', mainSize: 304, lineSize: 30.4, lineCount: 10, splittable: true },
      ],
      { pageMainSize: 304 },
    );
    expect(result.totalPages).toBe(2);
    // 两段各自整块落页（未拆分），而非因小数差拆出续排片段
    expect(result.pages[0]?.items.length).toBe(1);
    expect(result.pages[1]?.items.length).toBe(1);
    expect(result.pages[0]?.items[0]?.lineCount).toBe(0);
    expect(result.pages[1]?.items[0]?.lineCount).toBe(0);

    // 尾块差 0.4px 装得下：60 + 30 + 179.6 = 269.6 ≤ 270 → 不换页
    const tail = paginate(
      [
        block('a', 60),
        block('b', 30),
        block('c', 179.6),
      ],
      { pageMainSize: 270 },
    );
    expect(tail.totalPages).toBe(1);
  });
});

describe('paginate（按块体高判页：页底不虚耗块间间距）', () => {
  it('原子块追加代价取体高，推进量中的间距不重复扣', () => {
    // 页高 100：a 推进量 50（体高 30 + 与下一块的折叠间距 20）；
    // b 推进量 60（体高 40 + 尾部间距 20）
    // 旧口径：50 + 60 > 100 → b 换页（页底仅占 50，虚耗 50）
    // 新口径：50 + 40 ≤ 100 → 同页（页视觉占用 = 110 − b 尾部间距 20 = 90）
    const result = paginate(
      [block('a', 50, { bodyMainSize: 30 }), block('b', 60, { bodyMainSize: 40 })],
      { pageMainSize: 100 },
    );
    expect(result.totalPages).toBe(1);
    expect(result.pages[0]?.items.map((i) => i.block.id)).toEqual(['a', 'b']);
  });

  it('不给 bodyMainSize 时行为与旧口径完全一致（向后兼容）', () => {
    const result = paginate([block('a', 50), block('b', 60)], { pageMainSize: 100 });
    expect(result.totalPages).toBe(2);
  });

  it('逐页多放一块：标题 UA 外边距不再逐块重复计入', () => {
    // 页高 100：每块推进量 15（体高 10 + 间距 5）
    // 旧口径每页 floor(100/15)=6 块；新口径第 k 块占用 15(k−1)+10 ≤ 100 → 7 块
    const blocks = Array.from({ length: 14 }, (_, i) =>
      block(`b${i}`, 15, { bodyMainSize: 10 }),
    );
    const result = paginate(blocks, { pageMainSize: 100 });
    expect(result.totalPages).toBe(2);
    expect(result.pages[0]?.items.length).toBe(7);
    expect(result.pages[1]?.items.length).toBe(7);
  });

  it('keepWithNext 预留按推进量计（本块必有同页后继，尾部间距会渲染）', () => {
    // 页高 100：a 推进量 30（体高 20）；标题推进量 50（体高 30 + 段间距 20）；
    // para 2 行×20 = 40（无尾部间距）
    // 标题若与 a 同页：需 30 + 50(含间距) + 40(整段) = 120 > 100 → 标题整体换页，
    // 再携 para 同页（若误按体高预留，标题会孤悬上一页页尾）
    const result = paginate(
      [
        block('a', 30, { bodyMainSize: 20 }),
        block('heading', 50, { bodyMainSize: 30, keepWithNext: true }),
        block('para', 40, { lineSize: 20, lineCount: 2, splittable: true, bodyMainSize: 40 }),
      ],
      { pageMainSize: 100 },
    );
    expect(result.totalPages).toBe(2);
    expect(result.pages[0]?.items.map((i) => i.block.id)).toEqual(['a']);
    expect(result.pages[1]?.items.map((i) => i.block.id)).toEqual(['heading', 'para']);
  });

  it('非法 bodyMainSize（非正 / 大于推进量）回退推进量口径', () => {
    const zero = paginate([block('a', 50), block('b', 60, { bodyMainSize: 0 })], {
      pageMainSize: 100,
    });
    const oversized = paginate([block('a', 50), block('b', 60, { bodyMainSize: 70 })], {
      pageMainSize: 100,
    });
    // 两者均按 mainSize 判页 → 50 + 60 > 100 换页
    expect(zero.totalPages).toBe(2);
    expect(oversized.totalPages).toBe(2);
  });

  it('体高口径与增量续排（resume）共存：前缀页复用不多出一页', () => {
    // 页高 90：a 推进量 30（体高 20）/ b 40（体高 30）/ c 40（体高 30）
    // → 全量结果 [[a,b],[c]]；以第一页为前缀、从 c 续排应得到同一结果
    const blocks = [
      block('a', 30, { bodyMainSize: 20 }),
      block('b', 40, { bodyMainSize: 30 }),
      block('c', 40, { bodyMainSize: 30 }),
    ];
    const shape = (pages: { items: { block: MeasurableBlock }[] }[]): string[][] =>
      pages.map((page) => page.items.map((item) => item.block.id));
    const full = paginate(blocks, { pageMainSize: 90 });
    expect(shape(full.pages)).toEqual([['a', 'b'], ['c']]);
    const resumed = paginate(blocks, {
      pageMainSize: 90,
      resume: { prefix: full.pages.slice(0, 1), startIndex: 2 },
    });
    expect(shape(resumed.pages)).toEqual([['a', 'b'], ['c']]);
  });
});

describe('paginate（页底溢出 bottomSlack：末行可伸入下边距）', () => {
  it('可拆段落的尾行吃进溢出：版心放不下的那一行在 slack 内放得下', () => {
    // 页高 100：段 4 行 × 30 = 120 → 无 slack 时容量只容 3 行，但取 3 行会剩 1 行
    // 寡行（< minLast），孤寡行控制调整为 2 + 2；
    // 加 20px 溢出后容量 120 恰好整段同页（拆分不再触发）
    const para = { id: 'p', mainSize: 120, lineSize: 30, lineCount: 4, splittable: true };
    const without = paginate([para], { pageMainSize: 100 });
    const withSlack = paginate([para], { pageMainSize: 100, bottomSlack: 20 });
    expect(without.totalPages).toBe(2);
    expect(without.pages[0]?.items[0]?.lineCount).toBe(2);
    expect(without.pages[1]?.items[0]?.lineCount).toBe(2);
    expect(withSlack.totalPages).toBe(1);
    expect(withSlack.pages[0]?.items[0]?.lineCount).toBe(0); // 未拆分
  });

  it('不可拆块同样受益：体高超出版心剩余但在容量内时不换页', () => {
    const blocks = [block('a', 60, { bodyMainSize: 50 }), block('b', 70, { bodyMainSize: 65 })];
    // a 按推进量 60 入账；b 追加代价 = 体高 65
    expect(paginate(blocks, { pageMainSize: 100 }).totalPages).toBe(2);
    // 60 + 65 = 125 ≤ 100 + 30 + 容差 → 同页
    expect(paginate(blocks, { pageMainSize: 100, bottomSlack: 30 }).totalPages).toBe(1);
  });

  it('不破坏孤寡行约束：溢出后仍不得留下 < minLast 的尾片段', () => {
    // 页 100 + slack 30 = 130 → 容 4 行；段 6 行 × 30：取 4 行后恰好续 2 行（= minLast）
    const result = paginate(
      [{ id: 'p', mainSize: 180, lineSize: 30, lineCount: 6, splittable: true }],
      { pageMainSize: 100, bottomSlack: 30 },
    );
    expect(result.totalPages).toBe(2);
    expect(result.pages[0]?.items[0]?.lineCount).toBe(4);
    expect(result.pages[1]?.items[0]?.lineCount).toBe(2);
  });

  it('溢出只放宽判页容量，不改入账尺寸（usedMainSize 仍为真实推进量）', () => {
    const result = paginate(
      [{ id: 'p', mainSize: 120, lineSize: 30, lineCount: 4, splittable: true }],
      { pageMainSize: 100, bottomSlack: 20 },
    );
    // 整段未拆 → 按推进量 120 入账（大于版心高 100，但不影响后续块判定）
    expect(result.pages[0]?.items[0]?.lineCount).toBe(0);
    expect(result.pages[0]?.usedMainSize).toBe(120);
  });

  it('非正 / 非法 slack 等价于关闭（向后兼容）', () => {
    const blocks = [
      { id: 'p', mainSize: 120, lineSize: 30, lineCount: 4, splittable: true },
    ];
    expect(paginate(blocks, { pageMainSize: 100, bottomSlack: 0 }).totalPages).toBe(2);
    expect(paginate(blocks, { pageMainSize: 100, bottomSlack: -50 }).totalPages).toBe(2);
  });

  it('slack 与增量续排（resume）共存：前缀页复用口径一致', () => {
    const blocks = [
      { id: 'a', mainSize: 120, lineSize: 30, lineCount: 4, splittable: true },
      block('b', 60, { bodyMainSize: 50 }),
      block('c', 60, { bodyMainSize: 50 }),
    ];
    const shape = (pages: { items: { block: MeasurableBlock }[] }[]): string[][] =>
      pages.map((page) => page.items.map((item) => item.block.id));
    const full = paginate(blocks, { pageMainSize: 100, bottomSlack: 20 });
    const resumed = paginate(blocks, {
      pageMainSize: 100,
      bottomSlack: 20,
      resume: { prefix: full.pages.slice(0, 1), startIndex: 1 },
    });
    expect(shape(resumed.pages)).toEqual(shape(full.pages));
  });
});

describe('主轴契约（row / column）', () => {
  it('blockAxisOf 缺省按横排，显式 column 透传', () => {
    expect(blockAxisOf({ id: 'a', mainSize: 10 })).toBe('row');
    expect(blockAxisOf({ id: 'b', mainSize: 10, axis: 'column' })).toBe('column');
  });

  it('分页算术与主轴无关：同一组块 row / column 结果一致', () => {
    const build = (axis: BlockAxis): MeasurableBlock[] => [
      { id: 'p1', mainSize: 100, splittable: true, lineSize: 20, axis },
      { id: 'p2', mainSize: 40, axis },
    ];
    const shape = (result: PaginationResult): string[][] =>
      result.pages.map((page) =>
        page.items.map((item) => `${item.block.id}:${item.fromLine}/${item.lineCount}`),
      );
    const row = paginate(build('row'), { pageMainSize: 70 });
    const column = paginate(build('column'), { pageMainSize: 70 });
    expect(shape(column)).toEqual(shape(row));
    // 直排块保留 axis 标注，供切片 / 渲染按同一主轴解释 lineSize（列宽）
    expect(column.pages[0]?.items[0]?.block.axis).toBe('column');
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
