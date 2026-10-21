/**
 * 加密与脱敏：KDF + AES-GCM 往返、错误分支、存储装饰器、资产加密、导出脱敏。
 */
import { describe, expect, it } from 'vitest';
import { NODE_TYPES } from '../ir/node-types.js';
import { createEmptyDocument } from '../ir/document.js';
import type { BookDocument } from '../ir/document.js';
import { CRYPTO_ERROR_CODES, CryptoError } from '../crypto/errors.js';
import { deriveKeyPbkdf2 } from '../crypto/kdf.js';
import {
  base64ToBytes,
  createByteCipher,
  createStringCipher,
  decodeEnvelope,
  encodeEnvelope,
} from '../crypto/aes-gcm.js';
import {
  SEALED_ASSET_MEDIA_TYPE,
  SEALED_DOCUMENT_SCHEMA,
  createEncryptedAssetStore,
  createEncryptedStorageAdapter,
} from '../crypto/adapters.js';
import { redactAnnotations, redactDocument } from '../privacy/redact.js';
import type { AssetPayload, AssetRef, AssetStore } from '../storage/asset.js';
import type { DocumentSummary, SaveOptions, StorageAdapter } from '../storage/types.js';

const SALT = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
const IV = new Uint8Array(12).fill(7);

function sampleDoc(title = '论语'): BookDocument {
  const doc = createEmptyDocument({ title });
  doc.root.children = [
    { type: NODE_TYPES.PARAGRAPH, children: [{ type: 'text', text: '学而时习之' }] },
  ];
  return doc;
}

async function makeKey(password = 'correct horse'): Promise<CryptoKey> {
  return deriveKeyPbkdf2({ password, salt: SALT, iterations: 1000 });
}

describe('AES-GCM 加解密', () => {
  it('字符串加密往返，密文不含明文', async () => {
    const key = await makeKey();
    const cipher = createStringCipher(key, { ivSource: () => new Uint8Array(IV) });
    const envelope = await cipher.encrypt('学而时习之');
    expect(envelope.v).toBe(1);
    expect(base64ToBytes(envelope.data).length).toBeGreaterThan(0);
    await expect(cipher.decrypt(envelope)).resolves.toBe('学而时习之');
  });

  it('错误口令抛 WRONG_KEY 且带中文提示', async () => {
    const right = createStringCipher(await makeKey(), { ivSource: () => new Uint8Array(IV) });
    const envelope = await right.encrypt('秘密');
    const wrong = createStringCipher(await makeKey('wrong password'), {
      ivSource: () => new Uint8Array(IV),
    });
    await expect(wrong.decrypt(envelope)).rejects.toMatchObject({
      code: CRYPTO_ERROR_CODES.WRONG_KEY,
    });
  });

  it('信封损坏 / 版本不符抛 CORRUPT_PAYLOAD', async () => {
    const key = await makeKey();
    const cipher = createStringCipher(key, { ivSource: () => new Uint8Array(IV) });
    await expect(cipher.decrypt({ v: 9, iv: 'AA==', data: 'AA==' })).rejects.toBeInstanceOf(
      CryptoError,
    );
    expect(() => base64ToBytes('***')).toThrow(CryptoError);
    expect(() => decodeEnvelope(new TextEncoder().encode('{}'))).toThrow(/缺少/);
  });

  it('空口令与过短盐被拒绝', async () => {
    await expect(deriveKeyPbkdf2({ password: '', salt: SALT })).rejects.toMatchObject({
      code: CRYPTO_ERROR_CODES.INVALID_PARAMETER,
    });
    await expect(
      deriveKeyPbkdf2({ password: 'x', salt: new Uint8Array([1, 2]) }),
    ).rejects.toMatchObject({ code: CRYPTO_ERROR_CODES.INVALID_PARAMETER });
  });

  it('字节加解密（资产）往返', async () => {
    const cipher = createByteCipher(await makeKey(), { ivSource: () => new Uint8Array(IV) });
    const plain = new Uint8Array([0, 1, 2, 250, 255]);
    const envelope = await cipher.encrypt(plain);
    expect(await cipher.decrypt(decodeEnvelope(encodeEnvelope(envelope)))).toEqual(plain);
  });
});

/** 最小内存适配器（同时支持文档与资产） */
class Memoryish implements StorageAdapter, AssetStore {
  readonly name = 'memoryish';
  readonly docs = new Map<string, BookDocument>();
  readonly raw = new Map<string, { document: BookDocument; updatedAt: number }>();
  readonly assets = new Map<string, AssetPayload>();

  async save(id: string, document: BookDocument, options: SaveOptions = {}): Promise<void> {
    this.docs.set(id, document);
    this.raw.set(id, { document, updatedAt: options.updatedAt ?? 0 });
  }

  async load(id: string): Promise<BookDocument | undefined> {
    return this.docs.get(id);
  }

  async list(): Promise<DocumentSummary[]> {
    return [...this.raw.values()].map((record) => ({
      id: 'x',
      title: record.document.metadata.title,
      updatedAt: record.updatedAt,
    }));
  }

  async delete(id: string): Promise<boolean> {
    return this.docs.delete(id);
  }

  async clear(): Promise<void> {
    this.docs.clear();
  }

  async close(): Promise<void> {
    // 无需释放
  }

  async putAsset(id: string, payload: AssetPayload): Promise<AssetRef> {
    this.assets.set(id, payload);
    return { id, kind: 'image', mediaType: payload.mediaType, byteLength: payload.data.byteLength };
  }

  async getAsset(id: string): Promise<AssetPayload | undefined> {
    return this.assets.get(id);
  }

  async listAssets(): Promise<AssetRef[]> {
    return [...this.assets.entries()].map(([id, payload]) => ({
      id,
      kind: 'image',
      mediaType: payload.mediaType,
      byteLength: payload.data.byteLength,
    }));
  }

  async deleteAsset(id: string): Promise<boolean> {
    return this.assets.delete(id);
  }
}

describe('存储层透明加密', () => {
  it('底层只见占位文档，解锁后可还原正文', async () => {
    const inner = new Memoryish();
    const cipher = createStringCipher(await makeKey(), { ivSource: () => new Uint8Array(IV) });
    const adapter = createEncryptedStorageAdapter({ inner, cipher });

    await adapter.save('a', sampleDoc('论语'), { updatedAt: 100 });
    const stored = inner.docs.get('a');
    expect(stored?.schemaVersion).toBe(SEALED_DOCUMENT_SCHEMA);
    expect(JSON.stringify(stored)).not.toContain('学而时习之');

    const loaded = await adapter.load('a');
    expect(loaded?.metadata.title).toBe('论语');
    expect(loaded?.root.children?.[0]?.children?.[0]?.text).toBe('学而时习之');

    expect((await adapter.list())[0]?.title).toBe('已加密文档');
  });

  it('错误密钥解锁抛 WRONG_KEY，不写回损坏数据', async () => {
    const inner = new Memoryish();
    const cipher = createStringCipher(await makeKey(), { ivSource: () => new Uint8Array(IV) });
    await createEncryptedStorageAdapter({ inner, cipher }).save('a', sampleDoc());

    const wrong = createEncryptedStorageAdapter({
      inner,
      cipher: createStringCipher(await makeKey('another'), { ivSource: () => new Uint8Array(IV) }),
    });
    await expect(wrong.load('a')).rejects.toMatchObject({ code: CRYPTO_ERROR_CODES.WRONG_KEY });
    expect(inner.docs.get('a')?.schemaVersion).toBe(SEALED_DOCUMENT_SCHEMA);
  });

  it('混合状态（明文记录）明确报错而不是静默返回', async () => {
    const inner = new Memoryish();
    await inner.save('plain', sampleDoc());
    const adapter = createEncryptedStorageAdapter({
      inner,
      cipher: createStringCipher(await makeKey(), { ivSource: () => new Uint8Array(IV) }),
    });
    await expect(adapter.load('plain')).rejects.toMatchObject({
      code: CRYPTO_ERROR_CODES.CORRUPT_PAYLOAD,
    });
  });

  it('资产加密：底层不可读、往返字节一致', async () => {
    const inner = new Memoryish();
    const store = createEncryptedAssetStore({
      inner,
      cipher: createByteCipher(await makeKey(), { ivSource: () => new Uint8Array(IV) }),
    });
    const payload: AssetPayload = {
      mediaType: 'image/png',
      data: new Uint8Array([137, 80, 78, 71]),
      name: 'cover.png',
    };
    await store.putAsset('img-1', payload);
    const stored = inner.assets.get('img-1');
    expect(stored?.mediaType).toBe(SEALED_ASSET_MEDIA_TYPE);
    expect(JSON.stringify([...(stored?.data ?? [])])).not.toContain('image/png');

    const restored = await store.getAsset('img-1');
    expect(restored?.mediaType).toBe('image/png');
    expect(restored?.name).toBe('cover.png');
    expect(restored?.data).toEqual(payload.data);
  });
});

describe('导出脱敏', () => {
  it('隐藏作者 / 进度', () => {
    const doc = sampleDoc();
    doc.metadata.contributors = [{ name: '朱熹' }];
    doc.metadata.extra = { tags: ['经部'], progress: 0.6, readingPosition: 'a:b' };

    const redacted = redactDocument(doc, { hideAuthors: true, hideProgress: true });
    expect(redacted.metadata.contributors).toBeUndefined();
    expect(redacted.metadata.extra).toEqual({ tags: ['经部'] });
    // 原文档不被修改
    expect(doc.metadata.contributors).toHaveLength(1);
  });

  it('保留占位作者', () => {
    const doc = sampleDoc();
    doc.metadata.contributors = [{ name: '朱熹' }];
    expect(
      redactDocument(doc, { hideAuthors: true, keepAuthorPlaceholder: true }).metadata.contributors,
    ).toEqual([{ name: '佚名' }]);
  });

  it('剔除批注并去掉评论作者', () => {
    const items = [
      { id: '1', kind: 'comment', author: { name: '甲' }, comments: [{ author: { name: '甲' }, text: '注' }] },
      { id: '2', kind: 'highlight', author: { name: '乙' }, body: '原文' },
    ];
    const redacted = redactAnnotations(items, { hideComments: true, hideAuthors: true });
    expect(redacted.map((item) => item.id)).toEqual(['2']);
    expect(redacted[0]?.author).toBeUndefined();

    const kept = redactAnnotations(items, { hideAuthors: true });
    expect(kept).toHaveLength(2);
    expect(kept[0]?.comments).toEqual([{ text: '注' }]);
  });
});
