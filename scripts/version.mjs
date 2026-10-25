#!/usr/bin/env node
/**
 * bibliotype 日期版本脚本（按变更说明增量升版）
 *
 * 用法：
 *   node scripts/version.mjs [--channel rc|latest] [--base YY.M.D] [--dry-run] [--all] [--reuse-pending]
 *
 * 行为（增量发布模型）：
 *   1. 读取 .changeset/*.md 变更说明；**只有出现在变更说明里的公开包**才升版，未变更包的版本号保持不动；
 *      私有包（demo / e2e）条目跳过并记录，未知包名仍报错；没有待发布变更时退出码 2；
 *   2. 计算日期版本号：YY.M.D（如 26.10.12）；rc 通道为 YY.M.D-rc.N（同日重复发布自动递增 N）；
 *      碰撞检查与 rc 递增只针对本批目标包；
 *   3. `--all`：忽略变更集范围，全部公开包升版（**仅首次发布用**，保证依赖闭包完整）；
 *      `--reuse-pending`：复用 .release/pending.json 的包清单，仅改版本号，
 *      不读/不删 changeset、不写 CHANGELOG（用于 rc → latest 提升）；
 *   4. 仅为升版包写 CHANGELOG；仅当 @bibliotype/core 升版时写回 packages/core/src/version.ts；
 *   5. 写入 .release/pending.json（发布脚本 pull 取待发清单）；
 *   6. 删除已消费的变更说明文件（--reuse-pending 模式除外）；
 *   7. 输出 RELEASE_VERSION=<版本> 行，供脚本 / CI 提取。
 *
 * 退出码：0 成功；1 参数或状态错误；2 无待发布变更。
 *
 * 注意：本项目不使用 `changeset version` / `changeset publish`（版本号须为日期形式），
 *       完整流程见 docs/12-release-and-ci.md。
 *
 * 可导入性（I6）：主流程收在 run() 内，仅直接执行时触发；写函数与解析函数
 * 具名导出，供 scripts/check-version.mjs、scripts/publish.mjs 与测试复用（幂等验证）。
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHANGESET_DIR = join(ROOT, '.changeset');
const CORE_PACKAGE = '@bibliotype/core';

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
  const options = { channel: 'latest', base: null, dryRun: false, all: false, reusePending: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--all') {
      options.all = true;
    } else if (arg === '--reuse-pending') {
      options.reusePending = true;
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
  if (options.all && options.reusePending) {
    fail('--all 与 --reuse-pending 不能同时使用');
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

/* ---------- 待发布清单（.release/pending.json） ---------- */

/** 读取待发布清单；缺失或格式非法时抛错（发布脚本与 --reuse-pending 共用） */
export function readPending(root = ROOT) {
  const file = join(root, '.release/pending.json');
  if (!existsSync(file)) {
    fail('未找到 .release/pending.json；请先运行 pnpm version:rc / pnpm version:latest');
  }
  const data = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(data.packages) || data.packages.length === 0) {
    fail('.release/pending.json 缺少 packages 清单；请重新运行 pnpm version:rc / pnpm version:latest');
  }
  return data;
}

export function writePending(data, root = ROOT) {
  const dir = join(root, '.release');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'pending.json'),
    `${JSON.stringify({ channel: data.channel, version: data.version, packages: data.packages }, null, 2)}\n`,
    'utf8',
  );
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

/**
 * 解析本批目标包：变更说明涉及的公开包（`--all` 时为全部公开包）。
 * 私有包条目记入 skipped 并跳过，未知包名仍报错；目标为空时以退出码 2 中止。
 * 纯函数（不读写文件），供 run() 与单测复用。
 */
export function resolveTargets({ packages, changesets, all = false }) {
  const publicPackages = packages.filter((p) => !p.private);
  const publicNames = new Set(publicPackages.map((p) => p.name));
  const privateNames = new Set(packages.filter((p) => p.private).map((p) => p.name));
  const entriesByPackage = new Map(publicPackages.map((p) => [p.name, []]));
  const skipped = [];

  for (const changeset of changesets) {
    if (changeset.summary === '') fail(`变更说明缺少描述正文：.changeset/${changeset.file}`);
    for (const release of changeset.releases) {
      if (!publicNames.has(release.name)) {
        // 私有包（demo / e2e）不参与发布，条目只做记录：跳过而不是中止整批发布
        if (privateNames.has(release.name)) {
          skipped.push(`${release.name}（.changeset/${changeset.file}）`);
          continue;
        }
        fail(`变更说明 .changeset/${changeset.file} 引用了未知的包：${release.name}`); // 拼写错误仍拦截
      }
      entriesByPackage.get(release.name).push({ type: release.type, summary: changeset.summary });
    }
  }

  const changed = new Set(
    [...entriesByPackage].filter(([, entries]) => entries.length > 0).map(([name]) => name),
  );
  if (changed.size === 0) {
    fail('变更说明只涉及私有包，没有可发布的公开包', 2);
  }
  const targets = publicPackages.filter((p) => all || changed.has(p.name));
  return { targets, entriesByPackage, skipped };
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
    lines.push('- 随本次发布同步升级（无独立变更）', '');
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
  const publicNames = new Set(publicPackages.map((p) => p.name));

  let targets;
  let changesets = [];
  let entriesByPackage = new Map(publicPackages.map((p) => [p.name, []]));
  let skipped = [];

  if (options.reusePending) {
    const pending = readPending();
    const missing = pending.packages.filter((name) => !publicNames.has(name));
    if (missing.length > 0) fail(`.release/pending.json 中的包已不在工作区：${missing.join('、')}`);
    const wanted = new Set(pending.packages);
    targets = publicPackages.filter((p) => wanted.has(p.name));
  } else {
    changesets = loadChangesets();
    if (changesets.length === 0) {
      fail('没有待发布的变更说明（.changeset/*.md 为空）；请先运行 pnpm changeset 创建', 2);
    }
    ({ targets, entriesByPackage, skipped } = resolveTargets({ packages, changesets, all: options.all }));
    if (skipped.length > 0) console.log(`  跳过 ${skipped.length} 条私有包条目：${skipped.join('、')}`);
  }

  const version = computeVersion({ channel: options.channel, base: options.base, packages: targets });

  console.log(
    `${options.dryRun ? '[version] 日期版本计划（dry-run）' : '[version] 应用日期版本'}：channel=${options.channel}，目标版本 ${version}`,
  );
  console.log(
    `  变更说明 ${changesets.length} 个；公开包 ${publicPackages.length} 个；本次发布 ${targets.length} 个${
      publicPackages.length > targets.length ? `（其余 ${publicPackages.length - targets.length} 个未变更，跳过）` : ''
    }`,
  );
  for (const pkg of targets) {
    const count = entriesByPackage.get(pkg.name).length;
    const note = options.reusePending ? '仅更新版本号' : count > 0 ? `CHANGELOG +${count} 条` : 'CHANGELOG 占位说明';
    console.log(`  - ${pkg.name.padEnd(32)} ${pkg.version} → ${version}（${note}）`);
  }

  if (options.dryRun) {
    console.log('  （dry-run：未写入任何文件）');
    console.log(`RELEASE_VERSION=${version}`);
    return version;
  }

  for (const pkg of targets) {
    updateVersionField(pkg, version);
    if (!options.reusePending) prependChangelog(pkg, version, entriesByPackage.get(pkg.name));
  }
  if (targets.some((p) => p.name === CORE_PACKAGE)) updateCoreVersionTs();
  writePending({ channel: options.channel, version, packages: targets.map((p) => p.name) });
  if (!options.reusePending) {
    for (const changeset of changesets) {
      unlinkSync(join(CHANGESET_DIR, changeset.file));
    }
  }

  console.log(
    `  已更新 ${targets.length} 个包的版本${options.reusePending ? '' : '与 CHANGELOG'}，待发清单写入 .release/pending.json${
      options.reusePending ? '' : `，删除 ${changesets.length} 个变更说明`
    }`,
  );
  console.log('  下一步：pnpm release:check → 提交打 tag → pnpm release:rc / pnpm release');
  console.log(`RELEASE_VERSION=${version}`);
  return version;
}

/* 仅直接执行时运行主流程（被 import 时不执行，供 check-version.mjs / publish.mjs / 测试复用） */
const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  run().catch((error) => {
    const exitCode = error instanceof VersionScriptError ? error.exitCode : 1;
    console.error(`[version] 错误：${error.message}`);
    process.exit(exitCode);
  });
}
