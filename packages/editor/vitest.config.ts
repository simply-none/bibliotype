/**
 * vitest 配置（editor 包）
 *
 * 修复：vitest 在 monorepo + pnpm 下，editor 源码经 vite-node 加载的
 * `prosemirror-state` 与 Node 外部化加载的 `prosemirror-keymap` /
 * `prosemirror-history`（及其内部的 `prosemirror-state`）会被解析成两份
 * 实例；当 `EditorState.create` 携带 history / keymap / 粘贴插件时，两侧
 * `PluginKey` 各自从 0 计数生成同名 `plugin$0` 字符串，触发
 * `RangeError: Adding different instances of a keyed plugin`。
 *
 * 组合拳：
 *  - `test.server.deps.inline`：把全部 prosemirror 包强制交由 vite-node 处理，
 *    与 editor 源码共用同一模块注册表 → 全进程唯一实例。
 *  - `resolve.alias`：把每个 prosemirror 包显式指向同一物理入口文件，既能兜底
 *    路径归一，又能让 Vite 在转换 prosemirror-state 时正确解析其传递依赖
 *    （prosemirror-transform / prosemirror-view 等），避免 pnpm 嵌套结构下
 *    “Failed to load url”。
 *  - `resolve.dedupe` + `resolve.modules` 含 pnpm 提升目录：再次兜底路径归一。
 */
import { defineConfig } from 'vitest/config';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const baseRequire = createRequire(import.meta.url);
const stateRequire = createRequire(baseRequire.resolve('prosemirror-state'));

const prosemirrorDeps = [
  'prosemirror-state',
  'prosemirror-model',
  'prosemirror-transform',
  'prosemirror-view',
  'prosemirror-commands',
  'prosemirror-keymap',
  'prosemirror-history',
  'prosemirror-schema-list',
];

/**
 * 解析包 ESM 入口物理路径（优先当前包，回退到 prosemirror-state 的嵌套
 * node_modules）。统一指向 `dist/index.js`（ESM），避免 ESM 构建与 CJS 构建
 * 被同时加载造成「同一包两份物理模块」的双实例。
 */
function resolveEntry(name: string): string {
  const resolved = (() => {
    try {
      return baseRequire.resolve(name);
    } catch {
      return stateRequire.resolve(name);
    }
  })();
  return resolved.replace(/index\.cjs$/, 'index.js');
}

const pnpmHoist = resolve(
  baseRequire.resolve('prosemirror-state'),
  '../../../.pnpm/node_modules',
);

export default defineConfig({
  resolve: {
    alias: prosemirrorDeps.map((name) => ({
      find: name,
      replacement: resolveEntry(name),
    })),
    dedupe: prosemirrorDeps,
    modules: ['node_modules', pnpmHoist],
  },
  ssr: {
    noExternal: prosemirrorDeps,
  },
  test: {
    environment: 'node',
  },
});
