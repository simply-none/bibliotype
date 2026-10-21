/**
 * Demo ZIP 端口：STORE 打包 / 解包往返与结构校验。
 */
import { describe, expect, it } from 'vitest';
import { buildBookPackFiles, createEmptyDocument } from '@bibliotype/core';
import { crc32, demoZipCodec, unzipFiles, zipFiles } from '../zip-codec.js';

describe('demoZipCodec', () => {
  it('文件列表往返一致', async () => {
    const files = [
      { path: 'manifest.json', data: new TextEncoder().encode('{"a":1}') },
      { path: 'assets/cover%2F1', data: new Uint8Array([0, 1, 2, 255]) },
    ];
    const archive = await demoZipCodec.zip(files);
    expect(archive[0]).toBe(0x50);
    expect(archive[1]).toBe(0x4b);

    const restored = await demoZipCodec.unzip(archive);
    expect(restored.map((file) => file.path)).toEqual(['manifest.json', 'assets/cover%2F1']);
    expect(new TextDecoder().decode(restored[0]?.data)).toBe('{"a":1}');
    expect(Array.from(restored[1]?.data ?? [])).toEqual([0, 1, 2, 255]);
  });

  it('确定性：同输入产出同字节', () => {
    const files = [{ path: 'a.json', data: new Uint8Array([1, 2, 3]) }];
    expect(Array.from(zipFiles(files))).toEqual(Array.from(zipFiles(files)));
  });

  it('可打包 .btbook 规划产物', async () => {
    const files = buildBookPackFiles({
      id: 'b1',
      document: createEmptyDocument({ title: '论语' }),
      createdAt: 1,
    });
    const restored = await demoZipCodec.unzip(await demoZipCodec.zip(files));
    expect(restored.map((file) => file.path)).toEqual(['manifest.json', 'document.json']);
  });

  it('CRC32 与已知值一致', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('截断的文件给出明确错误', () => {
    expect(() => unzipFiles(new Uint8Array([1, 2, 3]))).toThrow(/ZIP 结构损坏/);
  });
});
