/**
 * bibliotype 主进程 SQLite 执行器（复制到宿主 `electron/main/module/bibliotype-store.ts`）
 * ------------------------------------------------------------------
 * 归属：note_npm 仓库 `apps/demo/electron/main/module/`（web 构建不包含本目录）。
 *
 * 职责：为渲染端 `apps/demo/src/host/electron.ts` 的 IPC 驱动提供真实 SQLite 连接，
 * 承载书库 / 草稿 / 历史版本 / 样式设置四类数据的落盘。
 *
 * 设计约束：
 * - **无 schema、无业务逻辑**：建表与迁移由渲染端的 `@bibliotype/adapter-sqlite`
 *   `ensureSchema` 经 `bibliotype:sql-exec` 执行，本模块只做语句转发；
 * - 单连接 + 串行执行：sqlite3 默认串行队列，与适配器的单写模型一致；
 * - 事务单槽：`BEGIN IMMEDIATE / COMMIT / ROLLBACK`，嵌套直接报错；悬挂事务
 *   超时自动回滚（渲染端崩溃不会把库永久锁在写事务里）；
 * - 参数 / 返回值走结构化克隆：BLOB 在两侧统一表示为 `Uint8Array`（主进程内部转 Buffer）。
 *
 * IPC 通道（与渲染端 host 严格对应）：
 *   bibliotype:sql-exec  { sql }             → void
 *   bibliotype:sql-run   { sql, params? }    → { changes }
 *   bibliotype:sql-get   { sql, params? }    → row | null
 *   bibliotype:sql-all   { sql, params? }    → row[]
 *   bibliotype:sql-tx-begin / commit / rollback → void
 *
 * 接线方式：宿主主进程入口调用一次 `initBibliotypeStore()`（改动后需重启主进程）。
 * 库文件缺省为 `<userData>/bibliotype.db`；宿主可传 `dir` / `fileName` 放到自己的数据目录
 * （如与主库 db.sqlite 同级并加宿主前缀）。
 */
import { app, ipcMain } from 'electron';
import defaultSqlite3 from 'sqlite3';
import type { Database } from 'sqlite3';
import fs from 'node:fs';
import path from 'node:path';

/** 缺省数据库文件名（放在宿主 userData 目录） */
const DB_FILE_NAME = 'bibliotype.db';

/** 库文件所在目录（init 时可覆盖；undefined 表示缺省 userData） */
let dbDir: string | undefined;

/** 库文件名（init 时可覆盖） */
let dbFileName = DB_FILE_NAME;

/** 悬挂事务回收阈值（ms）：渲染端崩溃 / 未提交时强制回滚，避免写锁常驻 */
const TX_TIMEOUT_MS = 30_000;

/** 全局连接（懒打开） */
let db: Database | null = null;

/** 事务是否在进行中（单槽） */
let txActive = false;

/** 悬挂事务回收定时器 */
let txTimer: ReturnType<typeof setTimeout> | undefined;

/** 是否已注册 IPC（重复调用 init 时直接返回） */
let registered = false;

/** 渲染端传入的参数值（结构化克隆安全类型） */
type WireValue = string | number | null | Uint8Array;

/** 绑定参数：位置数组或命名对象 */
type WireParams = readonly WireValue[] | Record<string, WireValue>;

/**
 * 初始化选项：宿主可把库文件放到自己的数据目录
 *
 * 不传时沿用缺省；宿主侧通常传入与主库同级的目录并加前缀文件名，便于统一备份 / 定位。
 */
export interface BibliotypeStoreOptions {
  /** 库文件所在目录（缺省 `app.getPath('userData')`） */
  dir?: string;
  /** 库文件名（缺省 `bibliotype.db`） */
  fileName?: string;
}

/**
 * 把渲染端参数转换为 sqlite3 可绑定的值
 *
 * BLOB 的 `Uint8Array` 在 sqlite3 中需转成 `Buffer` 才能正确写入。
 *
 * @param params 渲染端参数（可选）
 * @returns sqlite3 绑定参数（数组或对象）
 */
function toBindParams(params: WireParams | undefined): unknown[] | Record<string, unknown> {
  const convert = (value: WireValue): unknown => (value instanceof Uint8Array ? Buffer.from(value) : value);
  if (params === undefined) return [];
  if (Array.isArray(params)) {
    return params.map(convert);
  }
  const record: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    record[key] = convert(value);
  }
  return record;
}

/**
 * 把查询行转换为结构化克隆友好的纯对象
 *
 * sqlite3 的 BLOB 返回 Buffer；转 `Uint8Array` 后渲染端可直接还原为字节。
 *
 * @param row 查询结果行（可选）
 * @returns 归一化后的行对象；无结果返回 null
 */
function normalizeRow(row: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (row === undefined || row === null) return null;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    result[key] = Buffer.isBuffer(value) ? new Uint8Array(value) : value;
  }
  return result;
}

/** 数据库文件绝对路径（目录 / 文件名可由宿主在 init 时覆盖） */
function dbFilePath(): string {
  return path.join(dbDir ?? app.getPath('userData'), dbFileName);
}

/**
 * 打开数据库连接（幂等）
 *
 * WAL 模式提升读写并发；`serialize()` 保证同一连接上的语句按提交顺序执行。
 *
 * @returns sqlite3 数据库实例
 * @throws 目录不可写 / 打开失败时抛出原始错误
 */
function ensureDatabase(): Database {
  if (db !== null) return db;
  const file = dbFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const instance = new defaultSqlite3.Database(file);
  instance.serialize();
  instance.run('PRAGMA journal_mode = WAL');
  instance.run('PRAGMA busy_timeout = 5000');
  db = instance;
  return instance;
}

/**
 * 执行无结果语句（DDL / PRAGMA）
 *
 * @param sql SQL 语句（单条；多条请拆开逐条发送）
 * @returns 执行完成
 * @throws SQL 执行失败时抛出原始错误
 */
function exec(sql: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    ensureDatabase().exec(sql, (error) => (error ? reject(error) : resolve()));
  });
}

/**
 * 执行写语句
 *
 * @param sql SQL 语句
 * @param params 绑定参数（可选）
 * @returns 受影响行数
 * @throws SQL 执行失败时抛出原始错误
 */
function run(sql: string, params: WireParams | undefined): Promise<{ changes: number }> {
  return new Promise<{ changes: number }>((resolve, reject) => {
    ensureDatabase().run(sql, toBindParams(params), function onDone(error) {
      /* 回调内 this 为 sqlite3 的 Statement：changes 为受影响行数 */
      if (error) reject(error);
      else resolve({ changes: this.changes ?? 0 });
    });
  });
}

/**
 * 取首行
 *
 * @param sql SQL 语句
 * @param params 绑定参数（可选）
 * @returns 首行对象；无结果返回 null
 * @throws SQL 执行失败时抛出原始错误
 */
function get(
  sql: string,
  params: WireParams | undefined,
): Promise<Record<string, unknown> | null> {
  return new Promise<Record<string, unknown> | null>((resolve, reject) => {
    ensureDatabase().get(sql, toBindParams(params), (error, row) => {
      if (error) reject(error);
      else resolve(normalizeRow(row as Record<string, unknown> | undefined));
    });
  });
}

/**
 * 取全部行
 *
 * @param sql SQL 语句
 * @param params 绑定参数（可选）
 * @returns 行对象数组；无结果返回空数组
 * @throws SQL 执行失败时抛出原始错误
 */
function all(sql: string, params: WireParams | undefined): Promise<Record<string, unknown>[]> {
  return new Promise<Record<string, unknown>[]>((resolve, reject) => {
    ensureDatabase().all(sql, toBindParams(params), (error, rows) => {
      if (error) return reject(error);
      const list = (rows ?? []) as Record<string, unknown>[];
      resolve(list.map((row) => normalizeRow(row) ?? {}));
    });
  });
}

/** 清理悬挂事务定时器 */
function clearTxTimer(): void {
  if (txTimer !== undefined) {
    clearTimeout(txTimer);
    txTimer = undefined;
  }
}

/** 开始事务（单槽；嵌套直接报错） */
async function beginTransaction(): Promise<void> {
  if (txActive) {
    throw new Error('bibliotype-store：已有进行中的事务，不支持嵌套。');
  }
  await exec('BEGIN IMMEDIATE');
  txActive = true;
  clearTxTimer();
  txTimer = setTimeout(() => {
    void rollbackTransaction().catch(() => undefined);
  }, TX_TIMEOUT_MS);
}

/** 提交事务 */
async function commitTransaction(): Promise<void> {
  if (!txActive) {
    throw new Error('bibliotype-store：没有进行中的事务，无法提交。');
  }
  clearTxTimer();
  try {
    await exec('COMMIT');
  } finally {
    txActive = false;
  }
}

/** 回滚事务（无进行中事务时静默返回） */
async function rollbackTransaction(): Promise<void> {
  if (!txActive) return;
  clearTxTimer();
  try {
    await exec('ROLLBACK');
  } finally {
    txActive = false;
  }
}

/**
 * 注册 IPC 通道（幂等）
 *
 * 在宿主主进程入口调用一次；主窗口与独立工作台窗口共用同一连接。
 *
 * @param options 库文件目录 / 文件名覆盖（可选）
 * @returns 无
 */
export function initBibliotypeStore(options: BibliotypeStoreOptions = {}): void {
  if (registered) return;
  dbDir = options.dir;
  dbFileName = options.fileName ?? DB_FILE_NAME;
  registered = true;

  ipcMain.handle('bibliotype:sql-exec', async (_event, args: { sql: string }) => {
    await exec(args.sql);
  });

  ipcMain.handle(
    'bibliotype:sql-run',
    async (_event, args: { sql: string; params?: WireParams }) =>
      run(args.sql, args.params),
  );

  ipcMain.handle(
    'bibliotype:sql-get',
    async (_event, args: { sql: string; params?: WireParams }) =>
      get(args.sql, args.params),
  );

  ipcMain.handle(
    'bibliotype:sql-all',
    async (_event, args: { sql: string; params?: WireParams }) =>
      all(args.sql, args.params),
  );

  ipcMain.handle('bibliotype:sql-tx-begin', async () => beginTransaction());
  ipcMain.handle('bibliotype:sql-tx-commit', async () => commitTransaction());
  ipcMain.handle('bibliotype:sql-tx-rollback', async () => rollbackTransaction());
}
