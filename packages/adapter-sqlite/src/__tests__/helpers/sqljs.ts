/**
 * 测试用 sql.js 驱动工厂
 *
 * sql.js 是 devDependency：生产包不依赖任何 SQLite 引擎，
 * 但测试需要真实 SQL 与 BLOB 行为，因此这里用 WASM 版本建内存库。
 */
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { createSqlJsDriver, type SqliteDriver } from '../../driver.js';

/** 模块级缓存：WASM 只加载一次 */
let sqlPromise: Promise<SqlJsStatic> | undefined;

/** 加载 sql.js（WASM 从包的 dist 目录读取） */
async function loadSqlJs(): Promise<SqlJsStatic> {
  sqlPromise ??= initSqlJs({
    locateFile: (file: string) => `node_modules/sql.js/dist/${file}`,
  });
  return sqlPromise;
}

/** 测试驱动句柄 */
export interface TestDatabase {
  /** 异步驱动端口 */
  driver: SqliteDriver;
  /** 原始 sql.js 数据库（断言表结构 / 行数用） */
  db: Database;
}

/** 建一个独立的内存库与驱动 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const SQL = await loadSqlJs();
  const db = new SQL.Database();
  return { driver: createSqlJsDriver(db), db };
}

/** 只取驱动（大多数用例不需要原始 db） */
export async function createTestDriver(): Promise<SqliteDriver> {
  return (await createTestDatabase()).driver;
}

/** 查询单值（测试断言专用） */
export async function scalar(driver: SqliteDriver, sql: string, params?: readonly (string | number | null | Uint8Array)[]): Promise<unknown> {
  const row = await driver.prepare(sql).get<Record<string, unknown>>(params);
  if (row === undefined) return undefined;
  const values = Object.values(row);
  return values[0];
}
