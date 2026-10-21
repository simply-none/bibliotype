#!/usr/bin/env node
/**
 * bibliotype 日期版本脚本（消费 Changesets 变更说明，生成日期版本号）
 *
 * 用法：
 *   node scripts/version.mjs [--channel rc|latest] [--base YY.M.D] [--dry-run]
 *
 * 行为（统一版本列车模型）：
 *   1. 读取 .changeset/*.md 变更说明；没有待发布变更时退出码 2（发布流程应中止）；
 *   2. 计算日期版本号：YY.M.D（如 26.10.12）；rc 通道为 YY.M.D-rc.N（同日重复发布自动递增 N）；
 *   3. 将全部公开包（非 private）统一升级到该版本（内部依赖 workspace:* 由 pnpm 在发布时改写）；
 *   4. 将版本号写回 packages/core/src/version.ts 的 VERSION 常量（I6：消除手工同步）；
 *   5. 为变更说明涉及的包写入 CHANGELOG.md，其余包写入"随版本列车同步"占位说明；
 *   6. 删除已消费的变更说明文件；
 *   7. 输出 RELEASE_VERSION=<版本> 行，供 CI 提取。
 *
 * 退出码：0 成功；1 参数或状态错误；2 无待发布变更。
 *
 * 注意：本项目不使用 `changeset version` / `changeset publish`（版本号须为日期形式），
 *       完整流程见 docs/12-release-and-ci.md。
 *
 * 可导入性（I6）：主流程收在 run() 内，仅直接执行时触发；写函数与解析函数
 * 具名导出，供 scripts/check-version.mjs 与测试复用（幂等验证）。
 */

import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHANGESET_DIR = join(ROOT, '.changeset');

const RELEASE_LEVELS = ['major', 'minor', 'patch'];
const LEVEL_TITLES = { major: 'Major Changes', minor: 'Minor Changes', patch: 'Patch Changes' };

/** 变更说明文件：frontmatter + 正文 */
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/** 带 exitCode 的脚本错误：run() 捕获后按 exitCode 退出 */
class VersionScriptError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'VersionScriptError';
    this.exitCode = exitCode;
  }
}

function fail(message, code = 1) {
  throw new VersionScriptError(message, code);
}

/* ---------- 参数解析 ---------- */

export function parseArgs(argv) {
  const options = { channel: 'latest', base: null, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--channel') {
      options.channel = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--channel=')) {
      options.channel = arg.slice('--channel='.length);
    } else if (arg === '--base') {
      options.base = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--base=')) {
      options.base = arg.slice('--base='.length);
    } else {
      fail(`未知参数：${arg}`);
    }
  }
  if (options.channel !== 'rc' && options.channel !== 'latest') {
    fail('--channel 仅支持 rc 或 latest');
  }
  if (options.base !== null && !/^\d{2}\.\d{1,2}\.\d{1,2}$/.test(options.base)) {
    fail('--base 格式应为 YY.M.D（如 26.10.12）');
  }
  return options;
}

/* ---------- 工作区扫描 ---------- */

/** 解析 pnpm-workspace.yaml 中的一级 glob（本仓库为 packages/* 与 apps/*） */
export function loadWorkspaceDirs(root = ROOT) {
  const configPath = join(root, 'pnpm-workspace.yaml');
  const dirs = [];
  for (const line of readFileSync(configPath, 'utf8').split(/\r?\n/)) {
    const match = /^\s*-\s*['"]?([^'"\s]+)['"]?\s*$/.exec(line);
    if (match === null || !match[1].endsWith('/*')) continue;
    const baseDir = join(root, match[1].slice(0, -2));
    if (!existsSync(baseDir)) continue;
    for (const name of readdirSync(baseDir)) {
      const dir = join(baseDir, name);
      if (existsSync(join(dir, 'package.json'))) dirs.push(dir);
    }
  }
  return dirs;
}

export function loadPackages(root = ROOT) {
  return loadWorkspaceDirs(root).map((dir) => {
    const manifestPath = join(dir, 'package.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    return {
      dir,
      relDir: dir.slice(root.length + 1).replace(/\\/g, '/'),
      manifestPath,
      name: manifest.name,
      version: manifest.version,
      private: manifest.private === true,
    };
  });
}

/* ---------- 变更说明读取与校验 ---------- */

export function loadChangesets(changesetDir = CHANGESET_DIR) {
  if (!existsSync(changesetDir)) fail('未找到 .changeset 目录');
  const files = readdirSync(changesetDir).filter((file) => file.endsWith('.md') && file !== 'README.md');
  return files.sort().map((file) => {
    const raw = readFileSync(join(changesetDir, file), 'utf8');
    const match = FRONTMATTER.exec(raw);
    if (match === null) fail(`变更说明缺少 frontmatter：.changeset/${file}`);
    const releases = [];
    for (const line of match[1].split(/\r?\n/)) {
      if (line.trim() === '') continue;
      const entry = /^['"]?([^'":]+)['"]?:\s*(major|minor|patch)\s*$/.exec(line.trim());
      if (entry === null) fail(`变更说明条目无法解析（.changeset/${file}）：${line.trim()}`);
      releases.push({ name: entry[1], type: entry[2] });
    }
    if (releases.length === 0) fail(`变更说明未列出任何包：.changeset/${file}`);
    return { file, releases, summary: match[2].trim() };
  });
}

/* ---------- 版本号计算 ---------- */

/** 日期版本基准：YY.M.D（数字段不带前导零，符合 semver 要求） */
export function todayBase(now = new Date()) {
  const yy = String(now.getFullYear() % 100).padStart(2, '0');
  return `${yy}.${now.getMonth() + 1}.${now.getDate()}`;
}

export function computeVersion({ channel, base, packages }) {
  const baseVersion = base ?? todayBase();
  if (channel === 'latest') {
    const collision = packages.find((p) => !p.private && p.version === baseVersion);
    if (collision !== undefined) {
      fail(`版本 ${baseVersion} 已存在于 ${collision.name}；当日重复发布请改用 --channel rc，或通过 --base 指定其它基准`);
    }
    return baseVersion;
  }
  const rcPattern = new RegExp(`^${baseVersion.replace(/\./g, '\\.')}-rc\\.(\\d+)$`);
  let maxRc = 0;
  for (const p of packages) {
    const match = rcPattern.exec(p.version);
    if (match !== null) maxRc = Math.max(maxRc, Number(match[1]));
  }
  return `${baseVersion}-rc.${maxRc + 1}`;
}

/* ---------- CHANGELOG ---------- */

export function buildChangelogSection(version, entries) {
  const lines = [`## ${version}`, ''];
  if (entries.length === 0) {
    lines.push('- 随版本列车同步发布（无独立变更，依赖版本同步升级）', '');
    return lines.join('\n');
  }
  for (const level of RELEASE_LEVELS) {
    const items = entries.filter((entry) => entry.type === level);
    if (items.length === 0) continue;
    lines.push(`### ${LEVEL_TITLES[level]}`, '');
    for (const item of items) {
      lines.push(`- ${item.summary.replace(/\r?\n/g, '\n  ')}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function prependChangelog(pkg, version, entries) {
  const changelogPath = join(pkg.dir, 'CHANGELOG.md');
  const section = buildChangelogSection(version, entries);
  if (!existsSync(changelogPath)) {
    writeFileSync(changelogPath, `# ${pkg.name}\n\n${section}`, 'utf8');
    return;
  }
  const current = readFileSync(changelogPath, 'utf8');
  const header = /^# .*\r?\n/.exec(current);
  const insertAt = header === null ? 0 : header[0].length;
  writeFileSync(changelogPath, `${current.slice(0, insertAt)}\n${section}${current.slice(insertAt)}`, 'utf8');
}

/* ---------- 版本字段写入（正则替换，保留原文件格式） ---------- */

/** 写单个包 package.json 的 version 字段；无法定位字段时抛错（run 统一转退出码 1） */
export function updateVersionField(pkg, newVersion) {
  const raw = readFileSync(pkg.manifestPath, 'utf8');
  const pattern = /("version"\s*:\s*")[^"]+(")/;
  if (!pattern.test(raw)) throw new Error(`未能在 ${pkg.relDir}/package.json 中定位 version 字段`);
  // 用 replacer 函数而非 $1/$2：版本号以数字开头时 `$10.1.0$2` 会被误读为捕获组 10
  writeFileSync(pkg.manifestPath, raw.replace(pattern, (_, g1, g2) => g1 + newVersion + g2), 'utf8');
}

/**
 * 写回 packages/core/src/version.ts 的 VERSION 常量（I6：版本号单源，消除手工同步）。
 * 仅替换 VERSION 字面量，文件其余内容保持不变；幂等（同值重写零 diff）。
 * 兼容单双引号与调用方自定义路径（测试用 tmp fixture）。
 */
export function updateCoreVersionTs(root = ROOT, newVersion, versionTsPath = join(root, 'packages/core/src/version.ts')) {
  const raw = readFileSync(versionTsPath, 'utf8');
  const pattern = /(export const VERSION\s*=\s*['"])[^'"]+(['"])/;
  if (!pattern.test(raw)) {
    const relPath = versionTsPath.slice(root.length + 1).replace(/\\/g, '/');
    throw new Error(`未能在 ${relPath} 中定位 VERSION 常量`);
  }
  // 写入同值时 updated === raw 属正常幂等，不视为失败；replacer 函数避免 $10 歧义
  writeFileSync(versionTsPath, raw.replace(pattern, (_, g1, g2) => g1 + newVersion + g2), 'utf8');
}

/* ---------- 主流程 ---------- */

export async function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const packages = loadPackages();
  const publicPackages = packages.filter((p) => !p.private);
  const privatePackages = packages.filter((p) => p.private);
  const changesets = loadChangesets();

  if (changesets.length === 0) {
    fail('没有待发布的变更说明（.changeset/*.md 为空）；请先运行 pnpm changeset 创建', 2);
  }

  const byName = new Map(publicPackages.map((p) => [p.name, p]));
  const entriesByPackage = new Map(publicPackages.map((p) => [p.name, []]));
  for (const changeset of changesets) {
    if (changeset.summary === '') fail(`变更说明缺少描述正文：.changeset/${changeset.file}`);
    for (const release of changeset.releases) {
      if (!byName.has(release.name)) {
        fail(`变更说明 .changeset/${changeset.file} 引用了未知或私有的包：${release.name}`);
      }
      entriesByPackage.get(release.name).push({ type: release.type, summary: changeset.summary });
    }
  }

  const version = computeVersion({ ...options, packages });

  console.log(`${options.dryRun ? '[version] 日期版本计划（dry-run）' : '[version] 应用日期版本'}：channel=${options.channel}，目标版本 ${version}`);
  console.log(`  变更说明 ${changesets.length} 个；公开包 ${publicPackages.length} 个${privatePackages.length > 0 ? `；私有包 ${privatePackages.length} 个（跳过）` : ''}`);
  for (const pkg of publicPackages) {
    const count = entriesByPackage.get(pkg.name).length;
    const note = count > 0 ? `CHANGELOG +${count} 条` : 'CHANGELOG 占位说明';
    console.log(`  - ${pkg.name.padEnd(32)} ${pkg.version} → ${version}（${note}）`);
  }

  if (options.dryRun) {
    console.log('  （dry-run：未写入任何文件）');
    console.log(`RELEASE_VERSION=${version}`);
    return version;
  }

  for (const pkg of publicPackages) {
    updateVersionField(pkg, version);
    prependChangelog(pkg, version, entriesByPackage.get(pkg.name));
  }
  updateCoreVersionTs();
  for (const changeset of changesets) {
    unlinkSync(join(CHANGESET_DIR, changeset.file));
  }

  console.log(`  已更新 ${publicPackages.length} 个包的版本与 CHANGELOG，写回 core/src/version.ts，删除 ${changesets.length} 个变更说明`);
  console.log('  下一步：pnpm release:rc / pnpm release（构建并发布），或提交后再发布');
  console.log(`RELEASE_VERSION=${version}`);
  return version;
}

/* 仅直接执行时运行主流程（被 import 时不执行，供 check-version.mjs 与测试复用） */
const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  run().catch((error) => {
    const exitCode = error instanceof VersionScriptError ? error.exitCode : 1;
    console.error(`[version] 错误：${error.message}`);
    process.exit(exitCode);
  });
}
