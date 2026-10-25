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
 * 文件导出结果
 *
 * Web 侧走浏览器下载，无绝对路径（`path` 缺省）；Electron 侧由主进程落盘并回传路径。
 */
export interface ExportFileResult {
  /** 是否成功 */
  ok: boolean;
  /** 落盘绝对路径（Electron 专用；Web 缺省） */
  path?: string;
  /** 失败原因（Web 侧通常为空） */
  error?: string;
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
   * 是否桌面宿主（导出 / 能力分支的唯一判别式）
   *
   * 通用代码据此分叉：`true` 走主进程落盘 / 打印引擎，`false` 走浏览器下载与打印。
   */
  readonly isDesktop: boolean;
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
   * Electron：写入宿主缓存目录并返回实际路径（不弹保存框）。
   *
   * @param bytes 文件字节
   * @param filename 文件名（含扩展名）
   * @returns 导出结果（Electron 含落盘路径；失败含原因）
   */
  downloadBytes(bytes: Uint8Array, filename: string): ExportFileResult;
  /**
   * 下载文本文件
   *
   * @param text 文本内容
   * @param filename 文件名（含扩展名）
   * @param mime MIME 类型（可选，缺省 text/plain；浏览器侧用于 Blob type）
   * @returns 导出结果（Electron 含落盘路径；失败含原因）
   */
  downloadText(text: string, filename: string, mime?: string): ExportFileResult;
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
