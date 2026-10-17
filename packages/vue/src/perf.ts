/**
 * 性能埋点（P0 诊断）
 *
 * 目标：让宿主能回答「编辑卡顿到底花在哪」——分页重排还是整本落盘。
 *
 * 设计：
 * - 埋点名固定（`bt:layout` / `bt:measure` / `bt:save`），宿主用
 *   `PerformanceObserver({ entryTypes: ['measure', 'longtask'] })` 一处汇总；
 * - 记录走 `performance.measure(name, { start, end })`（不落 mark，免清理残留）；
 * - **默认关闭**（零开销路径只有一次布尔判断）：宿主显式 `setPerfProbeEnabled(true)`
 *   后才产出条目，避免生产环境把 measure 缓冲区撑满。
 */

/** 分页重排耗时（`buildPagedLayout` 一轮全流程：结构抽取 + 量尺 + 分页 + 建索引） */
export const PERF_LAYOUT = 'bt:layout';
/** 离屏量尺耗时（`measurePagination` 单独一段，便于判断 R 树/DOM 成本占比） */
export const PERF_MEASURE = 'bt:measure';
/** 自动落盘耗时（取快照 + 序列化 + 写库一轮） */
export const PERF_AUTOSAVE = 'bt:save';

/** 埋点开关（模块级单例：包内各链路共享） */
let probeEnabled = false;

/** 开启 / 关闭埋点 */
export function setPerfProbeEnabled(enabled: boolean): void {
  probeEnabled = enabled;
}

/** 当前是否开启埋点 */
export function isPerfProbeEnabled(): boolean {
  return probeEnabled;
}

/** 高精度当前时刻（无 performance 的环境回退 Date.now） */
export function perfNow(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

/**
 * 记录一段耗时（`start` 由 `perfNow()` 取得；未开启埋点时立即返回）
 *
 * @param name 埋点名（用本模块导出的常量）
 * @param start 起始时刻
 */
export function perfRecord(name: string, start: number): void {
  if (!probeEnabled) return;
  if (typeof performance === 'undefined' || typeof performance.measure !== 'function') return;
  try {
    performance.measure(name, { start, end: perfNow() });
  } catch {
    /* 部分环境不认 PerformanceMeasureOptions：静默降级（埋点不应影响主流程） */
  }
}
