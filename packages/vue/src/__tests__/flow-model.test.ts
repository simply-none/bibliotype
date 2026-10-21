/**
 * 流式视图模型（flow-model）纯函数单测（D5）。
 */
import { describe, expect, it } from 'vitest';
import type { FlowChunk } from '@bibliotype/reader';
import {
  adjustScrollOffset,
  estimateFlowChunkHeight,
  resolveAnchorChunkIndex,
  resolveMountWindow,
  sumHeights,
} from '../flow-model.js';

/** 构造一个最小分块 */
function chunk(partial: Partial<FlowChunk> & { charCount: number }): FlowChunk {
  return {
    key: partial.key ?? 'k',
    containerId: partial.containerId ?? 'c',
    level: partial.level ?? 1,
    nodes: partial.nodes ?? [],
    nodeIds: partial.nodeIds ?? [],
    startIndex: partial.startIndex ?? 0,
    charCount: partial.charCount,
  };
}

describe('estimateFlowChunkHeight', () => {
  it('按字数 / 每行字数 × 行高 + 段间距估算（横排 640×16）', () => {
    // 每行 40 字 → 400 字 10 行；2 段 × 14.4 段距
    const h = estimateFlowChunkHeight(chunk({ nodeIds: ['a', 'b'], charCount: 400 }), {
      width: 640,
      fontSize: 16,
      lineHeight: 1.8,
      paragraphSpacing: 14.4,
    });
    expect(h).toBeCloseTo(10 * 16 * 1.8 + 2 * 14.4, 5);
  });

  it('空分块返回 0', () => {
    expect(
      estimateFlowChunkHeight(chunk({ nodes: [], nodeIds: [], charCount: 0 }), {
        width: 640,
        fontSize: 16,
        lineHeight: 1.8,
      }),
    ).toBe(0);
  });

  it('非法度量回落到缺省，不产出 NaN', () => {
    const h = estimateFlowChunkHeight(chunk({ nodeIds: ['x', 'y'], charCount: 200 }), {
      width: Number.NaN,
      fontSize: 0,
      lineHeight: -1,
    });
    expect(Number.isFinite(h)).toBe(true);
    expect(h).toBeGreaterThan(0);
  });
});

describe('resolveMountWindow', () => {
  const offsets = [0, 100, 200, 300];
  const heights = [100, 100, 100, 100];

  it('返回视口内的闭区间（含预挂载余量）', () => {
    const win = resolveMountWindow({ offsets, heights, scrollTop: 150, viewportHeight: 100, overscan: 0 });
    expect(win).toEqual({ start: 1, end: 2 });
  });

  it('overscan 扩展挂载范围', () => {
    const win = resolveMountWindow({ offsets, heights, scrollTop: 150, viewportHeight: 100, overscan: 200 });
    expect(win).toEqual({ start: 0, end: 3 });
  });

  it('视口为 0 时仍能定位首个相交块', () => {
    const win = resolveMountWindow({ offsets, heights, scrollTop: 250, viewportHeight: 0, overscan: 0 });
    // 视口退化为点（top=bottom=250）：仅命中第 2 块（offset 200、未越过 250）
    expect(win).toEqual({ start: 2, end: 2 });
  });

  it('空列表返回空区间', () => {
    expect(resolveMountWindow({ offsets: [], heights: [], scrollTop: 0, viewportHeight: 100 })).toEqual({
      start: 0,
      end: -1,
    });
  });
});

describe('resolveAnchorChunkIndex', () => {
  const chunks: FlowChunk[] = [
    chunk({ key: 'a', containerId: 'ch1', nodeIds: ['p1', 'p2'], charCount: 100 }),
    chunk({ key: 'b', containerId: 'ch2', nodeIds: ['p3'], charCount: 50 }),
  ];

  it('章容器 id 命中其首块所在分块', () => {
    expect(resolveAnchorChunkIndex(chunks, 'ch1')).toBe(0);
  });
  it('块 id 精确命中', () => {
    expect(resolveAnchorChunkIndex(chunks, 'p3')).toBe(1);
  });
  it('未命中返回 -1', () => {
    expect(resolveAnchorChunkIndex(chunks, 'missing')).toBe(-1);
  });
});

describe('adjustScrollOffset', () => {
  it('锚点上方高度变化量补偿滚动位置', () => {
    // 第 0 块实测变高 100，第 1 块不变 → 上方累计 +100，scrollTop 应 +100
    const next = adjustScrollOffset({
      previousHeights: [100, 100],
      heights: [200, 100],
      anchorIndex: 2,
      scrollTop: 300,
    });
    expect(next).toBe(400);
  });

  it('上方变矮则回退 scrollTop', () => {
    const next = adjustScrollOffset({
      previousHeights: [200, 100],
      heights: [100, 100],
      anchorIndex: 1,
      scrollTop: 300,
    });
    expect(next).toBe(200);
  });
});

describe('sumHeights', () => {
  it('累加 [0, index) 的高度', () => {
    expect(sumHeights([10, 20, 30], 2)).toBe(30);
    expect(sumHeights([10, 20, 30], 0)).toBe(0);
  });
});
