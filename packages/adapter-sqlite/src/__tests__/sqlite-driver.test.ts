import { describe, expect, it } from 'vitest';
import { SQLITE_SCHEMA_VERSION, ensureSchema } from '../schema.js';
import type { SqliteDriver } from '../driver.js';
import { createTestDatabase, scalar } from './helpers/sqljs.js';

describe('SqliteDriver / 迁移', () => {
  it('首次打开建表并写版本号，重复调用幂等', async () => {
    const { driver } = await createTestDatabase();
    await ensureSchema(driver);
    await ensureSchema(driver);

    expect(await scalar(driver, 'PRAGMA user_version')).toBe(SQLITE_SCHEMA_VERSION);
    const tables = await driver
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
      .all<{ name: string }>();
    const names = tables.map((table) => table.name);
    expect(names).toEqual(
      expect.arrayContaining(['assets', 'chunks', 'documents', 'settings', 'versions']),
    );
  });

  it('事务失败整体回滚，原数据保持可读', async () => {
    const { driver } = await createTestDatabase();
    await ensureSchema(driver);
    await driver.prepare('CREATE TABLE probe (id TEXT PRIMARY KEY, value TEXT)').run();
    await driver.prepare('INSERT INTO probe (id, value) VALUES (?, ?)').run(['keep', '原值']);

    await expect(
      driver.transaction(async (tx) => {
        await tx.prepare('UPDATE probe SET value = ? WHERE id = ?').run(['改过', 'keep']);
        await tx.prepare('INSERT INTO probe (id, value) VALUES (?, ?)').run(['new', '新值']);
        throw new Error('模拟写入失败');
      }),
    ).rejects.toThrow('模拟写入失败');

    const row = await driver.prepare('SELECT value FROM probe WHERE id = ?').get<{ value: string }>(['keep']);
    expect(row?.value).toBe('原值');
    expect(await scalar(driver, 'SELECT COUNT(*) AS n FROM probe')).toBe(1);
  });

  it('嵌套事务直接报错（避免内层提前提交）', async () => {
    const { driver } = await createTestDatabase();
    await ensureSchema(driver);

    await expect(
      driver.transaction(async (tx) => {
        await tx.transaction(async () => {
          /* 不应执行到这里 */
        });
      }),
    ).rejects.toThrow('不支持嵌套事务');
  });

  it('BLOB 读出为 Uint8Array', async () => {
    const { driver } = await createTestDatabase();
    await ensureSchema(driver);
    await driver
      .prepare('INSERT INTO assets (id, kind, media_type, name, byte_length, hash, data) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(['a1', 'image', 'image/png', null, 3, 'h', new Uint8Array([1, 2, 3])]);

    const row = await driver.prepare('SELECT data FROM assets WHERE id = ?').get<{ data: unknown }>(['a1']);
    expect(row?.data).toBeInstanceOf(Uint8Array);
    expect([...(row?.data as Uint8Array)]).toEqual([1, 2, 3]);
  });

  it('驱动端口可被包装：坏语句失败不影响后续操作', async () => {
    const { driver } = await createTestDatabase();
    await ensureSchema(driver);
    const failing: SqliteDriver = {
      ...driver,
      prepare(sql: string) {
        if (sql.includes('INSERT INTO settings')) {
          return {
            run: async () => {
              throw new Error('注入失败');
            },
            get: async () => undefined,
            all: async () => [],
          };
        }
        return driver.prepare(sql);
      },
      transaction: (run) => driver.transaction(async () => run(failing)),
    };

    await expect(failing.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(['k', 'v'])).rejects.toThrow(
      '注入失败',
    );
    await driver.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(['ok', '1']);
    expect(await scalar(driver, 'SELECT COUNT(*) AS n FROM settings')).toBe(1);
  });
});
