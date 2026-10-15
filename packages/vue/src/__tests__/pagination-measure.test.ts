/**
 * DOM 实测分页尺寸（pagination-measure）测试
 *
 * happy-dom 不产生真实布局盒（offsetTop / offsetHeight 恒为 0），故横排量测
 * 得到空映射（推进量非正被丢弃）；本测试覆盖「安全门」：直排 / 多栏直接回退空映射、
 * 横排不抛错且工作表可创建 / 可回收。真实像素级准确度依赖浏览器实测（手动验证）。
 */
import { describe, expect, it } from 'vitest';
import { NODE_TYPES, createEmptyDocument, type BookDocument } from '@bibliotype/core';
import { CLASSICAL_LAYOUT_OPTIONS, DEFAULT_LAYOUT_OPTIONS } from '@bibliotype/layout';
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
  it('直排回退空映射（跨栏回流不逐块实测）', () => {
    const sizes = measureBlockSizes({ doc: sampleDoc(), options: CLASSICAL_LAYOUT_OPTIONS });
    expect(sizes.size).toBe(0);
  });

  it('多栏回退空映射（分栏度量不可靠）', () => {
    const sizes = measureBlockSizes({
      doc: sampleDoc(),
      options: { ...DEFAULT_LAYOUT_OPTIONS, columns: 2 },
    });
    expect(sizes.size).toBe(0);
  });

  it('单栏横排：产出映射且工作表可创建 / 可回收', () => {
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
  it('单栏横排：返回 sizes / lineOffsets 两个映射，工作表可回收', () => {
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

  it('直排 / 多栏回退空映射（sizes 与 lineOffsets 皆空）', () => {
    const vertical = measurePagination({ doc: sampleDoc(), options: CLASSICAL_LAYOUT_OPTIONS });
    expect(vertical.sizes.size).toBe(0);
    expect(vertical.lineOffsets.size).toBe(0);

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
});
