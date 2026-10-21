#!/usr/bin/env node
/**
 * bibliotype 代码量统计脚本
 *
 * 用法：
 *   node scripts/code-stats.mjs [选项]
 *
 * 选项：
 *   --json          以 JSON 形式输出统计结果（便于二次处理）
 *   --sort <mode>   包排序方式：loc（代码行，默认）| files（文件数）| name（包名）
 *   --min-lines <n> 列出代码行超过 n 行的文件，默认 300
 *   --with-dist     将 dist 目录计入统计（默认排除构建产物）
 *   -h, --help      显示帮助
 *
 * 统计范围：
 *   pnpm-workspace.yaml 中 packages/* 与 apps/* 下含 package.json 的每个包，
 *   默认排除 node_modules、dist、.turbo、coverage、隐藏目录以及 *.min.js / *.map。
 *
 * 指标定义：
 *   总行数 = 代码行 + 注释行 + 空行；
 *   代码行 = 含有效代码字符的行（字符串内的内容算代码，不算注释）；
 *   注释行 = 仅包含注释的行，块注释内的每一行按注释累计；
 *   注释率 = 注释行 ÷ (代码行 + 注释行)。
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACE_FILE = join(ROOT, 'pnpm-workspace.yaml');

/** 各扩展名支持的注释语法 */
const EXT_RULES = {
  '.ts': { line: true, block: true },
  '.mts': { line: true, block: true },
  '.cts': { line: true, block: true },
  '.tsx': { line: true, block: true },
  '.js': { line: true, block: true },
  '.mjs': { line: true, block: true },
  '.cjs': { line: true, block: true },
  '.jsx': { line: true, block: true },
  '.vue': { line: true, block: true, html: true },
  '.svelte': { line: true, block: true, html: true },
  '.css': { block: true },
  '.scss': { line: true, block: true },
  '.sass': { line: true, block: true },
  '.less': { line: true, block: true },
  '.html': { html: true },
  '.htm': { html: true },
  '.json': {},
  '.jsonc': { line: true, block: true },
  '.json5': { line: true, block: true },
  '.md': {},
  '.mdx': {},
  '.yml': {},
  '.yaml': {},
  '.toml': {},
};

/** 始终排除的目录（隐藏目录另行判断） */
const BASE_IGNORED_DIRS = new Set(['node_modules', 'coverage']);
/** 构建产物目录，默认排除，--with-dist 时计入 */
const DIST_IGNORED_DIRS = new Set(['dist']);

const SORT_MODES = ['loc', 'files', 'name'];
const NUM = new Intl.NumberFormat('en-US');

function fail(message, code = 1) {
  console.error(`[code-stats] 错误：${message}`);
  process.exit(code);
}

/* ---------- 参数解析 ---------- */

function parseArgs(argv) {
  const options = { json: false, sort: 'loc', minLines: 300, withDist: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') {
      options.json = true;
    } else if (arg === '--with-dist') {
      options.withDist = true;
    } else if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else if (arg === '--sort') {
      options.sort = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--sort=')) {
      options.sort = arg.slice('--sort='.length);
    } else if (arg === '--min-lines') {
      options.minLines = Number(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--min-lines=')) {
      options.minLines = Number(arg.slice('--min-lines='.length));
    } else {
      fail(`未知参数：${arg}`);
    }
  }
  if (!SORT_MODES.includes(options.sort)) {
    fail(`--sort 仅支持 ${SORT_MODES.join(' / ')}`);
  }
  if (!Number.isInteger(options.minLines) || options.minLines < 0) {
    fail('--min-lines 应为不小于 0 的整数');
  }
  return options;
}

function printUsage() {
  console.log(`用法：node scripts/code-stats.mjs [选项]

选项：
  --json          以 JSON 形式输出统计结果
  --sort <mode>   包排序方式：loc（代码行，默认）| files（文件数）| name（包名）
  --min-lines <n> 列出代码行超过 n 行的文件，默认 300
  --with-dist     将 dist 目录计入统计
  -h, --help      显示帮助`);
}

/* ---------- 工作区扫描 ---------- */

/** 解析 pnpm-workspace.yaml 中的一级 glob（本仓库为 packages/* 与 apps/*） */
function loadWorkspaceGroups() {
  if (!existsSync(WORKSPACE_FILE)) fail('未找到 pnpm-workspace.yaml');
  const groups = [];
  for (const line of readFileSync(WORKSPACE_FILE, 'utf8').split(/\r?\n/)) {
    const match = /^\s*-\s*['"]?([^'"\s]+)['"]?\s*$/.exec(line);
    if (match === null || !match[1].endsWith('/*')) continue;
    groups.push(match[1].slice(0, -2));
  }
  return groups;
}

function readManifest(manifestPath) {
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    return null;
  }
}

function collectPackages(options) {
  const ignoredDirs = new Set(BASE_IGNORED_DIRS);
  if (!options.withDist) {
    for (const name of DIST_IGNORED_DIRS) ignoredDirs.add(name);
  }

  const packages = [];
  for (const group of loadWorkspaceGroups()) {
    const groupDir = join(ROOT, group);
    if (!existsSync(groupDir)) continue;
    const entries = readdirSync(groupDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const dir = join(groupDir, entry.name);
      const manifest = readManifest(join(dir, 'package.json'));
      if (manifest === null) continue;
      const files = [];
      walkDir(dir, files, ignoredDirs);
      packages.push({ group, dirName: entry.name, name: manifest.name ?? entry.name, files });
    }
  }
  return packages;
}

function walkDir(currentDir, files, ignoredDirs) {
  let entries;
  try {
    entries = readdirSync(currentDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || ignoredDirs.has(entry.name)) continue;
      walkDir(fullPath, files, ignoredDirs);
    } else if (entry.isFile()) {
      const ext = extname(entry.name).toLowerCase();
      const rule = EXT_RULES[ext];
      if (rule === undefined) continue;
      if (entry.name.endsWith('.map') || /\.min\.(js|css)$/.test(entry.name)) continue;
      const stat = analyzeFile(fullPath, rule);
      if (stat === null) continue;
      files.push({ ...stat, ext });
    }
  }
}

function analyzeFile(fullPath, rule) {
  let content;
  try {
    content = readFileSync(fullPath, 'utf8');
  } catch {
    return null;
  }
  // 含 NUL 字符视为二进制，跳过
  if (content.includes('\u0000')) return null;
  const counts = countLines(content, rule);
  return { path: relative(ROOT, fullPath).split(sep).join('/'), ...counts };
}

/* ---------- 行级统计 ---------- */

/**
 * 逐行分类：代码行 / 注释行 / 空行。
 * 使用轻量状态机识别行注释、块注释、HTML 注释与跨行模板字符串，
 * 不追求完整语法解析，但能避免字符串里的注释符号被误判。
 */
function countLines(content, rule) {
  const lines = content.split(/\r\n|\r|\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const state = { block: false, html: false, quote: null };
  let code = 0;
  let comment = 0;
  let blank = 0;
  for (const raw of lines) {
    const result = scanLine(raw, rule, state);
    if (result.code) code += 1;
    else if (result.comment) comment += 1;
    else blank += 1;
    // 单双引号不跨行，避免未闭合引号吞掉后续行
    if (state.quote !== null && state.quote !== '`') state.quote = null;
  }
  return { total: lines.length, code, comment, blank };
}

function scanLine(line, rule, state) {
  let code = false;
  let comment = false;
  let i = 0;
  const length = line.length;
  while (i < length) {
    if (state.block) {
      comment = true;
      const end = line.indexOf('*/', i);
      if (end === -1) return { code, comment };
      state.block = false;
      i = end + 2;
      continue;
    }
    if (state.html) {
      comment = true;
      const end = line.indexOf('-->', i);
      if (end === -1) return { code, comment };
      state.html = false;
      i = end + 3;
      continue;
    }
    const char = line[i];
    if (state.quote !== null) {
      code = true;
      if (char === '\\') {
        i += 2;
        continue;
      }
      if (char === state.quote) state.quote = null;
      i += 1;
      continue;
    }
    if (char === ' ' || char === '\t') {
      i += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      code = true;
      state.quote = char;
      i += 1;
      continue;
    }
    if (rule.line === true && char === '/' && line[i + 1] === '/') {
      comment = true;
      return { code, comment };
    }
    if (rule.block === true && char === '/' && line[i + 1] === '*') {
      comment = true;
      state.block = true;
      i += 2;
      continue;
    }
    if (rule.html === true && char === '<' && line.startsWith('<!--', i)) {
      comment = true;
      state.html = true;
      i += 4;
      continue;
    }
    code = true;
    i += 1;
  }
  return { code, comment };
}

/* ---------- 汇总 ---------- */

function summarize(files) {
  const summary = { files: files.length, total: 0, code: 0, comment: 0, blank: 0 };
  for (const file of files) {
    summary.total += file.total;
    summary.code += file.code;
    summary.comment += file.comment;
    summary.blank += file.blank;
  }
  return summary;
}

function summarizeByExt(files) {
  const map = new Map();
  for (const file of files) {
    let entry = map.get(file.ext);
    if (entry === undefined) {
      entry = { ext: file.ext, files: 0, total: 0, code: 0, comment: 0, blank: 0 };
      map.set(file.ext, entry);
    }
    entry.files += 1;
    entry.total += file.total;
    entry.code += file.code;
    entry.comment += file.comment;
    entry.blank += file.blank;
  }
  return [...map.values()].sort((a, b) => b.code - a.code || b.files - a.files);
}

/* ---------- 输出 ---------- */

function displayWidth(text) {
  let width = 0;
  for (const char of String(text)) {
    // CJK 及全角字符按 2 列计算
    width += /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(char) ? 2 : 1;
  }
  return width;
}

function pad(text, width, align) {
  const gap = ' '.repeat(Math.max(0, width - displayWidth(text)));
  return align === 'right' ? `${gap}${text}` : `${text}${gap}`;
}

function renderTable(headers, rows, aligns) {
  const widths = headers.map((header, index) =>
    Math.max(displayWidth(header), ...rows.map((row) => displayWidth(row[index]))),
  );
  const renderRow = (cells) =>
    cells
      .map((cell, index) => pad(cell, widths[index], aligns[index]))
      .join('  ')
      .trimEnd();
  return [renderRow(headers), widths.map((width) => '─'.repeat(width)).join('  '), ...rows.map(renderRow)];
}

function formatRate(comment, code) {
  const denominator = comment + code;
  if (denominator === 0) return '0.0%';
  return `${((comment / denominator) * 100).toFixed(1)}%`;
}

function percentValue(comment, code) {
  const denominator = comment + code;
  if (denominator === 0) return 0;
  return Number(((comment / denominator) * 100).toFixed(1));
}

function sortPackages(packages, mode) {
  const sorted = [...packages];
  sorted.sort((a, b) => {
    if (mode === 'name') return a.name.localeCompare(b.name);
    if (mode === 'files') return b.summary.files - a.summary.files || b.summary.code - a.summary.code;
    return b.summary.code - a.summary.code || b.summary.files - a.summary.files;
  });
  return sorted;
}

function printReport(packages, totals, byExt, largeFiles, options) {
  const out = [];
  const sorted = sortPackages(packages, options.sort);

  out.push(`bibliotype 代码量统计    根目录：${ROOT}`);
  out.push(
    `扫描范围：${loadWorkspaceGroups().map((group) => `${group}/*`).join('、')}    排除目录：node_modules、.turbo、coverage${
      options.withDist ? '' : '、dist'
    } 及隐藏目录`,
  );
  out.push('');

  const rows = sorted.map((pkg) => [
    pkg.group,
    pkg.name,
    NUM.format(pkg.summary.files),
    NUM.format(pkg.summary.total),
    NUM.format(pkg.summary.code),
    NUM.format(pkg.summary.comment),
    NUM.format(pkg.summary.blank),
    formatRate(pkg.summary.comment, pkg.summary.code),
  ]);
  rows.push([
    '合计',
    `${packages.length} 个包`,
    NUM.format(totals.files),
    NUM.format(totals.total),
    NUM.format(totals.code),
    NUM.format(totals.comment),
    NUM.format(totals.blank),
    formatRate(totals.comment, totals.code),
  ]);

  out.push('【按包统计】');
  out.push(
    ...renderTable(
      ['分组', '包名', '文件数', '总行数', '代码行', '注释行', '空行', '注释率'],
      rows,
      ['left', 'left', 'right', 'right', 'right', 'right', 'right', 'right'],
    ),
  );

  out.push('');
  out.push('【按文件类型汇总】');
  out.push(
    ...renderTable(
      ['类型', '文件数', '总行数', '代码行', '注释行', '空行', '注释率'],
      byExt.map((entry) => [
        entry.ext,
        NUM.format(entry.files),
        NUM.format(entry.total),
        NUM.format(entry.code),
        NUM.format(entry.comment),
        NUM.format(entry.blank),
        formatRate(entry.comment, entry.code),
      ]),
      ['left', 'right', 'right', 'right', 'right', 'right', 'right'],
    ),
  );

  out.push('');
  if (largeFiles.length > 0) {
    out.push(`【代码行超过 ${options.minLines} 行的文件（按代码行降序，共 ${largeFiles.length} 个）】`);
    out.push(
      ...renderTable(
        ['序号', '文件', '代码行', '总行数'],
        largeFiles.map((file, index) => [
          String(index + 1),
          file.path,
          NUM.format(file.code),
          NUM.format(file.total),
        ]),
        ['right', 'left', 'right', 'right'],
      ),
    );
  } else {
    out.push(`【代码行超过 ${options.minLines} 行的文件】`);
    out.push('（无）');
  }

  console.log(out.join('\n'));
}

function printJson(packages, totals, byExt, largeFiles, options) {
  const payload = {
    root: ROOT,
    generatedAt: new Date().toISOString(),
    totals: { ...totals, commentRate: percentValue(totals.comment, totals.code) },
    packages: sortPackages(packages, 'name').map((pkg) => ({
      group: pkg.group,
      dir: pkg.dirName,
      name: pkg.name,
      files: pkg.summary.files,
      total: pkg.summary.total,
      code: pkg.summary.code,
      comment: pkg.summary.comment,
      blank: pkg.summary.blank,
      commentRate: percentValue(pkg.summary.comment, pkg.summary.code),
      byExt: summarizeByExt(pkg.files).map((entry) => ({
        ext: entry.ext,
        files: entry.files,
        total: entry.total,
        code: entry.code,
        comment: entry.comment,
        blank: entry.blank,
      })),
    })),
    byExt: byExt.map((entry) => ({ ...entry, commentRate: percentValue(entry.comment, entry.code) })),
    minLines: options.minLines,
    largeFiles,
  };
  console.log(JSON.stringify(payload, null, 2));
}

/* ---------- 入口 ---------- */

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  const packages = collectPackages(options);
  if (packages.length === 0) fail('未在 apps/* 或 packages/* 下找到任何包');

  for (const pkg of packages) pkg.summary = summarize(pkg.files);

  const allFiles = packages.flatMap((pkg) => pkg.files);
  const totals = summarize(allFiles);
  const byExt = summarizeByExt(allFiles);
  const largeFiles = allFiles
    .filter((file) => file.code > options.minLines)
    .sort((a, b) => b.code - a.code || b.total - a.total || a.path.localeCompare(b.path));

  if (options.json) {
    printJson(packages, totals, byExt, largeFiles, options);
    return;
  }
  printReport(packages, totals, byExt, largeFiles, options);
}

main();
