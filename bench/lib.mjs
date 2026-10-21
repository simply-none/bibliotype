/**
 * bench 对比与报表纯函数（I5 性能基准）
 *
 * 与 runner（run.mjs）分离，便于在 vitest 中做确定性单测：
 * - `median(samples)`：基准取中位数，抗离群值；
 * - `compareEntry(baseline, current, threshold)`：相对变化判定（劣化超阈失败）；
 * - `buildMarkdownReport(rows)`：输出 bench/report.md 用的 Markdown 表格。
 *
 * 约定：时序噪声不可避免，阈值默认 15%（劣化容忍带），通过/失败只看劣化方向，
 * 性能提升（负向变化）永远通过——避免"优化后基线未更新导致误报"。
 */

/** 默认劣化容忍带：相对基线劣化超过 15% 判失败（与 P4 清单 I5 口径一致） */
export const REGRESSION_THRESHOLD = 0.15;

/** 取中位数（偶数个样本取中间两值均值；空样本返回 NaN） */
export function median(samples) {
  if (samples.length === 0) return Number.NaN;
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * 单项对比。
 * @param baselineMs 基线毫秒（>0）
 * @param currentMs 当前毫秒（>0）
 * @param threshold 劣化容忍带（0.15 = 15%）
 * @returns {{ ratio: number, deltaMs: number, pass: boolean, verdict: string }}
 *   ratio = (current - baseline) / baseline；pass 为 false 表示劣化超阈
 */
export function compareEntry(baselineMs, currentMs, threshold = REGRESSION_THRESHOLD) {
  if (!(baselineMs > 0) || !(currentMs > 0)) {
    throw new TypeError(`对比要求正数耗时：baseline=${baselineMs} current=${currentMs}`);
  }
  const ratio = (currentMs - baselineMs) / baselineMs;
  const pass = ratio <= threshold;
  const percent = (ratio * 100).toFixed(1);
  return {
    ratio,
    deltaMs: currentMs - baselineMs,
    pass,
    verdict: pass
      ? `${ratio >= 0 ? '+' : ''}${percent}%（容忍带内）`
      : `劣化 ${percent}%，超过 ${Math.round(threshold * 100)}% 容忍带`,
  };
}

/** 报表行（runner 汇总后传入）：{ metric, baselineMs, currentMs, deltaMs, ratio, pass, verdict } */

/** 生成 Markdown 报表（全部通过时含 ✅ 汇总行，否则含 ❌ 与失败项） */
export function buildMarkdownReport(rows, meta = {}) {
  const header = [
    '# bench 对比报表',
    '',
    `> 生成时间：${new Date().toISOString()}；环境：${meta.node ?? 'unknown'} / ${meta.platform ?? 'unknown'}`,
    `> 容忍带：劣化 ${Math.round((meta.threshold ?? REGRESSION_THRESHOLD) * 100)}%；对比基线：bench/baseline.json`,
    '',
    '| 基准项 | 基线 (ms) | 当前 (ms) | 差值 (ms) | 相对变化 | 判定 |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  const body = rows.map((row) =>
    `| ${row.metric} | ${row.baselineMs.toFixed(2)} | ${row.currentMs.toFixed(2)} | ${row.deltaMs.toFixed(2)} | ${row.ratio >= 0 ? '+' : ''}${(row.ratio * 100).toFixed(1)}% | ${row.pass ? '✅' : '❌'} ${row.verdict} |`,
  );
  const failed = rows.filter((row) => !row.pass);
  const summary = [
    '',
    failed.length === 0
      ? '✅ 全部基准项在容忍带内。'
      : `❌ ${failed.length} 项劣化超阈：${failed.map((row) => row.metric).join('、')}。`,
    '',
  ];
  return [...header, ...body, ...summary].join('\n');
}
