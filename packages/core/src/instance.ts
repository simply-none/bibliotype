/**
 * bibliotype 核心实例（门面）
 *
 * 组合式设计：将事件总线、节点注册表、主题访问器、插件注册表
 * 组装为一个上下文完备的实例，供 reader / editor / classical 等包消费。
 */
import { createEventBus } from './events/event-bus.js';
import type { EventBus } from './events/event-bus.js';
import type { BibliotypeEventMap } from './events/event-map.js';
import { CORE_NODE_DEFINITIONS } from './node/core-definitions.js';
import { NodeTypeRegistry } from './node/node-registry.js';
import { PluginRegistry } from './plugin/registry.js';
import type { BibliotypeContext } from './plugin/types.js';
import { createThemeAccessor } from './theme/theme-accessor.js';
import type { ThemeAccessor } from './plugin/types.js';
import { DEFAULT_THEME } from './theme/default-theme.js';
import type { ThemeToken } from './theme/tokens.js';

/** 核心实例配置 */
export interface CoreInstanceOptions {
  /** 主题令牌覆盖（基于默认主题） */
  theme?: Partial<Record<ThemeToken, string>>;
}

/** bibliotype 核心实例 */
export interface BibliotypeInstance {
  /** 事件总线 */
  events: EventBus<BibliotypeEventMap>;
  /** 节点类型注册表（已预置 core 节点） */
  nodeTypes: NodeTypeRegistry;
  /** 主题访问器 */
  theme: ThemeAccessor;
  /** 插件注册表 */
  plugins: PluginRegistry;
  /** 组装好的插件上下文 */
  context: BibliotypeContext;
  /** 销毁实例（卸载全部插件、清空订阅） */
  dispose(): void;
}

/** 创建 bibliotype 核心实例 */
export function createBibliotype(
  options: CoreInstanceOptions = {},
): BibliotypeInstance {
  const events = createEventBus();
  const nodeTypes = new NodeTypeRegistry();
  // 预置核心现代书籍节点（古籍节点由 classical 插件后续注册，D8）
  nodeTypes.registerAll(CORE_NODE_DEFINITIONS);

  const theme = createThemeAccessor(options.theme ?? DEFAULT_THEME);

  const context: BibliotypeContext = { events, nodeTypes, theme };
  const plugins = new PluginRegistry(context);

  return {
    events,
    nodeTypes,
    theme,
    plugins,
    context,
    dispose(): void {
      plugins.disposeAll();
      events.clear();
    },
  };
}
