/**
 * 样式设置存储实现（SQLite）
 *
 * 对应 core 的 `StyleSettingsStore` 端口，供 Electron 等宿主把样式配置落到本地库。
 *
 * 设计要点：
 * - 组合 `SqliteKeyValueStore`，复用 `settings` 表，**不新增表、不升 schema 版本**；
 * - 键空间与 `LocalStorageStyleStore` 完全一致（`bt-style:snapshot:<scope>` / `bt-style:presets`），
 *   便于两侧迁移与心智统一；
 * - 快照与预设均为 JSON 安全的小载荷，整条覆盖写入，语义与 IndexedDB / localStorage 实现一致。
 */
import {
  normalizeStyleSnapshot,
  type StylePreset,
  type StyleSettingsSnapshot,
  type StyleSettingsStore,
} from '@bibliotype/core';
import type { SqliteDriver } from './driver.js';
import { SqliteKeyValueStore } from './key-value.js';

/** 快照键前缀（按作用域拼接） */
const SNAPSHOT_PREFIX = 'bt-style:snapshot:';
/** 预设集合键（与 localStorage 实现同款：整个数组存一条 JSON） */
const PRESETS_KEY = 'bt-style:presets';

/** SQLite 样式存储选项 */
export interface SQLiteStyleStoreOptions {
  /** 宿主注入的驱动 */
  driver: SqliteDriver;
  /** 可选的 KV 实现（测试注入用；缺省按 driver 新建） */
  keyValue?: SqliteKeyValueStore;
}

/** 解析 JSON（失败返回 undefined，不抛错） */
function parseJson(raw: string | undefined): unknown {
  if (raw === undefined || raw === '') return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/** SQLite 样式设置存储 */
export class SQLiteStyleStore implements StyleSettingsStore {
  /** 适配器名称（设置面板显示用） */
  readonly name = 'sqlite';

  private readonly keyValue: SqliteKeyValueStore;

  /**
   * @param options 驱动与可选的 KV 实现
   */
  constructor(options: SQLiteStyleStoreOptions) {
    this.keyValue = options.keyValue ?? new SqliteKeyValueStore({ driver: options.driver });
  }

  /**
   * 读取指定作用域的快照
   *
   * @param scope 作用域键（`global` / `book:<id>`）
   * @returns 规范化后的快照；未命中返回 undefined
   */
  async load(scope: string): Promise<StyleSettingsSnapshot | undefined> {
    const raw = parseJson(await this.keyValue.get(`${SNAPSHOT_PREFIX}${scope}`));
    if (raw === undefined) return undefined;
    return normalizeStyleSnapshot(raw, scope);
  }

  /**
   * 写入指定作用域的快照（整条覆盖）
   *
   * @param scope 作用域键
   * @param snapshot 快照
   */
  async save(scope: string, snapshot: StyleSettingsSnapshot): Promise<void> {
    await this.keyValue.set(`${SNAPSHOT_PREFIX}${scope}`, JSON.stringify(snapshot));
  }

  /**
   * 列出全部预设（按创建时间降序）
   *
   * @returns 预设数组；无预设时为空数组
   */
  async listPresets(): Promise<StylePreset[]> {
    const raw = parseJson(await this.keyValue.get(PRESETS_KEY));
    if (!Array.isArray(raw)) return [];
    return (raw as StylePreset[])
      .filter((item) => typeof item === 'object' && item !== null)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * 写入 / 覆盖预设
   *
   * @param preset 预设
   */
  async savePreset(preset: StylePreset): Promise<void> {
    const presets = await this.listPresets();
    const next = [preset, ...presets.filter((item) => item.id !== preset.id)];
    await this.keyValue.set(PRESETS_KEY, JSON.stringify(next));
  }

  /**
   * 删除预设
   *
   * @param id 预设 id
   * @returns 是否删除了记录
   */
  async deletePreset(id: string): Promise<boolean> {
    const presets = await this.listPresets();
    const next = presets.filter((item) => item.id !== id);
    if (next.length === presets.length) return false;
    await this.keyValue.set(PRESETS_KEY, JSON.stringify(next));
    return true;
  }

  /**
   * 删除指定作用域的快照
   *
   * @param scope 作用域键
   * @returns 是否删除了记录
   */
  async delete(scope: string): Promise<boolean> {
    return this.keyValue.remove(`${SNAPSHOT_PREFIX}${scope}`);
  }

  /**
   * 清空全部（快照 + 预设）
   *
   * 快照键需要枚举 `settings` 表后逐个删除（表内可能有其它宿主的键，不能整表清空）。
   */
  async clear(): Promise<void> {
    await this.keyValue.remove(PRESETS_KEY);
    const entries = await this.keyValue.entries();
    for (const entry of entries) {
      if (entry.key.startsWith(SNAPSHOT_PREFIX)) {
        await this.keyValue.remove(entry.key);
      }
    }
  }

  /** 释放底层资源（连接归宿主，无可释放） */
  async close(): Promise<void> {
    /* 连接生命周期归宿主，适配器不关闭 */
  }
}
