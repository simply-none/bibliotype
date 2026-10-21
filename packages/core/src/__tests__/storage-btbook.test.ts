/**
 * `.btbook` 书档：文件规划、清单校验、资产与注记往返、错误分支。
 */
import { describe, expect, it } from 'vitest';
import { NODE_TYPES } from '../ir/node-types.js';
import { createEmptyDocument } from '../ir/document.js';
import type { BookDocument } from '../ir/document.js';
import {
  BOOK_PACK_ERROR_CODES,
  BookPackError,
  assetIdFromPath,
  assetPackPath,
  buildBookPackFiles,
  parseBookPackFiles,
  parseBookPackManifest,
  unpackBookArchive,
} from '../storage/btbook.js';
import type { BookPackCodec, BookPackFile } from '../storage/btbook.js';
import { base64ToBytes, bytesToBase64 } from '../crypto/aes-gcm.js';

function sampleDoc(title = '论语集注'): BookDocument {
  const doc = createEmptyDocument({ title, contributors: [{ name: '朱熹' }] });
  doc.root.children = [
    { type: NODE_TYPES.PARAGRAPH, children: [{ type: 'text', text: '学而时习之' }] },
  ];
  return doc;
}

/** 测试用「压缩」：JSON + base64，足够验证文件规划与嵌套包 */
const jsonCodec: BookPackCodec = {
  async zip(files: readonly BookPackFile[]): Promise<Uint8Array> {
    const payload = files.map((file) => ({
      path: file.path,
      data: bytesToBase64(file.data),
    }));
    return new TextEncoder().encode(JSON.stringify(payload));
  },
  async unzip(data: Uint8Array): Promise<BookPackFile[]> {
    const parsed = JSON.parse(new TextDecoder().decode(data)) as {
      path: string;
      data: string;
    }[];
    return parsed.map((item) => ({ path: item.path, data: base64ToBytes(item.data) }));
  },
};

describe('buildBookPackFiles / parseBookPackFiles', () => {
  it('清单与文件规划：manifest / document / annotations / assets', () => {
    const files = buildBookPackFiles({
      id: 'book-1',
      document: sampleDoc(),
      createdAt: 1_700_000_000_000,
      assets: [
        { id: 'cover/1', payload: { mediaType: 'image/png', data: new Uint8Array([1, 2, 3]) } },
      ],
      annotations: { schemaVersion: '1', annotations: [] },
    });
    expect(files.map((file) => file.path)).toEqual([
      'manifest.json',
      'document.json',
      'annotations.json',
      'assets/cover%2F1',
    ]);

    const manifest = parseBookPackManifest(files);
    expect(manifest.id).toBe('book-1');
    expect(manifest.title).toBe('论语集注');
    expect(manifest.summary.author).toBe('朱熹');
    expect(manifest.assets).toEqual([{ id: 'cover/1', mediaType: 'image/png' }]);
    expect(manifest.hasAnnotations).toBe(true);

    const unpacked = parseBookPackFiles(files);
    expect(unpacked.document.root.children?.[0]?.children?.[0]?.text).toBe('学而时习之');
    expect(unpacked.assets[0]?.payload.data).toEqual(new Uint8Array([1, 2, 3]));
    expect(unpacked.annotations).toEqual({ schemaVersion: '1', annotations: [] });
  });

  it('资产路径编解码可逆', () => {
    const path = assetPackPath('封面 1.png');
    expect(assetIdFromPath(path)).toBe('封面 1.png');
    expect(assetIdFromPath('document.json')).toBeUndefined();
    expect(assetIdFromPath('assets/')).toBeUndefined();
  });

  it('经 codec 打包 / 解包往返', async () => {
    const archive = await jsonCodec.zip(
      buildBookPackFiles({ id: 'a', document: sampleDoc(), createdAt: 1 }),
    );
    const unpacked = await unpackBookArchive(archive, jsonCodec);
    expect(unpacked.manifest.id).toBe('a');
    expect(unpacked.document.metadata.title).toBe('论语集注');
  });
});

describe('书档错误分支', () => {
  it('缺 manifest 抛 INVALID_MANIFEST', () => {
    expect(() => parseBookPackFiles([])).toThrow(BookPackError);
    try {
      parseBookPackFiles([]);
    } catch (error) {
      expect((error as BookPackError).code).toBe(BOOK_PACK_ERROR_CODES.INVALID_MANIFEST);
    }
  });

  it('格式标识 / 版本不符分别抛错', () => {
    const files = buildBookPackFiles({ id: 'a', document: sampleDoc(), createdAt: 1 });
    const manifest = JSON.parse(new TextDecoder().decode(files[0]?.data ?? new Uint8Array()));
    const wrongFormat = [
      { path: 'manifest.json', data: new TextEncoder().encode(JSON.stringify({ ...manifest, format: 'zip' })) },
    ];
    expect(() => parseBookPackManifest(wrongFormat)).toThrow(/格式标识/);

    const wrongVersion = [
      { path: 'manifest.json', data: new TextEncoder().encode(JSON.stringify({ ...manifest, formatVersion: '9' })) },
    ];
    expect(() => parseBookPackManifest(wrongVersion)).toThrow(/不受支持/);
  });

  it('正文不是合法 IR 时抛 INVALID_DOCUMENT', () => {
    const files = buildBookPackFiles({ id: 'a', document: sampleDoc(), createdAt: 1 });
    const broken = files.map((file) =>
      file.path === 'document.json'
        ? { path: file.path, data: new TextEncoder().encode('{"nope":true}') }
        : file,
    );
    try {
      parseBookPackFiles(broken);
      throw new Error('应当抛错');
    } catch (error) {
      expect((error as BookPackError).code).toBe(BOOK_PACK_ERROR_CODES.INVALID_DOCUMENT);
    }
  });

  it('声明的资产缺失时抛 MISSING_ASSET', () => {
    const files = buildBookPackFiles({
      id: 'a',
      document: sampleDoc(),
      createdAt: 1,
      assets: [{ id: 'img-1', payload: { mediaType: 'image/png', data: new Uint8Array([1]) } }],
    });
    const missing = files.filter((file) => file.path !== 'assets/img-1');
    try {
      parseBookPackFiles(missing);
      throw new Error('应当抛错');
    } catch (error) {
      expect((error as BookPackError).code).toBe(BOOK_PACK_ERROR_CODES.MISSING_ASSET);
    }
  });
});
