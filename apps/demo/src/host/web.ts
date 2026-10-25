/**
 * Web 宿主实现（缺省）
 *
 * 把 demo 改造前的浏览器行为原样搬迁到这里：
 * - 书库 / 草稿走 IndexedDB，样式设置走 `createStyleStore()`（IndexedDB → localStorage → 内存降级）；
 * - 下载走 Blob + `a[download]`；
 * - localStorage 键不加前缀。
 *
 * `index.ts` 即 `export * from './web.js'`，因此 web demo 行为与改造前完全一致。
 */
import { IndexedDbAdapter, IndexedDbVersionStore, createStyleStore } from '@bibliotype/adapter-indexeddb';
import type { StorageAdapter, StyleSettingsStore } from '@bibliotype/core';
import type { ExportFileResult, HostEnvironment, HostLibraryStores } from './types.js';

export type { ExportFileResult, HostEnvironment, HostLibraryStores } from './types.js';

/** 书库库名 / 仓名（与改造前一致） */
const LIBRARY_DB = 'bibliotype-demo-library';
const LIBRARY_STORE = 'books';
/** 草稿库名 / 仓名（与改造前一致） */
const DRAFT_DB = 'bibliotype-demo';
const DRAFT_STORE = 'drafts';

/**
 * 触发浏览器下载
 *
 * @param blob 已构造好的 Blob
 * @param filename 文件名（含扩展名）
 */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Web 宿主实现（浏览器缺省链路） */
export const host: HostEnvironment = {
  hostName: 'indexeddb',
  isDesktop: false,

  /** 书库：IndexedDB 文档适配器 + IndexedDB 版本仓 */
  createLibraryStores(): HostLibraryStores {
    return {
      adapter: new IndexedDbAdapter({ databaseName: LIBRARY_DB, storeName: LIBRARY_STORE }),
      versionStore: new IndexedDbVersionStore(),
    };
  },

  /** 草稿：独立 IndexedDB 库，避免与正式文档库互相牵连 */
  createDraftStore(): StorageAdapter {
    return new IndexedDbAdapter({ databaseName: DRAFT_DB, storeName: DRAFT_STORE });
  },

  /** 样式设置：沿用 IndexedDB → localStorage → 内存的自动降级 */
  createStyleSettingsStore(): StyleSettingsStore {
    return createStyleStore();
  },

  /** 二进制下载：Blob + a[download]（浏览器无落盘路径，返回成功即可） */
  downloadBytes(bytes: Uint8Array, filename: string): ExportFileResult {
    downloadBlob(new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' }), filename);
    return { ok: true };
  },

  /** 文本下载：Blob（按需指定 MIME） */
  downloadText(text: string, filename: string, mime: string = 'text/plain'): ExportFileResult {
    downloadBlob(new Blob([text], { type: `${mime};charset=utf-8` }), filename);
    return { ok: true };
  },

  /** localStorage 键：web 侧原样返回 */
  storageKey(key: string): string {
    return key;
  },
};
