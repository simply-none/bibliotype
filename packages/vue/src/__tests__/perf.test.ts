/**
 * vue 性能埋点测试（I7 兼容层）
 *
 * 覆盖：PERF_* 常量与开关语义不变；开启后埋点同步记入收集型 Profiler
 * （阶段口径与 core PERF_PHASES 一致）；关闭时零记录。
 */
import { PERF_PHASES } from '@bibliotype/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PERF_AUTOSAVE,
  PERF_LAYOUT,
  PERF_MEASURE,
  getVuePerfProfiler,
  isPerfProbeEnabled,
  perfNow,
  perfRecord,
  setPerfProbeEnabled,
} from '../perf';

afterEach(() => {
  setPerfProbeEnabled(false);
  getVuePerfProfiler().reset();
});

describe('perf 埋点兼容（I7）', () => {
  it('PERF_* 常量保持原值', () => {
    expect(PERF_LAYOUT).toBe('bt:layout');
    expect(PERF_MEASURE).toBe('bt:measure');
    expect(PERF_AUTOSAVE).toBe('bt:save');
  });

  it('开关语义不变：默认关闭，显式开启', () => {
    expect(isPerfProbeEnabled()).toBe(false);
    setPerfProbeEnabled(true);
    expect(isPerfProbeEnabled()).toBe(true);
    setPerfProbeEnabled(false);
    expect(isPerfProbeEnabled()).toBe(false);
  });

  it('关闭时零记录（收集器 spanCount 不变）', () => {
    setPerfProbeEnabled(false);
    const before = getVuePerfProfiler().spanCount;
    perfRecord(PERF_LAYOUT, perfNow());
    expect(getVuePerfProfiler().spanCount).toBe(before);
  });

  it('开启后埋点记入收集器，阶段映射到 PERF_PHASES 口径', () => {
    setPerfProbeEnabled(true);
    perfRecord(PERF_LAYOUT, perfNow());
    perfRecord(PERF_MEASURE, perfNow());
    perfRecord(PERF_AUTOSAVE, perfNow());
    const report = getVuePerfProfiler().reportJson();
    expect(report[PERF_PHASES.LAYOUT]).toBeDefined();
    expect(report[PERF_PHASES.MEASURE]).toBeDefined();
    expect(report[PERF_PHASES.AUTOSAVE]).toBeDefined();
    expect(Object.keys(report[PERF_PHASES.LAYOUT])).toEqual(['probe=bt:layout']);
  });

  it('未知埋点名按原样记录（向后兼容自定义埋点）', () => {
    setPerfProbeEnabled(true);
    perfRecord('bt:custom', perfNow());
    const report = getVuePerfProfiler().reportJson();
    expect(report['bt:custom']).toBeDefined();
  });

  it('无 performance 环境（happy-dom 无 measure 时）静默降级不抛错', () => {
    setPerfProbeEnabled(true);
    expect(() => perfRecord(PERF_LAYOUT, perfNow() - 5)).not.toThrow();
  });
});
