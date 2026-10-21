/**
 * 加密标注存储（H5）：独立密钥往返、错误分支、明文兼容提示。
 */
import { describe, expect, it } from 'vitest';
import { CRYPTO_ERROR_CODES, createStringCipher, deriveKeyPbkdf2 } from '@bibliotype/core';
import { ANNOTATION_SCHEMA_VERSION } from '../serialize.js';
import type { AnnotationSet } from '../types.js';
import { createEncryptedAnnotationStorage } from '../encrypted-storage.js';

const SALT = new Uint8Array(16).fill(3);
const IV = new Uint8Array(12).fill(9);

async function cipherFor(password: string) {
  const key = await deriveKeyPbkdf2({ password, salt: SALT, iterations: 1000 });
  return createStringCipher(key, { ivSource: () => new Uint8Array(IV) });
}

/** 内存宿主（模拟 localStorage / IDB） */
function memoryHost() {
  const data = new Map<string, string>();
  return {
    data,
    read: async (bookId: string) => data.get(bookId),
    write: async (bookId: string, payload: string) => {
      data.set(bookId, payload);
    },
    remove: async (bookId: string) => {
      data.delete(bookId);
    },
  };
}

const sampleSet: AnnotationSet = {
  schemaVersion: ANNOTATION_SCHEMA_VERSION,
  annotations: [],
};

describe('createEncryptedAnnotationStorage', () => {
  it('保存为密文信封，未命中返回 undefined', async () => {
    const host = memoryHost();
    const storage = createEncryptedAnnotationStorage({
      ...host,
      cipher: await cipherFor('notes password'),
    });

    expect(await storage.loadAnnotations('book-1')).toBeUndefined();
    await storage.saveAnnotations('book-1', {
      schemaVersion: ANNOTATION_SCHEMA_VERSION,
      annotations: [],
    });

    const payload = host.data.get('book-1') ?? '';
    expect(payload).toContain('"iv"');
    expect(payload).not.toContain(ANNOTATION_SCHEMA_VERSION);
    expect(await storage.loadAnnotations('book-1')).toEqual(sampleSet);
  });

  it('清空后不再命中', async () => {
    const host = memoryHost();
    const storage = createEncryptedAnnotationStorage({
      ...host,
      cipher: await cipherFor('notes password'),
    });
    await storage.saveAnnotations('book-1', sampleSet);
    await storage.clearAnnotations('book-1');
    expect(await storage.loadAnnotations('book-1')).toBeUndefined();
  });

  it('错误注记口令抛 WRONG_KEY（与正文口令互不影响）', async () => {
    const host = memoryHost();
    const writer = createEncryptedAnnotationStorage({
      ...host,
      cipher: await cipherFor('notes password'),
    });
    await writer.saveAnnotations('book-1', sampleSet);

    const reader = createEncryptedAnnotationStorage({
      ...host,
      cipher: await cipherFor('document password'),
    });
    await expect(reader.loadAnnotations('book-1')).rejects.toMatchObject({
      code: CRYPTO_ERROR_CODES.WRONG_KEY,
    });
  });

  it('历史明文载荷给出结构化错误而不是静默返回', async () => {
    const host = memoryHost();
    await host.write('book-1', JSON.stringify(sampleSet));
    const storage = createEncryptedAnnotationStorage({
      ...host,
      cipher: await cipherFor('notes password'),
    });
    await expect(storage.loadAnnotations('book-1')).rejects.toMatchObject({
      code: CRYPTO_ERROR_CODES.CORRUPT_PAYLOAD,
    });
  });

  it('解密后结构不合法时抛 CORRUPT_PAYLOAD', async () => {
    const host = memoryHost();
    const cipher = await cipherFor('notes password');
    const storage = createEncryptedAnnotationStorage({ ...host, cipher });
    // 绕过 save 直接写入「合法信封 + 非法内容」
    const envelope = await cipher.encrypt(JSON.stringify({ nope: true }));
    await host.write('book-1', JSON.stringify(envelope));
    await expect(storage.loadAnnotations('book-1')).rejects.toMatchObject({
      code: CRYPTO_ERROR_CODES.CORRUPT_PAYLOAD,
    });
  });
});
