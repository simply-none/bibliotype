#!/usr/bin/env node
/**
 * 性能基准 runner（I5）
 *
 * 三组 node 环境纯函数基准（与 core `PERF_PHASES` 阶段口径一致）：
 *   1. layout 分页：`paginate` 约 1000 页量级合成块（含混合双栏）；
 *   2. EPUB 打包：50 章 × 50 段合成文档 `exportEpub`；
 *   3. XHTML 序列化：约 5000 节点 `serializeNode`（替代 DOM 量尺——
 *      量尺依赖浏览器离屏测量，node 基准以「量尺产物的消费端」覆盖，见 docs/18）。
 *
 * 用法：
 *   pnpm bench            # 构建后跑基准并与 bench/baseline.json 对比（劣化 >15% 失败）
 *   pnpm bench:update     # 跑基准并把结果写为新基线（基线带 node 版本与平台）
 *
 * 行为：
 *   - 每项预热 1 轮弃样，正式采样 5 轮取中位数；
 *   - 缺基线时（首跑）只出报表并提示先 bench:update；
 *   - 基线的 node 版本 / 平台与当前不一致时警告（时序跨机不可比），不失败；
 *   - 对比失败退出码 1，输出 bench/report.md。
 *
 * 前置：pnpm build（runner 直接消费各包 dist ESM，不进发布产物）。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { REGRESSION_THRESHOLD, buildMarkdownReport, compareEntry, median } from './lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = join(ROOT, 'bench', 'baseline.json');
const REPORT_PATH = join(ROOT, 'bench', 'report.md');
const WARMUP_RUNS = 1;
const SAMPLE_RUNS = 5;

/* ---------- 基准输入合成 ---------- */

/** 分页：约 1000 页量级（3000 块 × 300px，页容量 1000；每 10 块一双栏） */
function buildPaginateBlocks() {
  const blocks = [];
  for (let i = 0; i < 3000; i += 1) {
    blocks.push(i % 10 === 0 ? { id: `b-${i}`, mainSize: 300, columns: 2 } : { id: `b-${i}`, mainSize: 300 });
  }
  return blocks;
}

/** EPUB：50 章 × 50 段（每段约 100 字） */
function buildEpubDocument(core, NODE_TYPES) {
  const { createEmptyDocument } = core;
  const doc = createEmptyDocument({
    title: 'bench 基准文档',
    language: 'zh-Hans',
    createdAt: '2026-10-21T00:00:00.000Z',
    updatedAt: '2026-10-21T00:00:00.000Z',
  });
  const filler = '子曰学而时习之不亦说乎有朋自远方来不亦乐乎人不知而不愠不亦君子乎。'.repeat(2);
  doc.root.children = Array.from({ length: 50 }, (_, chapterIndex) => ({
    type: NODE_TYPES.CHAPTER,
    id: `chap-${chapterIndex}`,
    attrs: { title: `第${chapterIndex + 1}章` },
    children: Array.from({ length: 50 }, (_, paragraphIndex) => ({
      type: NODE_TYPES.PARAGRAPH,
      id: `p-${chapterIndex}-${paragraphIndex}`,
      children: [{ type: 'text', text: filler }],
    })),
  }));
  return doc;
}

/** 序列化：单章 5000 段大节点树 */
function buildSerializeNode() {
  const filler = '不患人之不己知患不知人也。'.repeat(4);
  return {
    type: 'chapter',
    id: 'bench-root',
    attrs: { title: '序列化基准' },
    children: Array.from({ length: 5000 }, (_, index) => ({
      type: 'paragraph',
      id: `p-${index}`,
      children: [{ type: 'text', text: filler }],
    })),
  };
}

/* ---------- 计时 ---------- */

/** 预热 1 轮弃样 + 正式采样 5 轮，返回中位数毫秒 */
function measure(run) {
  for (let i = 0; i < WARMUP_RUNS; i += 1) run();
  const samples = [];
  for (let i = 0; i < SAMPLE_RUNS; i += 1) {
    const start = performance.now();
    run();
    samples.push(performance.now() - start);
  }
  return median(samples);
}

async function loadDist(relativePath) {
  const absolute = join(ROOT, relativePath);
  if (!existsSync(absolute)) {
    console.error(`[bench] 缺少构建产物：${relativePath}；请先运行 pnpm build`);
    process.exit(2);
  }
  return import(pathToFileURL(absolute).href);
}

async function main() {
  const argv = process.argv.slice(2);
  const update = argv.includes('--update');

  const [core, layoutMod, layoutHtml, epubMod] = await Promise.all([
    loadDist('packages/core/dist/index.js'),
    loadDist('packages/layout/dist/index.js'),
    loadDist('packages/layout/dist/html.js'),
    loadDist('packages/exporter-epub/dist/index.js'),
  ]);

  /* ---------- 基准项 ---------- */
  const paginateBlocks = buildPaginateBlocks();
  const epubDocument = buildEpubDocument(core, core.NODE_TYPES);
  const serializeRoot = buildSerializeNode();

  const metrics = {
    'layout/paginate-1000p': () => layoutMod.paginate(paginateBlocks, { pageMainSize: 1000 }),
    'exporter-epub/epub-50ch': () =>
      epubMod.exportEpub(epubDocument, { modified: '2026-10-21T00:00:00.000Z' }),
    'layout/serialize-5000nodes': () => layoutHtml.serializeNode(serializeRoot),
  };

  console.log(`[bench] Node ${process.version} / ${process.platform}；每项预热 ${WARMUP_RUNS} 轮 + 采样 ${SAMPLE_RUNS} 轮取中位数`);
  const current = {};
  for (const [metric, run] of Object.entries(metrics)) {
    process.stdout.write(`  - ${metric} … `);
    current[metric] = measure(run);
    console.log(`${current[metric].toFixed(2)} ms/op`);
  }

  const meta = { node: process.version, platform: process.platform, threshold: REGRESSION_THRESHOLD };

  if (update) {
    const baseline = {
      meta: { ...meta, createdAt: new Date().toISOString(), samples: SAMPLE_RUNS },
      entries: Object.fromEntries(
        Object.entries(current).map(([metric, msPerOp]) => [metric, { msPerOp: Number(msPerOp.toFixed(3)), samples: SAMPLE_RUNS }]),
      ),
    };
    writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
    console.log(`[bench] 新基线已写入 bench/baseline.json（${Object.keys(current).length} 项）`);
    return;
  }

  /* ---------- 与基线对比 ---------- */
  if (!existsSync(BASELINE_PATH)) {
    console.error('[bench] 未找到 bench/baseline.json；请先运行 pnpm bench:update 生成基线（首跑不判定）');
    process.exit(0);
  }

  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  if (baseline.meta?.node !== process.version || baseline.meta?.platform !== process.platform) {
    console.warn(`[bench] 警告：基线环境（${baseline.meta?.node ?? '?'} / ${baseline.meta?.platform ?? '?'}）与当前（${process.version} / ${process.platform}）不同，时序对比仅供参考`);
  }

  const rows = [];
  let failed = 0;
  for (const [metric, msPerOp] of Object.entries(current)) {
    const entry = baseline.entries?.[metric];
    if (entry === undefined) {
      console.warn(`[bench] 跳过 ${metric}：基线无此项（先 bench:update 更新基线）`);
      continue;
    }
    const result = compareEntry(entry.msPerOp, msPerOp);
    if (!result.pass) failed += 1;
    rows.push({ metric, baselineMs: entry.msPerOp, currentMs: msPerOp, deltaMs: result.deltaMs, ratio: result.ratio, pass: result.pass, verdict: result.verdict });
  }

  writeFileSync(REPORT_PATH, `${buildMarkdownReport(rows, meta)}\n`, 'utf8');
  console.log(`[bench] 报表已写入 bench/report.md`);
  if (failed > 0) {
    console.error(`[bench] ❌ ${failed} 项劣化超过 ${Math.round(REGRESSION_THRESHOLD * 100)}% 容忍带（详见报表）`);
    process.exit(1);
  }
  console.log('[bench] ✅ 全部基准项在容忍带内');
}

main().catch((error) => {
  console.error(`[bench] 错误：${error.message}`);
  process.exit(1);
});
