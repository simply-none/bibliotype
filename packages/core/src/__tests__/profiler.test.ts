/**
 * 统一性能探针测试（I7）
 *
 * 覆盖：span 嵌套与聚合数值、no-op 零行为、标签合并与序列化、
 * reportJson / reportText / reset、阶段常量与 bench 口径一致。
 */
import { describe, expect, it } from 'vitest';
import {
  NOOP_PROFILER,
  PERF_PHASES,
  createCollectingProfiler,
  createNoopProfiler,
  profilerOrNoop,
} from '../index';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('createCollectingProfiler', () => {
  it('聚合 count / total / min / max / mean（阶段 × 标签）', async () => {
    const profiler = createCollectingProfiler();
    const spanA = profiler.span(PERF_PHASES.LAYOUT, { blocks: 10 });
    await sleep(15);
    spanA.end();
    const spanB = profiler.span(PERF_PHASES.LAYOUT, { blocks: 10 });
    spanB.end();
    const report = profiler.reportJson();
    const stats = report[PERF_PHASES.LAYOUT]['blocks=10'];
    expect(stats.count).toBe(2);
    expect(stats.minMs).toBeLessThanOrEqual(stats.meanMs);
    expect(stats.meanMs).toBeLessThanOrEqual(stats.maxMs);
    expect(stats.totalMs).toBeCloseTo(stats.minMs + stats.maxMs, 1);
    expect(profiler.spanCount).toBe(2);
  });

  it('无标签归入 *；不同标签分开聚合', () => {
    const profiler = createCollectingProfiler();
    profiler.span(PERF_PHASES.EXPORT).end();
    profiler.span(PERF_PHASES.EXPORT, { step: 'zip' }).end();
    const report = profiler.reportJson();
    expect(Object.keys(report[PERF_PHASES.EXPORT]).sort()).toEqual(['*', 'step=zip']);
  });

  it('嵌套 span 各自独立计时', async () => {
    const profiler = createCollectingProfiler();
    const outer = profiler.span(PERF_PHASES.LAYOUT);
    const inner = profiler.span(PERF_PHASES.MEASURE);
    await sleep(12);
    inner.end();
    await sleep(5);
    outer.end();
    const report = profiler.reportJson();
    expect(report[PERF_PHASES.MEASURE]['*'].count).toBe(1);
    expect(report[PERF_PHASES.LAYOUT]['*'].count).toBe(1);
  });

  it('end(extraLabels) 与开始期标签合并（同名覆盖）', () => {
    const profiler = createCollectingProfiler();
    const span = profiler.span(PERF_PHASES.EXPORT, { step: 'zip', bytes: 0 });
    span.end({ bytes: 1024, sections: 3 });
    const report = profiler.reportJson();
    const labels = Object.keys(report[PERF_PHASES.EXPORT]);
    expect(labels).toEqual(['step=zip,bytes=1024,sections=3']);
  });

  it('重复 end 幂等：只记一次', () => {
    const profiler = createCollectingProfiler();
    const span = profiler.span(PERF_PHASES.EXPORT);
    span.end();
    span.end();
    expect(profiler.spanCount).toBe(1);
  });

  it('reportText：表头 + 对齐行', () => {
    const profiler = createCollectingProfiler();
    profiler.span(PERF_PHASES.EXPORT, { step: 'zip' }).end();
    const text = profiler.reportText();
    expect(text).toContain('phase');
    expect(text).toContain('export');
    expect(text).toContain('step=zip');
  });

  it('reset 清空聚合与进行中的 span 记账', () => {
    const profiler = createCollectingProfiler();
    const span = profiler.span(PERF_PHASES.AUTOSAVE);
    span.end();
    profiler.reset();
    expect(profiler.spanCount).toBe(0);
    expect(profiler.reportJson()).toEqual({});
    /* reset 后可继续使用 */
    profiler.span(PERF_PHASES.AUTOSAVE).end();
    expect(profiler.spanCount).toBe(1);
  });
});

describe('no-op 探针（零行为）', () => {
  it('NOOP_PROFILER：collecting=false，span 不聚合不出错', () => {
    expect(NOOP_PROFILER.collecting).toBe(false);
    const span = NOOP_PROFILER.span(PERF_PHASES.LAYOUT, { blocks: 1 });
    expect(() => span.end()).not.toThrow();
    expect(() => span.end()).not.toThrow();
  });

  it('createNoopProfiler 与 profilerOrNoop 回退一致', () => {
    expect(createNoopProfiler().collecting).toBe(false);
    expect(profilerOrNoop(undefined)).toBe(NOOP_PROFILER);
    const custom = createCollectingProfiler();
    expect(profilerOrNoop(custom)).toBe(custom);
  });

  it('阶段常量与 bench 口径一致', () => {
    expect(PERF_PHASES.LAYOUT).toBe('layout');
    expect(PERF_PHASES.MEASURE).toBe('measure');
    expect(PERF_PHASES.EXPORT).toBe('export');
    expect(PERF_PHASES.AUTOSAVE).toBe('autosave');
  });
});
