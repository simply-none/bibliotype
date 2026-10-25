/**
 * 宿主环境适配端口
 *
 * 通用代码（web / Electron 完全一致的源码）只依赖本文件的 `HostEnvironment`，
 * 不直接触碰 IndexedDB、localStorage 键名、Blob 下载或 IPC —— 这些环境差异由
 * `web.ts` / `electron.ts` 两个实现消化，复制到 Electron 项目时切换入口即可。
 *
 * 复制约定：
 * - `apps/demo/src/host/{types,web,index}.ts` 是 web 侧文件；
 * - `apps/demo/src/host/electron.ts` 复制到 Electron 项目的 `host/index.ts`（覆盖 web 入口）；
 * - 本文件两侧通用，改动需双向同步。
 */
import type { DocumentVersionStore, StorageAdapter, StyleSettingsStore } from '@bibliotype/core';

/** 书库存储组合（文档适配器 + 历史版本仓） */
export interface HostLibraryStores {
  /** 文档存储适配器（书库主数据） */
  adapter: StorageAdapter;
  /** 历史版本仓（快照记录） */
  versionStore: DocumentVersionStore;
}

/**
 * 宿主环境适配端口
 *
 * 通用代码与运行环境（web / Electron）之间唯一的接缝。
 */
export interface HostEnvironment {
  /** 存储链路名（设置面板「存储适配器」显示用，如 'indexeddb' / 'sqlite'） */
  readonly hostName: string;
  /**
   * 创建书库存储
   *
   * @returns 文档适配器 + 历史版本仓
   */
  createLibraryStores(): HostLibraryStores;
  /**
   * 创建编辑草稿存储适配器
   *
   * @returns 草稿文档存储（单条记录，键固定 'current'）
   */
  createDraftStore(): StorageAdapter;
  /**
   * 创建样式设置存储
   *
   * @returns 样式快照 / 预设存储（Web 走 IndexedDB 自动降级，Electron 走 SQLite）
   */
  createStyleSettingsStore(): StyleSettingsStore;
  /**
   * 下载二进制文件
   *
   * Web：浏览器下载（Blob + a[download]）；
   * Electron：写入宿主缓存目录并弹文件定位（不弹保存框）。
   *
   * @param bytes 文件字节
   * @param filename 文件名（含扩展名）
   */
  downloadBytes(bytes: Uint8Array, filename: string): void;
  /**
   * 下载文本文件
   *
   * @param text 文本内容
   * @param filename 文件名（含扩展名）
   * @param mime MIME 类型（可选，缺省 text/plain；浏览器侧用于 Blob type）
   */
  downloadText(text: string, filename: string, mime?: string): void;
  /**
   * 包装 localStorage 键
   *
   * Web 原样返回；Electron 加 `bt:` 前缀，避免与宿主自身键冲突。
   *
   * @param key 原始键
   * @returns 实际写入 localStorage 的键
   */
  storageKey(key: string): string;
}
