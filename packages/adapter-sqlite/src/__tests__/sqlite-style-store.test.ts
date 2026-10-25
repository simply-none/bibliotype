import { describe, expect, it } from 'vitest';
import {
  createDefaultStyleSnapshot,
  createEmptyStyleSettingsBody,
  type StylePreset,
} from '@bibliotype/core';
import { SqliteKeyValueStore } from '../key-value.js';
import { SQLiteStyleStore } from '../style-store.js';
import { createTestDatabase } from './helpers/sqljs.js';

/** 构造测试预设 */
function preset(id: string, createdAt: number): StylePreset {
  return {
    id,
    name: `预设-${id}`,
    basedOn: 'modern',
    body: createEmptyStyleSettingsBody(),
    createdAt,
  };
}

describe('SQLiteStyleStore', () => {
  it('保存 / 读取 / 删除快照', async () => {
    const { driver } = await createTestDatabase();
    const store = new SQLiteStyleStore({ driver });
    const snapshot = createDefaultStyleSnapshot('global');
    snapshot.tokens = { 'font-size': '16pt' };
    snapshot.updatedAt = 123;

    await store.save('global', snapshot);
    expect(await store.load('global')).toEqual(snapshot);
    expect(await store.load('book:missing')).toBeUndefined();

    await expect(store.delete('global')).resolves.toBe(true);
    await expect(store.delete('global')).resolves.toBe(false);
    expect(await store.load('global')).toBeUndefined();
  });

  it('坏数据被规范化而非抛错', async () => {
    const { driver } = await createTestDatabase();
    const kv = new SqliteKeyValueStore({ driver });
    await kv.set('bt-style:snapshot:global', 'not-json');
    const store = new SQLiteStyleStore({ driver, keyValue: kv });
    expect(await store.load('global')).toBeUndefined();

    await kv.set('bt-style:snapshot:book:a', JSON.stringify({ tokens: { a: 1, b: 'x' } }));
    const normalized = await store.load('book:a');
    expect(normalized?.scope).toBe('book:a');
    expect(normalized?.tokens).toEqual({ b: 'x' });
  });

  it('预设：保存 / 覆盖 / 降序 / 删除', async () => {
    const { driver } = await createTestDatabase();
    const store = new SQLiteStyleStore({ driver });

    await store.savePreset(preset('a', 100));
    await store.savePreset(preset('b', 200));
    expect((await store.listPresets()).map((item) => item.id)).toEqual(['b', 'a']);

    await store.savePreset({ ...preset('a', 300), name: '改名' });
    const list = await store.listPresets();
    expect(list.map((item) => item.id)).toEqual(['a', 'b']);
    expect(list[0]?.name).toBe('改名');

    await expect(store.deletePreset('a')).resolves.toBe(true);
    await expect(store.deletePreset('a')).resolves.toBe(false);
    expect((await store.listPresets()).map((item) => item.id)).toEqual(['b']);
  });

  it('clear 只清理样式键，不影响其它宿主数据', async () => {
    const { driver } = await createTestDatabase();
    const kv = new SqliteKeyValueStore({ driver });
    const store = new SQLiteStyleStore({ driver, keyValue: kv });

    await store.save('global', createDefaultStyleSnapshot('global'));
    await store.save('book:x', createDefaultStyleSnapshot('book:x'));
    await store.savePreset(preset('p', 1));
    await kv.set('host:other', 'keep');

    await store.clear();
    expect(await store.load('global')).toBeUndefined();
    expect(await store.load('book:x')).toBeUndefined();
    expect(await store.listPresets()).toEqual([]);
    expect(await kv.get('host:other')).toBe('keep');
  });

  it('close 后仍可继续使用（连接归宿主）', async () => {
    const { driver } = await createTestDatabase();
    const store = new SQLiteStyleStore({ driver });
    await store.close();
    await store.save('global', createDefaultStyleSnapshot('global'));
    expect(await store.load('global')).toBeDefined();
  });
});
