/**
 * classical 插件
 *
 * 安装时（对应 D8）：
 * 1. 向节点注册表批量注册古籍专有节点（原子操作，冲突则整体失败）；
 * 2. 向主题访问器写入古籍令牌覆盖，收集还原函数；
 * 3. 返回 dispose：还原主题、按命名空间注销节点。
 */
import { NAMESPACES, definePlugin, type BibliotypeContext } from '@bibliotype/core';
import { CLASSICAL_NODE_DEFINITIONS } from './node-definitions.js';
import { CLASSICAL_THEME_OVERRIDES } from './theme.js';

/** classical 插件名 */
export const CLASSICAL_PLUGIN_NAME = '@bibliotype/classical';

/**
 * 创建 classical 插件
 *
 * @param options.overrides 额外的主题覆盖（优先于默认古籍覆盖）
 */
export function createClassicalPlugin(options: {
  overrides?: Readonly<Record<string, string>>;
} = {}) {
  const themeOverrides = { ...CLASSICAL_THEME_OVERRIDES, ...options.overrides };

  return definePlugin({
    name: CLASSICAL_PLUGIN_NAME,
    version: '0.1.0',
    description: '古籍专有节点、标记与主题（双行小注、校勘、专名号等）',
    install(context: BibliotypeContext): () => void {
      // 1. 注册古籍节点（批量原子，冲突时抛出 NodeTypeConflictError）
      context.nodeTypes.registerAll(CLASSICAL_NODE_DEFINITIONS);

      // 2. 应用主题覆盖，收集还原函数
      const restores = Object.entries(themeOverrides).map(([token, value]) =>
        context.theme.set(token, value),
      );

      // 3. 卸载：逆序还原主题 + 按命名空间注销节点
      return () => {
        for (const restore of restores.reverse()) {
          restore();
        }
        context.nodeTypes.unregisterByNamespace(NAMESPACES.CLASSICAL);
      };
    },
  });
}
