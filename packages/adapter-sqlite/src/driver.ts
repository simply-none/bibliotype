/**
 * SQLite 驱动端口（H2）
 *
 * 适配器**不安装、不打包**任何 SQLite 引擎：宿主传入自己安装的驱动实例
 * （Electron 主进程的 better-sqlite3、浏览器的 sql.js、或自建 worker 封装）。
 *
 * 这里只做「同步引擎 → 异步端口」的薄适配：
 * - `createBetterSqliteDriver(db)`：接受 better-sqlite3 的 `Database`（变参绑定）；
 * - `createSqlJsDriver(db)`：接受 sql.js 的 `Database`（`bind / step / getAsObject`）；
 * - 两个工厂都只用鸭子类型，运行时不 import 引擎包。
 *
 * 事务：`BEGIN IMMEDIATE / COMMIT / ROLLBACK`，不支持嵌套（嵌套直接抛错，
 * 避免内层 COMMIT 把外层事务提前提交）。
 */

/** 可绑定的 SQL 值（布尔请由调用方转 0 / 1） */
export type SqlValue = string | number | null | Uint8Array;

/** 绑定参数：位置参数数组或命名参数对象 */
export type SqlParams = readonly SqlValue[] | Record<string, SqlValue>;

/** 写语句结果 */
export interface SqliteRunResult {
  /** 受影响行数（引擎不支持时为 0） */
  changes: number;
}

/** 预编译语句（异步门面） */
export interface SqliteStatement {
  /** 执行写语句 */
  run(params?: SqlParams): Promise<SqliteRunResult>;
  /** 取首行（无结果返回 undefined） */
  get<T = Record<string, unknown>>(params?: SqlParams): Promise<T | undefined>;
  /** 取全部行 */
  all<T = Record<string, unknown>>(params?: SqlParams): Promise<T[]>;
}

/** SQLite 驱动端口 */
export interface SqliteDriver {
  /** 驱动名称（诊断用，如 `better-sqlite3` / `sql.js`） */
  readonly name: string;
  /** 执行无结果语句（DDL / PRAGMA） */
  exec(sql: string): Promise<void>;
  /** 预编译语句 */
  prepare(sql: string): SqliteStatement;
  /** 事务（回调内的所有写操作整体提交 / 回滚） */
  transaction(run: (tx: SqliteDriver) => Promise<void>): Promise<void>;
  /** 关闭底层连接（生命周期归宿主，适配器不会调用） */
  close(): Promise<void>;
}

/**
 * 同步引擎门面
 *
 * 各引擎的差异（变参 vs bind/step）在上面的工厂里消化，
 * 适配器只面对这四个同步方法。
 */
interface SyncEngine {
  exec(sql: string): void;
  run(sql: string, params?: SqlParams): number;
  get(sql: string, params?: SqlParams): Record<string, unknown> | undefined;
  all(sql: string, params?: SqlParams): Record<string, unknown>[];
  close(): void;
}

/** 把未知结果收敛为行对象 */
function asRow(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  return value as Record<string, unknown>;
}

/** 把同步引擎包装为异步端口 */
function createDriver(name: string, engine: SyncEngine): SqliteDriver {
  let inTransaction = false;

  const driver: SqliteDriver = {
    name,
    async exec(sql: string): Promise<void> {
      engine.exec(sql);
    },
    prepare(sql: string): SqliteStatement {
      return {
        async run(params?: SqlParams): Promise<SqliteRunResult> {
          return { changes: engine.run(sql, params) };
        },
        async get<T = Record<string, unknown>>(params?: SqlParams): Promise<T | undefined> {
          return engine.get(sql, params) as T | undefined;
        },
        async all<T = Record<string, unknown>>(params?: SqlParams): Promise<T[]> {
          return engine.all(sql, params) as T[];
        },
      };
    },
    async transaction(run: (tx: SqliteDriver) => Promise<void>): Promise<void> {
      if (inTransaction) {
        throw new Error('SqliteDriver 不支持嵌套事务：请把多次写入合并到同一个 transaction 回调。');
      }
      inTransaction = true;
      await engine.exec('BEGIN IMMEDIATE');
      try {
        await run(driver);
        await engine.exec('COMMIT');
      } catch (error) {
        try {
          await engine.exec('ROLLBACK');
        } catch {
          /* 回滚失败时保留原始错误，避免掩盖真实原因 */
        }
        throw error;
      } finally {
        inTransaction = false;
      }
    },
    async close(): Promise<void> {
      engine.close();
    },
  };

  return driver;
}

/* ---------- better-sqlite3 形态 ---------- */

/** better-sqlite3 语句的最小接口 */
export interface BetterSqliteStatementLike {
  run(...params: unknown[]): { changes?: number } | undefined;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

/** better-sqlite3 数据库的最小接口 */
export interface BetterSqliteDatabaseLike {
  exec(sql: string): unknown;
  prepare(sql: string): BetterSqliteStatementLike;
  close?(): unknown;
}

/** 把绑定参数展开为 better-sqlite3 的变参形式 */
function spreadParams(params: SqlParams | undefined): unknown[] {
  if (params === undefined) return [];
  if (Array.isArray(params)) return [...params];
  return [params];
}

/**
 * 包装 better-sqlite3 的 `Database`
 *
 * @example
 * ```ts
 * import Database from 'better-sqlite3';
 * const driver = createBetterSqliteDriver(new Database('book.db'));
 * ```
 */
export function createBetterSqliteDriver(database: BetterSqliteDatabaseLike): SqliteDriver {
  const engine: SyncEngine = {
    exec(sql: string): void {
      database.exec(sql);
    },
    run(sql: string, params?: SqlParams): number {
      const statement = database.prepare(sql);
      const info = statement.run(...spreadParams(params));
      return typeof info?.changes === 'number' ? info.changes : 0;
    },
    get(sql: string, params?: SqlParams): Record<string, unknown> | undefined {
      const statement = database.prepare(sql);
      return asRow(statement.get(...spreadParams(params)));
    },
    all(sql: string, params?: SqlParams): Record<string, unknown>[] {
      const statement = database.prepare(sql);
      return statement
        .all(...spreadParams(params))
        .map((row) => asRow(row))
        .filter((row): row is Record<string, unknown> => row !== undefined);
    },
    close(): void {
      database.close?.();
    },
  };
  return createDriver('better-sqlite3', engine);
}

/* ---------- sql.js 形态 ---------- */

/** sql.js 语句的最小接口 */
export interface SqlJsStatementLike {
  /* 绑定参数用宽类型：sql.js 的 BindParams 是数组 / 命名对象两种形态 */
  bind(params?: unknown): boolean;
  step(): boolean;
  getAsObject(): Record<string, unknown>;
  free(): boolean;
}

/** sql.js 数据库的最小接口 */
export interface SqlJsDatabaseLike {
  exec(sql: string): unknown;
  prepare(sql: string): SqlJsStatementLike;
  getRowsModified(): number;
  close?(): void;
}

/** sql.js 的命名参数需要 `$` / `:` / `@` 前缀，这里原样透传 */
function sqlJsParams(params: SqlParams | undefined): unknown[] | Record<string, unknown> | undefined {
  if (params === undefined) return undefined;
  if (Array.isArray(params)) return [...(params as readonly SqlValue[])];
  return params as Record<string, unknown>;
}

/**
 * 包装 sql.js 的 `Database`（浏览器 / 测试用 WASM 引擎）
 *
 * @example
 * ```ts
 * const SQL = await initSqlJs();
 * const driver = createSqlJsDriver(new SQL.Database());
 * ```
 */
export function createSqlJsDriver(database: SqlJsDatabaseLike): SqliteDriver {
  const engine: SyncEngine = {
    exec(sql: string): void {
      database.exec(sql);
    },
    run(sql: string, params?: SqlParams): number {
      const statement = database.prepare(sql);
      try {
        const bound = sqlJsParams(params);
        if (bound !== undefined) statement.bind(bound);
        statement.step();
        return database.getRowsModified();
      } finally {
        statement.free();
      }
    },
    get(sql: string, params?: SqlParams): Record<string, unknown> | undefined {
      const statement = database.prepare(sql);
      try {
        const bound = sqlJsParams(params);
        if (bound !== undefined) statement.bind(bound);
        if (!statement.step()) return undefined;
        return statement.getAsObject();
      } finally {
        statement.free();
      }
    },
    all(sql: string, params?: SqlParams): Record<string, unknown>[] {
      const statement = database.prepare(sql);
      const rows: Record<string, unknown>[] = [];
      try {
        const bound = sqlJsParams(params);
        if (bound !== undefined) statement.bind(bound);
        while (statement.step()) {
          rows.push(statement.getAsObject());
        }
        return rows;
      } finally {
        statement.free();
      }
    },
    close(): void {
      database.close?.();
    },
  };
  return createDriver('sql.js', engine);
}
