/**
 * classical 插件集成测试
 *
 * 验证 D8 注册机制的完整生命周期：
 * 安装 → 节点注册 + 主题覆盖 → 卸载 → 全部还原。
 */
import { describe, expect, it } from 'vitest';
import { NAMESPACES, createBibliotype } from '@bibliotype/core';
import {
  CLASSICAL_NODE_TYPES,
  CLASSICAL_PLUGIN_NAME,
  CLASSICAL_THEME_TOKENS,
  createClassicalPlugin,
} from '../index.js';

describe('classical 插件', () => {
  it('安装后古籍节点全部注册到 classical 命名空间', () => {
    const bt = createBibliotype();
    bt.plugins.install(createClassicalPlugin());

    expect(bt.nodeTypes.has(CLASSICAL_NODE_TYPES.DOUBLE_NOTE)).toBe(true);
    expect(bt.nodeTypes.has(CLASSICAL_NODE_TYPES.COLLATION_NOTE)).toBe(true);
    expect(bt.nodeTypes.has(CLASSICAL_NODE_TYPES.SEAL)).toBe(true);

    const classicalDefs = bt.nodeTypes.listByNamespace(NAMESPACES.CLASSICAL);
    /* 13 + v2 批 1 新增 ink-nail / general-review */
    expect(classicalDefs.length).toBe(15);
  });

  it('安装后主题令牌被古籍风格覆盖', () => {
    const bt = createBibliotype();
    expect(bt.theme.get('text-indent-body')).toBe('2em');

    bt.plugins.install(createClassicalPlugin());
    expect(bt.theme.get('text-indent-body')).toBe('0');
    expect(bt.theme.get(CLASSICAL_THEME_TOKENS.WRITING_MODE)).toBe('vertical-rl');
    expect(bt.theme.get(CLASSICAL_THEME_TOKENS.TEXT_COMBINE_UPRIGHT)).toBe('digits');
  });

  it('卸载后节点注销、主题还原', () => {
    const bt = createBibliotype();
    const before = bt.theme.get('font-family-classical-body');

    bt.plugins.install(createClassicalPlugin());
    bt.plugins.uninstall(CLASSICAL_PLUGIN_NAME);

    expect(bt.nodeTypes.has(CLASSICAL_NODE_TYPES.DOUBLE_NOTE)).toBe(false);
    expect(bt.nodeTypes.listByNamespace(NAMESPACES.CLASSICAL)).toHaveLength(0);
    expect(bt.theme.get('text-indent-body')).toBe('2em');
    expect(bt.theme.get('font-family-classical-body')).toBe(before);
    expect(bt.theme.get(CLASSICAL_THEME_TOKENS.WRITING_MODE)).toBeUndefined();
  });

  it('支持调用方自定义主题覆盖', () => {
    const bt = createBibliotype();
    bt.plugins.install(
      createClassicalPlugin({
        overrides: { [CLASSICAL_THEME_TOKENS.WRITING_MODE]: 'horizontal-tb' },
      }),
    );
    expect(bt.theme.get(CLASSICAL_THEME_TOKENS.WRITING_MODE)).toBe('horizontal-tb');
  });

  it('重复安装（同名插件）抛出冲突错误', () => {
    const bt = createBibliotype();
    bt.plugins.install(createClassicalPlugin());
    expect(() => bt.plugins.install(createClassicalPlugin())).toThrow();
  });

  it('实例 dispose 后古籍节点与主题全部清理', () => {
    const bt = createBibliotype();
    bt.plugins.install(createClassicalPlugin());
    bt.dispose();
    expect(bt.nodeTypes.listByNamespace(NAMESPACES.CLASSICAL)).toHaveLength(0);
    expect(bt.theme.get(CLASSICAL_THEME_TOKENS.WRITING_MODE)).toBeUndefined();
  });
});
