import { describe, expect, it } from 'vitest';
import { hashAssetBytes } from '@bibliotype/core';
import { SqliteAssetStore } from '../asset-store.js';
import { createTestDatabase } from './helpers/sqljs.js';

/** 造 1 MB 可预测字节 */
function bigBytes(): Uint8Array {
  const bytes = new Uint8Array(1024 * 1024);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = i % 251;
  }
  return bytes;
}

describe('SqliteAssetStore', () => {
  it('1 MB 资产往返字节一致，元信息含 hash', async () => {
    const { driver } = await createTestDatabase();
    const store = new SqliteAssetStore({ driver });
    const data = bigBytes();

    const ref = await store.putAsset('cover', {
      mediaType: 'image/png',
      data,
      name: 'cover.png',
    });
    expect(ref.id).toBe('cover');
    expect(ref.kind).toBe('image');
    expect(ref.byteLength).toBe(data.byteLength);
    expect(ref.hash).toBe(hashAssetBytes(data));
    expect(ref.name).toBe('cover.png');

    const loaded = await store.getAsset('cover');
    expect(loaded?.mediaType).toBe('image/png');
    expect(loaded?.name).toBe('cover.png');
    expect(loaded?.data).toBeInstanceOf(Uint8Array);
    expect(loaded?.data.byteLength).toBe(data.byteLength);
    expect(Buffer.from(loaded?.data as Uint8Array).equals(Buffer.from(data))).toBe(true);
  });

  it('同 id 覆盖：列表仍一条，长度更新', async () => {
    const { driver } = await createTestDatabase();
    const store = new SqliteAssetStore({ driver });

    await store.putAsset('font', { mediaType: 'font/woff2', data: new Uint8Array([1, 2]) });
    await store.putAsset('font', { mediaType: 'font/woff2', data: new Uint8Array([3, 4, 5, 6]) });

    const list = await store.listAssets();
    expect(list).toHaveLength(1);
    expect(list[0]?.byteLength).toBe(4);
    expect(list[0]?.kind).toBe('font');
  });

  it('未命中返回 undefined，删除返回是否存在', async () => {
    const { driver } = await createTestDatabase();
    const store = new SqliteAssetStore({ driver });

    await expect(store.getAsset('missing')).resolves.toBeUndefined();
    await expect(store.deleteAsset('missing')).resolves.toBe(false);

    await store.putAsset('audio', { mediaType: 'audio/mpeg', data: new Uint8Array([7]) });
    await expect(store.deleteAsset('audio')).resolves.toBe(true);
    await expect(store.getAsset('audio')).resolves.toBeUndefined();
  });

  it('显式 kind 覆盖 MIME 推断', async () => {
    const { driver } = await createTestDatabase();
    const store = new SqliteAssetStore({ driver });
    const ref = await store.putAsset(
      'seal',
      { mediaType: 'application/octet-stream', data: new Uint8Array([1]) },
      { kind: 'image' },
    );
    expect(ref.kind).toBe('image');
  });
});
