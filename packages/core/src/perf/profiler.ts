/**
 * 可插拔性能探针（I7 可观测性）
 *
 * 目标：把 P0 的 `PERF_*` 全局开关升级为可注入、可聚合、可出报表的 Profiler：
 * - 端口只有 `span(phase, labels?)` 一个入口，返回句柄 `end()`；
 * - 缺省 no-op 实现（关闭时零行为、零聚合），显式开启才产生记录；
 * - 内置收集器按「阶段 × 标签」聚合 count / total / min / max / mean，
 *   阶段常量与 bench（I5）共用 `PERF_PHASES`，保证口径一致；
 * - `reportJson()` / `reportText()` 输出结构化报表（JSON 可 dump 到文件）。
 *
 * 约束：探针不得影响主流程——收集器内不抛错，时间源与 vue 侧 `perfNow`
 * 同口径（performance.now，缺失回退 Date.now）。
 */

/** 标准阶段（与 bench 基线、vue `PERF_*` 埋点语义对应） */
export const PERF_PHASES = {
  /** 分页重排（装箱一轮全流程） */
  LAYOUT: 'layout',
  /** 离屏量尺（浏览器环境；node 基准以合成输入覆盖） */
  MEASURE: 'measure',
  /** 导出（EPUB / 站点 / PDF 打印管线） */
  EXPORT: 'export',
  /** 自动落盘（快照 + 序列化 + 写库） */
  AUTOSAVE: 'autosave',
} as const;

/** 标准阶段联合 */
export type PerfPhase = (typeof PERF_PHASES)[keyof typeof PERF_PHASES];

/** span 期间的标签（如 `{ step: 'zip' }`、`{ chapters: 50 }`） */
export type PerfLabels = Readonly<Record<string, unknown>>;

/** 进行中的耗时测量句柄 */
export interface ProfilerSpan {
  /** 结束测量（可附加结束期标签，与开始期标签合并，同名以结束期为准） */
  end(extraLabels?: PerfLabels): void;
}

/** 探针端口：宿主可注入自定义实现（如对接 OTel / statsd） */
export interface Profiler {
  /** 是否在采集（false 时调用方仍可无脑打点，实现须保证零行为） */
  readonly collecting: boolean;
  /** 开始一段测量 */
  span(phase: string, labels?: PerfLabels): ProfilerSpan;
}

/** 单组聚合数值（毫秒） */
export interface PerfSpanStats {
  /** 次数 */
  count: number;
  /** 累计毫秒 */
  totalMs: number;
  /** 最小毫秒 */
  minMs: number;
  /** 最大毫秒 */
  maxMs: number;
  /** 平均毫秒 */
  meanMs: number;
}

/** 收集器报表：阶段 → 标签 → 聚合数值 */
export type PerfReport = Record<string, Record<string, PerfSpanStats>>;

/** 高精度当前时刻（与 vue `perfNow` 同口径） */
function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

const NOOP_SPAN: ProfilerSpan = { end: () => {} };

/** 缺省 no-op 探针（collecting=false，span 零聚合） */
export const NOOP_PROFILER: Profiler = {
  collecting: false,
  span: () => NOOP_SPAN,
};

/** no-op 探针（每次调用返回独立函数引用，语义同 NOOP_PROFILER） */
export function createNoopProfiler(): Profiler {
  return NOOP_PROFILER;
}

interface RunningSpan {
  phase: string;
  labels: PerfLabels | undefined;
  start: number;
}

/**
 * 收集型探针：按「阶段 × 标签」聚合耗时。
 *
 * 标签键：`labels` 为 undefined 时归入 `'*'`；多标签按插入序序列化为
 * `k1=v1,k2=v2`，结束期 `end(extraLabels)` 与开始期合并（同名覆盖）。
 */
export function createCollectingProfiler(): CollectingProfiler {
  const buckets = new Map<string, { count: number; total: number; min: number; max: number }>();
  const running = new Set<RunningSpan>();

  const keyOf = (phase: string, labels: PerfLabels | undefined): string => {
    if (labels === undefined) return `${phase}|*`;
    const parts = Object.entries(labels).map(([key, value]) => `${key}=${String(value)}`);
    return parts.length === 0 ? `${phase}|*` : `${phase}|${parts.join(',')}`;
  };

  const record = (phase: string, labels: PerfLabels | undefined, start: number): void => {
    const key = keyOf(phase, labels);
    const duration = nowMs() - start;
    const bucket = buckets.get(key);
    if (bucket === undefined) {
      buckets.set(key, { count: 1, total: duration, min: duration, max: duration });
      return;
    }
    bucket.count += 1;
    bucket.total += duration;
    bucket.min = Math.min(bucket.min, duration);
    bucket.max = Math.max(bucket.max, duration);
  };

  return {
    collecting: true,
    span(phase, labels) {
      const runningSpan: RunningSpan = { phase, labels, start: nowMs() };
      running.add(runningSpan);
      return {
        end(extraLabels) {
          /* 重复 end 幂等：只记一次（防御调用方在回调里误触） */
          if (!running.delete(runningSpan)) return;
          const merged = extraLabels === undefined
            ? runningSpan.labels
            : { ...runningSpan.labels, ...extraLabels };
          record(runningSpan.phase, merged, runningSpan.start);
        },
      };
    },
    reportJson() {
      const report: PerfReport = {};
      for (const [key, bucket] of buckets) {
        const separator = key.indexOf('|');
        const phase = key.slice(0, separator);
        const label = key.slice(separator + 1);
        const group = report[phase] ?? (report[phase] = {});
        group[label] = {
          count: bucket.count,
          totalMs: round3(bucket.total),
          minMs: round3(bucket.min),
          maxMs: round3(bucket.max),
          meanMs: round3(bucket.total / bucket.count),
        };
      }
      return report;
    },
    reportText() {
      const report = this.reportJson();
      const rows: { phase: string; label: string; stats: PerfSpanStats }[] = [];
      for (const phase of Object.keys(report).sort()) {
        for (const label of Object.keys(report[phase]).sort()) {
          rows.push({ phase, label, stats: report[phase][label] });
        }
      }
      const header = ['phase', 'label', 'count', 'total(ms)', 'mean(ms)', 'min(ms)', 'max(ms)'];
      const width = header.map((title) => title.length);
      const formatted = rows.map((row) => [
        row.phase,
        row.label,
        String(row.stats.count),
        row.stats.totalMs.toFixed(3),
        row.stats.meanMs.toFixed(3),
        row.stats.minMs.toFixed(3),
        row.stats.maxMs.toFixed(3),
      ]);
      for (const cells of formatted) {
        cells.forEach((cell, index) => {
          width[index] = Math.max(width[index], cell.length);
        });
      }
      const pad = (cells: string[]): string =>
        cells.map((cell, index) => cell.padEnd(width[index])).join('  ');
      const lines = [pad(header), '-'.repeat(width.reduce((sum, w) => sum + w, 0) + (width.length - 1) * 2)];
      for (const cells of formatted) lines.push(pad(cells));
      return lines.join('\n');
    },
    reset() {
      buckets.clear();
      running.clear();
    },
    get spanCount() {
      let count = 0;
      for (const bucket of buckets.values()) count += bucket.count;
      return count;
    },
  };
}

/** 收集型探针（带报表与重置） */
export interface CollectingProfiler extends Profiler {
  /** 结构化报表（阶段 → 标签 → 聚合数值） */
  reportJson(): PerfReport;
  /** 对齐文本表格（日志 / dump 文件用） */
  reportText(): string;
  /** 清空全部聚合与进行中的 span */
  reset(): void;
  /** 已结束的 span 总数（测试与冒烟用） */
  readonly spanCount: number;
}

/** 探针可选注入的统一取值（undefined / no-op 一律落到 NOOP_PROFILER） */
export function profilerOrNoop(profiler: Profiler | undefined): Profiler {
  return profiler ?? NOOP_PROFILER;
}
