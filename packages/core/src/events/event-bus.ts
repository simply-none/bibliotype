/**
 * 类型化事件总线
 *
 * 轻量、零依赖的发布/订阅实现：
 * - 键与载荷类型均从事件映射推导，杜绝拼写错误；
 * - 订阅返回解除订阅函数（符合 dispose 惯用法）；
 * - 触发时对处理器做快照，允许处理器内部退订。
 */
import type { BibliotypeEventMap } from './event-map.js';

/** 事件处理器 */
export type EventHandler<T> = (payload: T) => void;

/** 解除订阅函数 */
export type Unsubscribe = () => void;

/** 类型化事件总线 */
export class EventBus<Map extends object> {
  private readonly handlers = new Map<keyof Map, Set<EventHandler<never>>>();

  /** 订阅事件，返回解除订阅函数 */
  on<K extends keyof Map>(type: K, handler: EventHandler<Map[K]>): Unsubscribe {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as EventHandler<never>);
    return () => this.off(type, handler);
  }

  /** 订阅事件（仅触发一次，触发后自动解除） */
  once<K extends keyof Map>(type: K, handler: EventHandler<Map[K]>): Unsubscribe {
    const unsubscribe = this.on(type, (payload) => {
      unsubscribe();
      handler(payload);
    });
    return unsubscribe;
  }

  /** 解除某个处理器的订阅 */
  off<K extends keyof Map>(type: K, handler: EventHandler<Map[K]>): void {
    const set = this.handlers.get(type);
    if (!set) return;
    set.delete(handler as EventHandler<never>);
    if (set.size === 0) {
      this.handlers.delete(type);
    }
  }

  /** 触发事件（对处理器集合做快照，允许回调中退订） */
  emit<K extends keyof Map>(type: K, payload: Map[K]): void {
    const set = this.handlers.get(type);
    if (!set || set.size === 0) return;
    const snapshot = [...set];
    for (const handler of snapshot) {
      (handler as EventHandler<Map[K]>)(payload);
    }
  }

  /** 是否存在某事件的订阅者 */
  hasListeners<K extends keyof Map>(type: K): boolean {
    return (this.handlers.get(type)?.size ?? 0) > 0;
  }

  /** 清空全部订阅（按事件或整体） */
  clear<K extends keyof Map>(type?: K): void {
    if (type === undefined) {
      this.handlers.clear();
    } else {
      this.handlers.delete(type);
    }
  }
}

/** 创建核心事件总线实例 */
export function createEventBus(): EventBus<BibliotypeEventMap> {
  return new EventBus<BibliotypeEventMap>();
}
