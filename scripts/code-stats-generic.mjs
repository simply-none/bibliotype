#!/usr/bin/env node
/**
 * 通用代码量统计脚本（单文件、零依赖、即拷即用）
 *
 * 用法：
 *   node code-stats-generic.mjs [选项]
 *
 * 默认统计「本脚本所在目录」下的全部源码文件：
 * 把脚本复制到任意目录（通常是项目根目录）后直接运行即可；
 * 也可以用 --root 指定其他统计目录。
 *
 * 选项：
 *   --root <dir>    指定统计目录（默认：脚本所在目录）
 *   --min-lines <n> 列出代码行超过 n 行的文件，默认 300
 *   --sort <mode>   一级目录排序：loc（代码行，默认）| files（文件数）| name（目录名）
 *   --exclude <dir> 额外排除一个目录名，可重复传入
 *   --json          以 JSON 形式输出统计结果（便于二次处理）
 *   --with-dist     将 dist、build、out、target 等构建产物目录计入统计
 *   -h, --help      显示帮助
 *
 * 统计口径：
 *   总行数 = 代码行 + 注释行 + 空行；
 *   代码行 = 含有效代码字符的行（字符串内的内容算代码，不算注释）；
 *   注释行 = 仅包含注释的行，块注释内的每一行按注释累计；
 *   注释率 = 注释行 ÷ (代码行 + 注释行)。
 *
 * 说明：脚本自身与依赖锁文件不计入统计；隐藏目录、node_modules、vendor 等默认排除。
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const SCRIPT_DIR = dirname(SCRIPT_FILE);

/** C 风格注释：行注释 + 块注释 */
const C_STYLE = { line: true, block: true };
/** 井号注释：Python、Shell、YAML 等 */
const HASH_STYLE = { hash: true };

/** 各扩展名支持的注释语法 */
const EXT_RULES = {
  // JS / TS 生态
  '.ts': C_STYLE,
  '.mts': C_STYLE,
  '.cts': C_STYLE,
  '.tsx': C_STYLE,
  '.js': C_STYLE,
  '.mjs': C_STYLE,
  '.cjs': C_STYLE,
  '.jsx': C_STYLE,
  '.vue': { line: true, block: true, html: true },
  '.svelte': { line: true, block: true, html: true },
  // 样式
  '.css': { block: true },
  '.scss': C_STYLE,
  '.sass': C_STYLE,
  '.less': C_STYLE,
  '.styl': C_STYLE,
  // 标记语言
  '.html': { html: true },
  '.htm': { html: true },
  '.xml': { html: true },
  // JVM 与移动端
  '.java': C_STYLE,
  '.kt': C_STYLE,
  '.kts': C_STYLE,
  '.scala': C_STYLE,
  '.groovy': C_STYLE,
  '.gradle': C_STYLE,
  '.dart': C_STYLE,
  '.swift': C_STYLE,
  // 系统 / 后端
  '.go': C_STYLE,
  '.rs': C_STYLE,
  '.c': C_STYLE,
  '.h': C_STYLE,
  '.cc': C_STYLE,
  '.cpp': C_STYLE,
  '.cxx': C_STYLE,
  '.hpp': C_STYLE,
  '.hh': C_STYLE,
  '.cs': C_STYLE,
  '.m': C_STYLE,
  '.mm': C_STYLE,
  '.php': { line: true, block: true, hash: true },
  '.rb': HASH_STYLE,
  '.pl': HASH_STYLE,
  '.pm': HASH_STYLE,
  '.r': HASH_STYLE,
  '.py': { hash: true, triple: true },
  '.pyi': { hash: true, triple: true },
  '.sh': HASH_STYLE,
  '.bash': HASH_STYLE,
  '.zsh': HASH_STYLE,
  '.fish': HASH_STYLE,
  '.ps1': HASH_STYLE,
  '.psm1': HASH_STYLE,
  '.sql': { dash: true },
  '.lua': { dash: true },
  '.proto': C_STYLE,
  '.graphql': HASH_STYLE,
  '.gql': HASH_STYLE,
  // 配置 / 文档
  '.json': {},
  '.jsonc': C_STYLE,
  '.json5': C_STYLE,
  '.yml': HASH_STYLE,
  '.yaml': HASH_STYLE,
  '.toml': HASH_STYLE,
  '.ini': HASH_STYLE,
  '.conf': HASH_STYLE,
  '.properties': HASH_STYLE,
  '.md': {},
  '.mdx': {},
  '.markdown': {},
  '.txt': {},
};

/** 始终排除的目录（隐藏目录另行判断） */
const BASE_IGNORED_DIRS = new Set(['node_modules', 'bower_components', 'vendor', 'coverage', '__pycache__']);
/** 构建产物目录，默认排除，--with-dist 时计入 */
const BUILD_IGNORED_DIRS = new Set(['dist', 'build', 'out', 'target', 'release']);

/** 依赖锁文件不计入代码量 */
const LOCKFILES = new Set(['pnpm-lock.yaml', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'bun.lockb']);

const SORT_MODES = ['loc', 'files', 'name'];
const NUM = new Intl.NumberFormat('en-US');

function fail(message, code = 1) {
  console.error(`[code-stats] 错误：${message}`);
  process.exit(code);
}

/* ---------- 参数解析 ---------- */

function nextValue(argv, index, flag) {
  const value = argv[index + 1];
  if (value === undefined) fail(`参数缺少取值：${flag}`);
  return value;
}

function parseArgs(argv) {
  const options = {
    root: SCRIPT_DIR,
    minLines: 300,
    sort: 'loc',
    exclude: [],
    json: false,
    withDist: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') {
      options.json = true;
    } else if (arg === '--with-dist') {
      options.withDist = true;
    } else if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else if (arg === '--root') {
      options.root = nextValue(argv, i, arg);
      i += 1;
    } else if (arg.startsWith('--root=')) {
      options.root = arg.slice('--root='.length);
    } else if (arg === '--exclude') {
      options.exclude.push(nextValue(argv, i, arg));
      i += 1;
    } else if (arg.startsWith('--exclude=')) {
      options.exclude.push(arg.slice('--exclude='.length));
    } else if (arg === '--min-lines') {
      options.minLines = Number(nextValue(argv, i, arg));
      i += 1;
    } else if (arg.startsWith('--min-lines=')) {
      options.minLines = Number(arg.slice('--min-lines='.length));
    } else if (arg === '--sort') {
      options.sort = nextValue(argv, i, arg);
      i += 1;
    } else if (arg.startsWith('--sort=')) {
      options.sort = arg.slice('--sort='.length);
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
  const resolvedRoot = resolve(process.cwd(), options.root);
  if (!existsSync(resolvedRoot) || !statSync(resolvedRoot).isDirectory()) {
    fail(`统计目录不存在或不是目录：${resolvedRoot}`);
  }
  options.root = resolvedRoot;
  return options;
}

function printUsage() {
  console.log(`用法：node code-stats-generic.mjs [选项]

默认统计本脚本所在目录，可复制到任意目录直接运行。

选项：
  --root <dir>    指定统计目录（默认：脚本所在目录）
  --min-lines <n> 列出代码行超过 n 行的文件，默认 300
  --sort <mode>   一级目录排序：loc（代码行，默认）| files（文件数）| name（目录名）
  --exclude <dir> 额外排除一个目录名，可重复传入
  --json          以 JSON 形式输出统计结果
  --with-dist     将 dist、build、out、target 等构建产物目录计入统计
  -h, --help      显示帮助`);
}

/* ---------- 目录扫描 ---------- */

function collectFiles(rootDir, options) {
  const ignoredDirs = new Set(BASE_IGNORED_DIRS);
  if (!options.withDist) {
    for (const name of BUILD_IGNORED_DIRS) ignoredDirs.add(name);
  }
  for (const name of options.exclude) ignoredDirs.add(name);
  const files = [];
  walkDir(rootDir, rootDir, files, ignoredDirs);
  return files;
}

function walkDir(rootDir, currentDir, files, ignoredDirs) {
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
      walkDir(rootDir, fullPath, files, ignoredDirs);
    } else if (entry.isFile()) {
      if (resolve(fullPath) === resolve(SCRIPT_FILE)) continue;
      if (LOCKFILES.has(entry.name.toLowerCase())) continue;
      const ext = extname(entry.name).toLowerCase();
      const rule = EXT_RULES[ext];
      if (rule === undefined) continue;
      if (entry.name.endsWith('.map') || /\.min\.(js|css)$/.test(entry.name)) continue;
      const stat = analyzeFile(rootDir, fullPath, rule);
      if (stat === null) continue;
      files.push({ ...stat, ext });
    }
  }
}

function analyzeFile(rootDir, fullPath, rule) {
  let content;
  try {
    content = readFileSync(fullPath, 'utf8');
  } catch {
    return null;
  }
  // 含 NUL 字符视为二进制，跳过
  if (content.includes('\u0000')) return null;
  const counts = countLines(content, rule);
  return { path: relative(rootDir, fullPath).split(sep).join('/'), ...counts };
}

/* ---------- 行级统计 ---------- */

/**
 * 逐行分类：代码行 / 注释行 / 空行。
 * 使用轻量状态机识别行注释、块注释、HTML 注释与跨行字符串（含 Python 三引号），
 * 不追求完整语法解析，但能避免字符串里的注释符号被误判。
 */
function countLines(content, rule) {
  const lines = content.split(/\r\n|\r|\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const state = { block: false, html: false, quote: null };
  let code = 0;
  let comment = 0;
  let blank = 0;
  for (let index = 0; index < lines.length; index += 1) {
    // shebang 视为注释
    if (index === 0 && lines[index].startsWith('#!')) {
      comment += 1;
      continue;
    }
    const result = scanLine(lines[index], rule, state);
    if (result.code) code += 1;
    else if (result.comment) comment += 1;
    else blank += 1;
    // 单双引号不跨行，避免未闭合引号吞掉后续行（三引号与模板字符串除外）
    if (state.quote !== null && state.quote.length < 3 && state.quote !== '`') state.quote = null;
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
      if (state.quote.length === 3) {
        if (line.startsWith(state.quote, i)) {
          state.quote = null;
          i += 3;
          continue;
        }
        i += 1;
        continue;
      }
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
      if (rule.triple === true && char !== '`' && line.startsWith(char.repeat(3), i)) {
        state.quote = char.repeat(3);
        i += 3;
      } else {
        state.quote = char;
        i += 1;
      }
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
    if (rule.hash === true && char === '#') {
      comment = true;
      return { code, comment };
    }
    if (rule.dash === true && char === '-' && line[i + 1] === '-') {
      comment = true;
      return { code, comment };
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

/** 以一级子目录为分组名，根目录下的散落文件归入「(根目录)」 */
function topGroup(relPath) {
  const index = relPath.indexOf('/');
  return index === -1 ? '(根目录)' : relPath.slice(0, index);
}

function summarizeByGroup(files) {
  const map = new Map();
  for (const file of files) {
    const dir = topGroup(file.path);
    let entry = map.get(dir);
    if (entry === undefined) {
      entry = { dir, files: [] };
      map.set(dir, entry);
    }
    entry.files.push(file);
  }
  return [...map.values()].map((entry) => ({ dir: entry.dir, summary: summarize(entry.files) }));
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

function sortGroups(groups, mode) {
  const sorted = [...groups];
  sorted.sort((a, b) => {
    if (mode === 'name') return a.dir.localeCompare(b.dir);
    if (mode === 'files') return b.summary.files - a.summary.files || b.summary.code - a.summary.code;
    return b.summary.code - a.summary.code || b.summary.files - a.summary.files;
  });
  return sorted;
}

function printReport(groups, totals, byExt, largeFiles, options) {
  const out = [];
  const sortedGroups = sortGroups(groups, options.sort);
  const excluded = [...BASE_IGNORED_DIRS, ...(options.withDist ? [] : BUILD_IGNORED_DIRS), ...options.exclude];

  out.push(`代码量统计    目录：${options.root}`);
  out.push(`排除目录：${excluded.join('、')}、隐藏目录（脚本自身与锁文件不计入）`);
  out.push('');

  const rows = sortedGroups.map((group) => [
    group.dir,
    NUM.format(group.summary.files),
    NUM.format(group.summary.total),
    NUM.format(group.summary.code),
    NUM.format(group.summary.comment),
    NUM.format(group.summary.blank),
    formatRate(group.summary.comment, group.summary.code),
  ]);
  rows.push([
    '合计',
    NUM.format(totals.files),
    NUM.format(totals.total),
    NUM.format(totals.code),
    NUM.format(totals.comment),
    NUM.format(totals.blank),
    formatRate(totals.comment, totals.code),
  ]);

  out.push('【按一级目录统计】');
  out.push(
    ...renderTable(
      ['目录', '文件数', '总行数', '代码行', '注释行', '空行', '注释率'],
      rows,
      ['left', 'right', 'right', 'right', 'right', 'right', 'right'],
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

function printJson(groups, totals, byExt, largeFiles, options) {
  const payload = {
    root: options.root,
    generatedAt: new Date().toISOString(),
    totals: { ...totals, commentRate: percentValue(totals.comment, totals.code) },
    byGroup: sortGroups(groups, 'name').map((group) => ({
      dir: group.dir,
      ...group.summary,
      commentRate: percentValue(group.summary.comment, group.summary.code),
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

  const files = collectFiles(options.root, options);
  if (files.length === 0) fail(`目录下没有可统计的源码文件：${options.root}`);

  const totals = summarize(files);
  const groups = summarizeByGroup(files);
  const byExt = summarizeByExt(files);
  const largeFiles = files
    .filter((file) => file.code > options.minLines)
    .sort((a, b) => b.code - a.code || b.total - a.total || a.path.localeCompare(b.path));

  if (options.json) {
    printJson(groups, totals, byExt, largeFiles, options);
    return;
  }
  printReport(groups, totals, byExt, largeFiles, options);
}

main();
