#!/usr/bin/env node
/**
 * 批量发布到 npm：只发 .release/pending.json 列出的包，已存在的版本自动跳过。
 *
 * 用法：
 *   node scripts/publish.mjs [--tag rc|latest] [--dry-run]
 *
 * 行为：
 *   1. 读 .release/pending.json（由 scripts/version.mjs 写入的待发清单）；
 *   2. 强制 registry 为 https://registry.npmjs.org/（本机全局配置可能是镜像站，直接发布会发错站）；
 *      根目录存在 .npmrc.publish 时作为用户级 npmrc 挂载（token 存文件、不入库）；
 *   3. 查询 registry，跳过已发布同版本的包（中途失败可直接重跑）；
 *   4. 校验待发包的 @bibliotype/* 依赖版本在 registry 上存在，或本次一起发布（防止依赖 404）；
 *   5. pnpm -r --filter=<pkg> publish（pnpm 按拓扑序发布，core 在前）。
 *
 * 退出码：0 成功；1 失败。
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPackages, readPending } from './version.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = 'https://registry.npmjs.org/';
const PROJECT_NPMRC = join(ROOT, '.npmrc.publish');
const USE_SHELL = process.platform === 'win32';

function fail(message) {
  console.error(`[publish] 错误：${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = { tag: 'latest', dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--tag') {
      options.tag = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--tag=')) {
      options.tag = arg.slice('--tag='.length);
    } else {
      fail(`未知参数：${arg}`);
    }
  }
  if (options.tag !== 'rc' && options.tag !== 'latest') {
    fail('--tag 仅支持 rc 或 latest');
  }
  return options;
}

/** 子进程环境：强制 registry，并把项目内 npmrc 挂成用户级配置（token 存文件、不入库） */
function buildEnv() {
  const env = { ...process.env, npm_config_registry: REGISTRY };
  if (existsSync(PROJECT_NPMRC)) {
    env.NPM_CONFIG_USERCONFIG = PROJECT_NPMRC;
    console.log(`[publish] registry=${REGISTRY}（使用项目内 npmrc：.npmrc.publish）`);
  } else {
    console.log(`[publish] registry=${REGISTRY}（使用用户级 npmrc）`);
  }
  return env;
}

/** 发布前确认 token 可用（dry-run 不需要，跳过） */
function assertAuth(env) {
  const result = spawnSync('npm', ['whoami', `--registry=${REGISTRY}`], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    shell: USE_SHELL,
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    fail(
      `npm 认证失败（${detail || '无输出'}）；请把 //registry.npmjs.org/:_authToken 写入 .npmrc.publish 或用户级 npmrc，` +
        '并确认令牌具备 @bibliotype 写权限且已勾选 Bypass 2FA',
    );
  }
  console.log(`[publish] 已认证：${(result.stdout || '').trim()}`);
}

/** 查询包在 npmjs 上的全部已发布版本；包不存在返回空集 */
async function fetchPublishedVersions(name) {
  const url = `${REGISTRY}${name.replace('/', '%2f')}`;
  const response = await fetch(url);
  if (response.status === 404) return new Set();
  if (!response.ok) fail(`查询 ${name} 的已发布版本失败：HTTP ${response.status}`);
  const body = await response.json();
  return new Set(Object.keys(body.versions ?? {}));
}

async function main(argv) {
  const options = parseArgs(argv);
  const pending = readPending();
  const packages = new Map(loadPackages().map((p) => [p.name, p]));

  const targets = pending.packages.map((name) => {
    const pkg = packages.get(name);
    if (pkg === undefined) fail(`.release/pending.json 中的 ${name} 不在工作区`);
    if (pkg.version !== pending.version) {
      fail(`${name} 的本地版本 ${pkg.version} 与待发版本 ${pending.version} 不一致；请重新运行 pnpm version:rc / version:latest`);
    }
    const manifest = JSON.parse(readFileSync(pkg.manifestPath, 'utf8'));
    return { ...pkg, dependencies: manifest.dependencies ?? {} };
  });

  const env = buildEnv();
  if (!options.dryRun) assertAuth(env);

  // 需要查询 registry 的包：本批待发包 + 它们的 @bibliotype/* 依赖
  const internalDeps = new Set();
  for (const pkg of targets) {
    for (const dep of Object.keys(pkg.dependencies)) {
      if (dep.startsWith('@bibliotype/')) internalDeps.add(dep);
    }
  }
  const published = new Map();
  for (const name of new Set([...targets.map((p) => p.name), ...internalDeps])) {
    published.set(name, await fetchPublishedVersions(name));
  }

  const toPublish = targets.filter((pkg) => !published.get(pkg.name).has(pkg.version));
  const alreadyPublished = targets.filter((pkg) => published.get(pkg.name).has(pkg.version));
  if (alreadyPublished.length > 0) {
    console.log(
      `[publish] 已存在，跳过 ${alreadyPublished.length} 个：${alreadyPublished.map((pkg) => `${pkg.name}@${pkg.version}`).join('、')}`,
    );
  }
  if (toPublish.length === 0) {
    console.log(`[publish] 待发清单中的包均已发布（${pending.version}），无需操作`);
    return;
  }

  // 依赖闭包校验：发布后被依赖的 @bibliotype/* 版本必须能在 registry 上解析到
  const publishing = new Set(toPublish.map((pkg) => pkg.name));
  const problems = [];
  for (const pkg of toPublish) {
    for (const dep of Object.keys(pkg.dependencies)) {
      if (!dep.startsWith('@bibliotype/')) continue;
      const local = packages.get(dep);
      if (local === undefined) continue;
      if (publishing.has(dep) || published.get(dep).has(local.version)) continue;
      problems.push(`${pkg.name} → ${dep}@${local.version}`);
    }
  }
  if (problems.length > 0) {
    fail(`依赖版本在 npm 上不存在，拒绝发布（先补发依赖包，或首次发布改用 pnpm version:rc:all）：${problems.join('、')}`);
  }

  console.log(`[publish] 待发布 ${toPublish.length} 个包（tag=${options.tag}${options.dryRun ? '，dry-run' : ''}）：`);
  for (const pkg of toPublish) console.log(`  - ${pkg.name}@${pkg.version}`);

  const args = [
    '-r',
    ...toPublish.map((pkg) => `--filter=${pkg.name}`),
    'publish',
    '--tag',
    options.tag,
    '--no-git-checks',
    '--access',
    'public',
    `--registry=${REGISTRY}`,
  ];
  if (options.dryRun) args.push('--dry-run');

  const result = spawnSync('pnpm', args, { cwd: ROOT, env, stdio: 'inherit', shell: USE_SHELL });
  if (result.status !== 0) fail(`pnpm publish 失败（退出码 ${result.status}）`);
  console.log(
    options.dryRun
      ? `[publish] dry-run 完成：${toPublish.length} 个包（版本 ${pending.version}，tag=${options.tag}）`
      : `[publish] 完成：已发布 ${toPublish.length} 个包（版本 ${pending.version}，tag=${options.tag}）`,
  );
}

main(process.argv.slice(2)).catch((error) => fail(error.message));
