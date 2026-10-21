#!/usr/bin/env node
/**
 * 版本一致性校验（release:check 前置断言，I6）
 *
 * 校验两条不变式（版本列车单源）：
 *   1. 全部公开包（非 private）package.json 的 version 一致；
 *   2. packages/core/src/version.ts 的 VERSION 常量与 packages/core/package.json 的 version 一致。
 *
 * 用法：
 *   node scripts/check-version.mjs [--root <dir>]
 *
 * 退出码：0 一致；1 存在漂移（输出指出漂移文件）。
 *
 * checkVersions({ root }) 具名导出，供测试与 CI 复用；--root 供 tmp fixture 负例验证。
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadPackages } from './version.mjs';

const SCRIPT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 从 version.ts 提取 VERSION 常量；缺失或非法时抛错 */
export function readCoreVersionTs(root) {
  const versionTsPath = join(root, 'packages/core/src/version.ts');
  const raw = readFileSync(versionTsPath, 'utf8');
  const match = /export const VERSION\s*=\s*['"]([^'"]*)['"]/.exec(raw);
  if (match === null) {
    const relPath = versionTsPath.slice(root.length + 1).replace(/\\/g, '/');
    throw new Error(`未能在 ${relPath} 中定位 VERSION 常量`);
  }
  return match[1];
}

/**
 * 校验版本列车与 core VERSION 对账。
 * @returns {{ ok: true, version: string, publicCount: number }} 一致时返回统一版本与公开包数
 * @throws {Error} 存在漂移（消息指出漂移文件）或 fixture 结构非法
 */
export function checkVersions({ root = SCRIPT_ROOT } = {}) {
  const packages = loadPackages(root);
  const publicPackages = packages.filter((p) => !p.private);

  if (publicPackages.length === 0) {
    throw new Error('工作区中未发现公开包（非 private）；请检查 pnpm-workspace.yaml 与各 package.json');
  }

  // 不变式 1：版本列车一致（以 @bibliotype/core 为锚，避免 readdir 顺序影响判定）
  const core = publicPackages.find((p) => p.name === '@bibliotype/core');
  if (core === undefined) {
    throw new Error('未在工作区中找到 @bibliotype/core 包');
  }
  const drift = publicPackages.filter((p) => p.version !== core.version);
  if (drift.length > 0) {
    const expected = core.version;
    const detail = drift.map((p) => `${p.name}@${p.version}（期望 ${expected}）`).join('、');
    throw new Error(`版本列车不一致：${detail}`);
  }

  // 不变式 2：core/src/version.ts 对账
  const versionTsValue = readCoreVersionTs(root);
  if (versionTsValue !== core.version) {
    throw new Error(`core/src/version.ts 的 VERSION（${versionTsValue}）与 packages/core/package.json 的 version（${core.version}）不一致；请运行 pnpm version:latest / version:rc 同步`);
  }

  return { ok: true, version: core.version, publicCount: publicPackages.length };
}

function main(argv) {
  let root = SCRIPT_ROOT;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--root') {
      root = argv[i + 1];
      i += 1;
    } else if (argv[i].startsWith('--root=')) {
      root = argv[i].slice('--root='.length);
    } else {
      console.error(`[check-version] 错误：未知参数：${argv[i]}`);
      process.exit(1);
    }
  }

  try {
    const { version, publicCount } = checkVersions({ root });
    console.log(`[check-version] 版本一致：${publicCount} 个公开包均为 ${version}，core/src/version.ts 已同步`);
    process.exit(0);
  } catch (error) {
    console.error(`[check-version] 错误：${error.message}`);
    process.exit(1);
  }
}

/* 仅直接执行时运行主流程（被 import 时不执行） */
const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main(process.argv.slice(2));
}
