/**
 * bench 对比纯函数测试（I5）
 *
 * 覆盖：中位数、compareEntry 劣化超阈失败 / 容忍带内通过 / 性能提升通过 /
 * 非法输入负例、Markdown 报表汇总行。基准脚本本体在 bench/run.mjs（LF 约定见
 * .gitattributes），此处只测确定性判定逻辑。
 */
import { beforeAll, describe, expect, it } from 'vitest';

interface BenchLib {
  REGRESSION_THRESHOLD: number;
  median(samples: number[]): number;
  compareEntry(
    baselineMs: number,
    currentMs: number,
    threshold?: number,
  ): { ratio: number; deltaMs: number; pass: boolean; verdict: string };
  buildMarkdownReport(
    rows: Array<{ metric: string; baselineMs: number; currentMs: number; deltaMs: number; ratio: number; pass: boolean; verdict: string }>,
    meta?: Record<string, unknown>,
  ): string;
}

let lib: BenchLib;

beforeAll(async () => {
  lib = (await import(new URL('../../../../bench/lib.mjs', import.meta.url).href)) as BenchLib;
});

describe('median', () => {
  it('奇数取中值、偶数取均值、空为 NaN', () => {
    expect(lib.median([3, 1, 2])).toBe(2);
    expect(lib.median([4, 1, 3, 2])).toBe(2.5);
    expect(Number.isNaN(lib.median([]))).toBe(true);
  });
});

describe('compareEntry（容忍带 15%）', () => {
  it('劣化超过容忍带：失败并指出劣化幅度', () => {
    const result = lib.compareEntry(10, 12);
    expect(result.pass).toBe(false);
    expect(result.ratio).toBeCloseTo(0.2, 5);
    expect(result.verdict).toContain('20.0%');
  });

  it('劣化在容忍带内：通过', () => {
    const result = lib.compareEntry(10, 11);
    expect(result.pass).toBe(true);
  });

  it('性能提升：通过（优化不因基线未更新误报）', () => {
    const result = lib.compareEntry(10, 5);
    expect(result.pass).toBe(true);
    expect(result.ratio).toBeLessThan(0);
  });

  it('负例：非正数耗时抛 TypeError', () => {
    expect(() => lib.compareEntry(0, 5)).toThrow(TypeError);
    expect(() => lib.compareEntry(10, 0)).toThrow(TypeError);
    expect(() => lib.compareEntry(Number.NaN, 5)).toThrow(TypeError);
  });
});

describe('buildMarkdownReport', () => {
  it('全通过含 ✅ 汇总；含失败项时列出指标名', () => {
    const base = { baselineMs: 10, currentMs: 10, deltaMs: 0, ratio: 0 };
    const passRow = { metric: 'a', ...base, pass: true, verdict: '容忍带内' };
    const failRow = { metric: 'b', baselineMs: 10, currentMs: 15, deltaMs: 5, ratio: 0.5, pass: false, verdict: '劣化 50.0%' };
    const okReport = lib.buildMarkdownReport([passRow]);
    expect(okReport).toContain('✅ 全部基准项在容忍带内');
    const failReport = lib.buildMarkdownReport([passRow, failRow]);
    expect(failReport).toContain('❌ 1 项劣化超阈：b。');
    expect(failReport).toContain('| b | 10.00 | 15.00 | 5.00 | +50.0% |');
  });
});
