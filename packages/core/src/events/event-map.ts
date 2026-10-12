/**
 * 核心事件映射定义
 *
 * 事件名采用 `领域:动作` 命名约定（如 document:load）。
 * 插件可通过声明合并（declaration merging）扩展此接口，
 * 从而获得完整的类型推导：
 *
 * ```ts
 * declare module '@bibliotype/core' {
 *   interface BibliotypeEventMap {
 *     'classical:register': { nodeCount: number };
 *   }
 * }
 * ```
 */
import type { BookDocument } from '../ir/document.js';

/** 核心事件映射（键为事件名，值为载荷类型） */
export interface BibliotypeEventMap {
  /** 文档加载完成 */
  'document:load': { document: BookDocument };
  /** 文档已保存（Storage Adapter 完成写入后触发） */
  'document:save': { documentId: string };
  /** 元数据变更 */
  'document:meta-change': { changedKeys: string[] };

  /** 页面切换（翻页/滚动定位） */
  'page:change': { pageIndex: number; totalPages: number };
  /** 渲染完成（一屏或一页的布局结束） */
  'render:complete': { durationMs: number };

  /** 目录生成完成 */
  'toc:ready': { itemCount: number };

  /** 协同远端更新（D6） */
  'collab:remote-update': { update: Uint8Array };

  /** 插件安装完成 */
  'plugin:installed': { name: string; version?: string };
}

/** 事件名联合类型 */
export type BibliotypeEventName = keyof BibliotypeEventMap;
