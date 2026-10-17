/**
 * 开发期性能探针（P0 诊断）
 *
 * 汇总两条高频链路的耗时，回答「卡顿到底花在分页重排还是整本落盘」：
 * - `bt:layout` / `bt:measure`：分页重排与离屏量尺；
 * - `bt:save`：自动落盘一轮（取快照 → 结构化克隆 → IndexedDB 写）。
 *
 * 另挂 `longtask` 观测：>50ms 的主线程长任务次数 / 总时长 / 最长，用来确认
 * 用户可感知的卡顿确实发生、以及发生频次是否与落盘节奏吻合。
 *
 * 用法（浏览器控制台）：
 * ```js
 * __btPerf.report()   // 打印汇总表
 * __btPerf.reset()    // 清空统计（改完参数后再测一轮）
 * __btPerf.stop()     // 停止观测
 * ```
 * 仅在 `import.meta.env.DEV` 下安装，生产不产出任何埋点条目。
 */
import {
  PERF_AUTOSAVE,
  PERF_LAYOUT,
  PERF_MEASURE,
  setPerfProbeEnabled,
} from '@bibliotype/vue';

/** 单条埋点的累计统计 */
export interface PerfSpanStat {
  /** 埋点名 */
  name: string;
  /** 触发次数 */
  count: number;
  /** 总耗时（ms） */
  total: number;
  /** 平均耗时（ms） */
  avg: number;
  /** 单次最长（ms） */
  max: number;
  /** 最近一次（ms） */
  last: number;
}

/** 长任务统计 */
export interface PerfLongTaskStat {
  /** 长任务次数（>50ms） */
  count: number;
  /** 长任务总时长（ms） */
  total: number;
  /** 单次最长（ms） */
  max: number;
}

/** 探针快照 */
export interface PerfSnapshot {
  /** 观测开始时刻 */
  startedAt: number;
  /** 观测时长（ms） */
  elapsed: number;
  /** 各埋点累计 */
  spans: PerfSpanStat[];
  /** 长任务累计 */
  longTasks: PerfLongTaskStat;
}

/** 探针句柄 */
export interface PerfProbe {
  /** 停止观测（并关闭埋点） */
  stop: () => void;
  /** 取当前快照 */
  snapshot: () => PerfSnapshot;
  /** 清空统计（保留观测） */
  reset: () => void;
  /** 打印汇总表 */
  report: () => void;
}

/** 演示层关心的埋点名 */
const TRACKED = [PERF_LAYOUT, PERF_MEASURE, PERF_AUTOSAVE] as const;

/** 创建累计器 */
function createStat(name: string): PerfSpanStat {
  return { name, count: 0, total: 0, avg: 0, max: 0, last: 0 };
}

/** 把一次耗时并入累计 */
function accumulate(stat: PerfSpanStat, duration: number): void {
  stat.count += 1;
  stat.total += duration;
  stat.avg = stat.total / stat.count;
  stat.max = Math.max(stat.max, duration);
  stat.last = duration;
}

/**
 * 安装性能探针
 *
 * @returns 探针句柄（同时挂到 `globalThis.__btPerf` 便于控制台调用）
 */
export function installPerfProbe(): PerfProbe {
  const stats = new Map<string, PerfSpanStat>(TRACKED.map((name) => [name, createStat(name)]));
  const longTasks: PerfLongTaskStat = { count: 0, total: 0, max: 0 };
  const startedAt = Date.now();
  const observers: PerformanceObserver[] = [];

  setPerfProbeEnabled(true);

  // 埋点条目（bt:* measure）
  if (typeof PerformanceObserver !== 'undefined') {
    try {
      const measureObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const stat = stats.get(entry.name);
          if (stat !== undefined) accumulate(stat, entry.duration);
        }
      });
      measureObserver.observe({ entryTypes: ['measure'] });
      observers.push(measureObserver);
    } catch {
      /* 该环境不支持 measure 观测：埋点仍记录，但不汇总 */
    }

    // 长任务（Chrome 系支持；不支持时静默跳过）
    try {
      const longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longTasks.count += 1;
          longTasks.total += entry.duration;
          longTasks.max = Math.max(longTasks.max, entry.duration);
        }
      });
      longTaskObserver.observe({ entryTypes: ['longtask'] });
      observers.push(longTaskObserver);
    } catch {
      /* 不支持 longtask（Safari / Firefox）：只留埋点统计 */
    }
  }

  const snapshot = (): PerfSnapshot => ({
    startedAt,
    elapsed: Date.now() - startedAt,
    spans: [...stats.values()].map((stat) => ({ ...stat })),
    longTasks: { ...longTasks },
  });

  const reset = (): void => {
    for (const name of stats.keys()) stats.set(name, createStat(name));
    longTasks.count = 0;
    longTasks.total = 0;
    longTasks.max = 0;
    // 清掉已积累的 measure 条目，避免缓冲区滚满后丢弃最新数据
    if (typeof performance !== 'undefined' && typeof performance.clearMeasures === 'function') {
      performance.clearMeasures();
    }
  };

  const report = (): void => {
    const data = snapshot();
    const rows = data.spans
      .filter((stat) => stat.count > 0)
      .map((stat) => ({
        埋点: stat.name,
        次数: stat.count,
        合计ms: Number(stat.total.toFixed(1)),
        平均ms: Number(stat.avg.toFixed(2)),
        最长ms: Number(stat.max.toFixed(1)),
      }));
    // 用 console.table 而非 log：一眼看出「谁次数多 / 谁单次贵」
    // eslint-disable-next-line no-console
    console.table(rows);
    // eslint-disable-next-line no-console
    console.info('[bt] 长任务', {
      次数: data.longTasks.count,
      合计ms: Number(data.longTasks.total.toFixed(1)),
      最长ms: Number(data.longTasks.max.toFixed(1)),
      观测秒数: Number((data.elapsed / 1000).toFixed(1)),
    });
  };

  const stop = (): void => {
    for (const observer of observers) observer.disconnect();
    observers.length = 0;
    setPerfProbeEnabled(false);
  };

  const probe: PerfProbe = { stop, snapshot, reset, report };
  // 控制台入口（dev 专用，随探针一并消失）
  (globalThis as { __btPerf?: PerfProbe }).__btPerf = probe;
  return probe;
}
