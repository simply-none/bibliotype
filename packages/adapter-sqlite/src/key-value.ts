/**
 * SQLite 小载荷 KV（H2）
 *
 * `settings` 表上的字符串键值：样式快照、界面偏好等小对象由宿主
 * `JSON.stringify` 后存入，避免为每个设置项单独建表。
 */
import type { SqliteDriver } from './driver.js';
import { ensureSchema } from './schema.js';

/** KV 选项 */
export interface SqliteKeyValueStoreOptions {
  /** 宿主注入的驱动 */
  driver: SqliteDriver;
}

/** `settings` 行 */
interface SettingRow {
  value: string;
}

/** SQLite KV 存储 */
export class SqliteKeyValueStore {
  readonly name = 'sqlite-settings';

  private readonly driver: SqliteDriver;

  constructor(options: SqliteKeyValueStoreOptions) {
    this.driver = options.driver;
  }

  /** 读取字符串值（未命中返回 undefined） */
  async get(key: string): Promise<string | undefined> {
    await ensureSchema(this.driver);
    const row = await this.driver
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get<SettingRow>([key]);
    return row?.value;
  }

  /** 写入 / 覆盖 */
  async set(key: string, value: string): Promise<void> {
    await ensureSchema(this.driver);
    await this.driver
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run([key, value]);
  }

  /** 删除（返回是否存在） */
  async remove(key: string): Promise<boolean> {
    await ensureSchema(this.driver);
    const result = await this.driver.prepare('DELETE FROM settings WHERE key = ?').run([key]);
    return result.changes > 0;
  }

  /** 列出全部键值（按 key 升序） */
  async entries(): Promise<Array<{ key: string; value: string }>> {
    await ensureSchema(this.driver);
    return this.driver
      .prepare('SELECT key, value FROM settings ORDER BY key ASC')
      .all<{ key: string; value: string }>();
  }
}
