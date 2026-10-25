/**
 * Electron 宿主实现（复制到宿主项目的 `host/index.ts`）
 *
 * 自包含边界（硬约束）：只使用
 * - `window.ipcRenderer` 全局（宿主 preload 暴露的 contextBridge）；
 * - `@bibliotype/*` 已发包；
 * - Web 标准 API（btoa 等）。
 *
 * 禁止 import 宿主项目模块或 `@/` alias —— 保证 note_npm 侧 `vue-tsc` 可解析、复制即用。
 *
 * 依赖的主进程通道（见 `apps/demo/electron/main/module/bibliotype-store.ts`）：
 * - `bibliotype:sql-exec|run|get|all`：SQL 执行（参数 / 返回值结构化克隆）；
 * - `bibliotype:sql-tx-begin|commit|rollback`：单槽事务。
 * 文件导出复用宿主通用通道 `export-buffer-to-cache` / `export-text-to-cache`（sendSync）。
 */
import { SQLiteStyleStore, SqliteAdapter, SqliteVersionStore } from '@bibliotype/adapter-sqlite';
import type {
  SqlParams,
  SqliteDriver,
  SqliteRunResult,
  SqliteStatement,
} from '@bibliotype/adapter-sqlite';
import type { StorageAdapter, StyleSettingsStore } from '@bibliotype/core';
import type { ExportFileResult, HostEnvironment, HostLibraryStores } from './types.js';

export type { ExportFileResult, HostEnvironment, HostLibraryStores } from './types.js';

/** 桌面宿主 preload 暴露的 IPC 桥（只取本适配层用到的两个方法） */
interface DesktopIpcBridge {
  /** invoke 语义：异步调用主进程并等待返回 */
  handlePromise(channel: string, args?: unknown): Promise<unknown>;
  /** sendSync 语义：同步调用（导出落盘用） */
  sendSync(channel: string, args?: unknown): unknown;
}

/** 取宿主注入的 IPC 桥（浏览器 / 未暴露时返回 undefined） */
function getBridge(): DesktopIpcBridge | undefined {
  return (globalThis as unknown as { ipcRenderer?: DesktopIpcBridge }).ipcRenderer;
}

/** 调用主进程异步通道 */
async function invoke<T>(channel: string, args?: unknown): Promise<T> {
  const bridge = getBridge();
  if (bridge === undefined) {
    throw new Error(`桌面宿主 IPC 不可用（${channel}）`);
  }
  return (await bridge.handlePromise(channel, args)) as T;
}

/**
 * 调用主进程同步通道（导出落盘）
 *
 * 主进程 `export-*-to-cache` 返回 `{ success, path?, message? }`；本函数把它归一为
 * `ExportFileResult`，让上层能提示真实失败原因与实际落盘路径（不再静默吞掉）。
 *
 * @param channel 主进程通道名
 * @param args 通道参数
 * @returns 导出结果（IPC 不可用 / 写入失败时 `ok = false`）
 */
function invokeSync(channel: string, args: unknown): ExportFileResult {
  const bridge = getBridge();
  if (bridge === undefined) {
    return { ok: false, error: `桌面宿主 IPC 不可用（${channel}）` };
  }
  const result = bridge.sendSync(channel, args) as
    | { success?: boolean; path?: string; message?: string; error?: string }
    | undefined;
  if (result?.success === true) {
    return { ok: true, path: result.path };
  }
  return { ok: false, error: result?.message ?? result?.error ?? '写入文件失败' };
}

/**
 * 渲染端 IPC SQLite 驱动
 *
 * 把 SQL 执行转发到主进程（sqlite3 回调式引擎），保持 `SqliteDriver` 的异步端口语义；
 * 事务为单槽：嵌套直接抛错，与内置驱动一致。
 */
class IpcSqliteDriver implements SqliteDriver {
  /** 驱动名称（诊断用） */
  readonly name = 'electron-ipc-sqlite';

  /** 是否已有事务在进行（主进程同样只允许单槽） */
  private inTransaction = false;

  /** 执行无结果语句（DDL / PRAGMA） */
  async exec(sql: string): Promise<void> {
    await invoke<void>('bibliotype:sql-exec', { sql });
  }

  /** 预编译语句（每次调用都经 IPC 转发，不做本地缓存） */
  prepare(sql: string): SqliteStatement {
    return {
      run: async (params?: SqlParams): Promise<SqliteRunResult> => {
        const result = await invoke<SqliteRunResult | undefined>('bibliotype:sql-run', {
          sql,
          params,
        });
        return result ?? { changes: 0 };
      },
      get: async <T = Record<string, unknown>>(params?: SqlParams): Promise<T | undefined> => {
        const row = await invoke<T | null | undefined>('bibliotype:sql-get', { sql, params });
        return row ?? undefined;
      },
      all: async <T = Record<string, unknown>>(params?: SqlParams): Promise<T[]> => {
        const rows = await invoke<T[] | undefined>('bibliotype:sql-all', { sql, params });
        return rows ?? [];
      },
    };
  }

  /** 事务：BEGIN → 回调 → COMMIT / ROLLBACK */
  async transaction(run: (tx: SqliteDriver) => Promise<void>): Promise<void> {
    if (this.inTransaction) {
      throw new Error('SqliteDriver 不支持嵌套事务：请把多次写入合并到同一个 transaction 回调。');
    }
    this.inTransaction = true;
    await invoke<void>('bibliotype:sql-tx-begin');
    try {
      await run(this);
      await invoke<void>('bibliotype:sql-tx-commit');
    } catch (error) {
      try {
        await invoke<void>('bibliotype:sql-tx-rollback');
      } catch {
        /* 回滚失败时保留原始错误，避免掩盖真实原因 */
      }
      throw error;
    } finally {
      this.inTransaction = false;
    }
  }

  /** 连接生命周期归主进程，渲染端不关闭 */
  async close(): Promise<void> {
    /* 无需释放 */
  }
}

/** 渲染端共享的单例驱动（书库 / 草稿 / 样式共用同一连接） */
let sharedDriver: IpcSqliteDriver | undefined;

/** 取共享驱动（惰性创建） */
function getSharedDriver(): SqliteDriver {
  sharedDriver ??= new IpcSqliteDriver();
  return sharedDriver;
}

/** Uint8Array → base64（分块拼接，避免超长参数列表爆栈） */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

/** Electron 宿主实现（宿主项目内的 `host/index.ts`） */
export const host: HostEnvironment = {
  hostName: 'sqlite',
  isDesktop: true,

  /** 书库：SQLite 文档适配器 + SQLite 版本仓（同一驱动 / 同一库文件） */
  createLibraryStores(): HostLibraryStores {
    const driver = getSharedDriver();
    return {
      adapter: new SqliteAdapter({ driver }),
      versionStore: new SqliteVersionStore({ driver }),
    };
  },

  /** 草稿：复用同一 SQLite 库（表结构隔离由文档 id 前缀保证） */
  createDraftStore(): StorageAdapter {
    return new SqliteAdapter({ driver: getSharedDriver() });
  },

  /** 样式设置：SQLite `settings` 表 KV，不新增表 */
  createStyleSettingsStore(): StyleSettingsStore {
    return new SQLiteStyleStore({ driver: getSharedDriver() });
  },

  /** 二进制下载：base64 → 宿主缓存目录（主进程落盘并返回路径） */
  downloadBytes(bytes: Uint8Array, filename: string): ExportFileResult {
    return invokeSync('export-buffer-to-cache', {
      base64: bytesToBase64(bytes),
      filename,
    });
  },

  /** 文本下载：直接写宿主缓存目录（返回实际路径） */
  downloadText(text: string, filename: string): ExportFileResult {
    return invokeSync('export-text-to-cache', { text, filename });
  },

  /** localStorage 键：加 `bt:` 前缀，避免与宿主自身键冲突 */
  storageKey(key: string): string {
    return `bt:${key}`;
  },
};
