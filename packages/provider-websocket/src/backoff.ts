/**
 * 重连退避（纯函数）
 *
 * - 指数增长，带比例抖动，避免多端同时重连造成雪崩；
 * - 抖动比例缺省 0.2（±20%），随机源可注入，测试可固定结果；
 * - 结果限制在 [0, maxDelayMs]，并对非法输入回退到基准值。
 */

/** 退避选项 */
export interface BackoffOptions {
  /** 首次重试基准（毫秒，缺省 500） */
  baseDelayMs?: number;
  /** 单次上限（毫秒，缺省 30_000） */
  maxDelayMs?: number;
  /** 增长因子（缺省 2） */
  factor?: number;
  /** 抖动比例 0–1（缺省 0.2；0 表示不抖动） */
  jitterRatio?: number;
  /** 随机源（缺省 Math.random；测试注入固定值） */
  random?: () => number;
}

/** 归一化后的退避参数 */
interface ResolvedBackoff {
  baseDelayMs: number;
  maxDelayMs: number;
  factor: number;
  jitterRatio: number;
  random: () => number;
}

/** 收拢非法参数，避免 NaN 一路传进定时器 */
function resolve(options: BackoffOptions): ResolvedBackoff {
  const base = options.baseDelayMs;
  const max = options.maxDelayMs;
  const factor = options.factor;
  const jitter = options.jitterRatio;
  return {
    baseDelayMs: typeof base === 'number' && Number.isFinite(base) && base > 0 ? base : 500,
    maxDelayMs: typeof max === 'number' && Number.isFinite(max) && max > 0 ? max : 30_000,
    factor: typeof factor === 'number' && Number.isFinite(factor) && factor >= 1 ? factor : 2,
    jitterRatio:
      typeof jitter === 'number' && Number.isFinite(jitter) && jitter >= 0 && jitter <= 1
        ? jitter
        : 0.2,
    random: options.random ?? Math.random,
  };
}

/**
 * 计算第 N 次重连的等待时间
 *
 * @param attempt 已重试次数（0 表示首次重连）
 * @returns 毫秒（整数，非负）
 */
export function nextReconnectDelay(attempt: number, options: BackoffOptions = {}): number {
  const resolved = resolve(options);
  const step = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 0;
  const raw = resolved.baseDelayMs * Math.pow(resolved.factor, step);
  const capped = Math.min(raw, resolved.maxDelayMs);
  const random = resolved.random;
  const sample = random();
  const normalized = Number.isFinite(sample) ? Math.min(1, Math.max(0, sample)) : 0.5;
  /* 抖动区间 [1 - ratio, 1 + ratio]，再夹到上限 */
  const factorJitter = 1 - resolved.jitterRatio + normalized * resolved.jitterRatio * 2;
  return Math.max(0, Math.round(Math.min(capped * factorJitter, resolved.maxDelayMs)));
}
