/**
 * 插件接口定义
 *
 * 插件是 bibliotype 的扩展单元：
 * - install 时获得 BibliotypeContext（事件总线、节点注册表、主题等）；
 * - 可返回 dispose 函数用于卸载清理；
 * - classical / collab / exporter 等包均以插件形式提供能力。
 */
import type { EventBus } from '../events/event-bus.js';
import type { BibliotypeEventMap } from '../events/event-map.js';
import type { NodeTypeRegistry } from '../node/node-registry.js';

/** 插件安装上下文（由宿主在 install 时注入） */
export interface BibliotypeContext {
  /** 核心事件总线 */
  events: EventBus<BibliotypeEventMap>;
  /** 节点类型注册表 */
  nodeTypes: NodeTypeRegistry;
  /** 主题令牌读写（键值对，具体令牌见 theme/tokens） */
  theme: ThemeAccessor;
}

/** 主题访问器（读写分离，便于插件只读消费或定制覆盖） */
export interface ThemeAccessor {
  /** 读取令牌值 */
  get(token: string): string | undefined;
  /** 覆盖令牌值（返回还原函数） */
  set(token: string, value: string): () => void;
  /** 批量读取全部令牌 */
  all(): Readonly<Record<string, string>>;
}

/** 插件接口 */
export interface BibliotypePlugin {
  /** 插件名（唯一，建议与包名对应，如 "@bibliotype/classical"） */
  name: string;
  /** 插件版本（语义化版本号） */
  version?: string;
  /** 说明 */
  description?: string;
  /**
   * 安装插件
   *
   * @returns 可选的清理函数；宿主在卸载插件或销毁实例时调用。
   */
  install(context: BibliotypeContext): void | (() => void);
}

/** 定义插件的辅助函数（提供类型推导，无运行时开销） */
export function definePlugin(plugin: BibliotypePlugin): BibliotypePlugin {
  return plugin;
}
