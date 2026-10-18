/**
 * DOM 实测分页尺寸（pagination-measure）测试
 *
 * happy-dom 不产生真实布局盒（offsetTop / offsetHeight / offsetWidth 恒为 0），故横排 /
 * 直排量测均得到空映射（推进量非正被丢弃）；本测试覆盖「安全门」：多栏直接回退空映射、
 * 横排 / 直排单栏不抛错且工作表可创建 / 可回收。真实像素级准确度依赖浏览器实测（手动验证）。
 */
import { describe, expect, it } from 'vitest';
import { NODE_TYPES, createEmptyDocument, type BookDocument, type BookNode } from '@bibliotype/core';
import { CLASSICAL_LAYOUT_OPTIONS, DEFAULT_LAYOUT_OPTIONS } from '@bibliotype/layout';
import { extractBlocksIndexed } from '@bibliotype/reader';
import { measureBlockSizes, measurePagination, disposeMeasureSheet } from '../pagination-measure.js';

function sampleDoc(): BookDocument {
  const doc = createEmptyDocument({ title: '论语' });
  doc.root.children = [
    {
      type: NODE_TYPES.CHAPTER,
      id: 'chap-1',
      children: [
        { type: NODE_TYPES.PARAGRAPH, id: 'p-1', children: [{ type: 'text', text: '子曰学而时习之' }] },
        { type: NODE_TYPES.PARAGRAPH, id: 'p-2', children: [{ type: 'text', text: '有朋自远方来' }] },
      ],
    },
  ];
  return doc;
}

describe('measureBlockSizes', () => {
  it('直排单栏：参与 DOM 实测（happy-dom 无布局 → 空映射），工作表可创建 / 回收', () => {
    const sizes = measureBlockSizes({ doc: sampleDoc(), options: CLASSICAL_LAYOUT_OPTIONS });
    // 直排不再被安全门拦截：有布局盒时实测列推进尺寸；happy-dom 下仍为空映射（不抛错）
    expect(sizes).toBeInstanceOf(Map);
    expect(sizes.size).toBe(0);
    disposeMeasureSheet();
  });

  it('多栏回退空映射（分栏度量不可靠）', () => {
    const sizes = measureBlockSizes({
      doc: sampleDoc(),
      options: { ...DEFAULT_LAYOUT_OPTIONS, columns: 2 },
    });
    expect(sizes.size).toBe(0);
  });

  it('单栏（横排 / 直排）：产出映射且工作表可创建 / 可回收', () => {
    const sizes = measureBlockSizes({ doc: sampleDoc(), options: DEFAULT_LAYOUT_OPTIONS });
    // 返回值恒为 Map（happy-dom 无布局 → 空；真实浏览器 → 含逐块实测尺寸）
    expect(sizes).toBeInstanceOf(Map);
    expect(document.getElementById('bt-measure-sheet')).not.toBeNull();
    expect(document.getElementById('bt-measure-css')).not.toBeNull();

    disposeMeasureSheet();
    expect(document.getElementById('bt-measure-sheet')).toBeNull();
    expect(document.getElementById('bt-measure-css')).toBeNull();
  });

  it('实测值为正的块才会进入映射（非正丢弃）', () => {
    // 无 DOM 布局时全部推进量为 0 → 空映射，不含任何 p-* 键
    const sizes = measureBlockSizes({ doc: sampleDoc(), options: DEFAULT_LAYOUT_OPTIONS });
    expect(sizes.has('p-1')).toBe(false);
    disposeMeasureSheet();
  });
});

describe('measurePagination', () => {
  it('单栏（横排 / 直排）：返回 sizes / lineOffsets 两个映射，工作表可回收', () => {
    const result = measurePagination({ doc: sampleDoc(), options: DEFAULT_LAYOUT_OPTIONS });
    expect(result.sizes).toBeInstanceOf(Map);
    expect(result.lineOffsets).toBeInstanceOf(Map);
    expect(document.getElementById('bt-measure-sheet')).not.toBeNull();
    disposeMeasureSheet();
    expect(document.getElementById('bt-measure-sheet')).toBeNull();
  });

  it('happy-dom 无真实行盒：不产出多行 lineOffsets（仅真实浏览器逐行实测）', () => {
    const { lineOffsets } = measurePagination({ doc: sampleDoc(), options: DEFAULT_LAYOUT_OPTIONS });
    // getClientRects 在 happy-dom 下为空 → measureLineOffsets 返回 [0]（单行）→ 不入 map
    expect(lineOffsets.size).toBe(0);
    disposeMeasureSheet();
  });

  it('直排单栏：走 DOM 实测路径（happy-dom 无布局 → sizes 与 lineOffsets 皆空）', () => {
    const vertical = measurePagination({ doc: sampleDoc(), options: CLASSICAL_LAYOUT_OPTIONS });
    expect(vertical.sizes).toBeInstanceOf(Map);
    expect(vertical.sizes.size).toBe(0);
    expect(vertical.lineOffsets.size).toBe(0);
    disposeMeasureSheet();

    const multiColumn = measurePagination({
      doc: sampleDoc(),
      options: { ...DEFAULT_LAYOUT_OPTIONS, columns: 2 },
    });
    expect(multiColumn.sizes.size).toBe(0);
    expect(multiColumn.lineOffsets.size).toBe(0);
  });

  it('sizes 与 measureBlockSizes 同源（委托一致）', () => {
    const pagination = measurePagination({ doc: sampleDoc(), options: DEFAULT_LAYOUT_OPTIONS });
    const legacy = measureBlockSizes({ doc: sampleDoc(), options: DEFAULT_LAYOUT_OPTIONS });
    expect(pagination.sizes.size).toBe(legacy.size);
    disposeMeasureSheet();
  });

  it('targetBlockId 定点模式：不抛错且回退空映射（happy-dom 无布局），工作表可回收', () => {
    const result = measurePagination({
      doc: sampleDoc(),
      options: DEFAULT_LAYOUT_OPTIONS,
      targetBlockId: 'p-1',
    });
    expect(result.sizes).toBeInstanceOf(Map);
    expect(result.lineOffsets.size).toBe(0);
    expect(result.lineSizes.size).toBe(0);
    disposeMeasureSheet();
    expect(document.getElementById('bt-measure-sheet')).toBeNull();
  });

  it('targetBlockId 未命中：安全回退全量（不抛错）', () => {
    const result = measurePagination({
      doc: sampleDoc(),
      options: DEFAULT_LAYOUT_OPTIONS,
      targetBlockId: 'missing',
    });
    expect(result.sizes).toBeInstanceOf(Map);
    disposeMeasureSheet();
  });

  it('传入 extracted 复用预抽块结果：结果同源且块仍渲染进工作表', () => {
    const doc = sampleDoc();
    // 块序列与块 id 只由 IR 结构决定，故同一 doc 的结构抽取可跨轮复用
    const extracted = extractBlocksIndexed(doc, {});
    const shared = measurePagination({ doc, options: DEFAULT_LAYOUT_OPTIONS, extracted });
    const fresh = measurePagination({ doc, options: DEFAULT_LAYOUT_OPTIONS });

    expect(shared.sizes).toEqual(fresh.sizes);
    expect(shared.lineOffsets).toEqual(fresh.lineOffsets);
    expect(shared.lineSizes).toEqual(fresh.lineSizes);
    // 复用路径同样把块渲染进量尺工作表（否则实测会空转）
    const sheet = document.getElementById('bt-measure-sheet');
    expect(sheet?.querySelectorAll('.bt-measure-block').length).toBe(2);
    disposeMeasureSheet();
  });
});

describe('measurePagination 分批实测', () => {
  it('大量块分批排入量表，不会一次性渲染整本（避免直排巨表布局卡死、后段块测不出）', () => {
    const doc = createEmptyDocument({ title: '大文档' });
    const children: BookNode[] = [];
    for (let i = 0; i < 120; i += 1) {
      children.push({
        type: NODE_TYPES.PARAGRAPH,
        id: `p-${i}`,
        children: [{ type: 'text', text: '子曰学而时习之' }],
      });
    }
    doc.root.children = children;

    measurePagination({ doc, options: DEFAULT_LAYOUT_OPTIONS });

    const rendered =
      document.getElementById('bt-measure-sheet')?.querySelectorAll('.bt-measure-block').length ?? 0;
    // 旧实现会把 120 块一次性排进同一张量表；分批后仅保留最后一批（≤ 批大小 + 前瞻）
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThanOrEqual(32);
    disposeMeasureSheet();
  });
});
