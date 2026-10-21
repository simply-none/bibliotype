/**
 * 整库备份：文件规划、三策略恢复、坏包跳过、进度与校验。
 */
import { describe, expect, it } from 'vitest';
import { NODE_TYPES } from '../ir/node-types.js';
import { createEmptyDocument } from '../ir/document.js';
import type { BookDocument } from '../ir/document.js';
import {
  BACKUP_CONFLICT_STRATEGIES,
  buildLibraryBackupFiles,
  nextCopyId,
  parseLibraryBackupManifest,
  resolveConflictTarget,
  restoreLibrary,
} from '../storage/backup.js';
import type { LibraryRestoreProgress } from '../storage/backup.js';
import { buildBookPackFiles } from '../storage/btbook.js';
import type { BookPackCodec, BookPackFile } from '../storage/btbook.js';
import { base64ToBytes, bytesToBase64 } from '../crypto/aes-gcm.js';
import type { BookDocument as Doc } from '../ir/document.js';
import type { DocumentSummary, SaveOptions, StorageAdapter } from '../storage/types.js';

function sampleDoc(title: string): BookDocument {
  const doc = createEmptyDocument({ title });
  doc.root.children = [
    { type: NODE_TYPES.PARAGRAPH, children: [{ type: 'text', text: `${title}正文` }] },
  ];
  return doc;
}

const jsonCodec: BookPackCodec = {
  async zip(files: readonly BookPackFile[]): Promise<Uint8Array> {
    return new TextEncoder().encode(
      JSON.stringify(files.map((file) => ({ path: file.path, data: bytesToBase64(file.data) }))),
    );
  },
  async unzip(data: Uint8Array): Promise<BookPackFile[]> {
    const parsed = JSON.parse(new TextDecoder().decode(data)) as { path: string; data: string }[];
    return parsed.map((item) => ({ path: item.path, data: base64ToBytes(item.data) }));
  },
};

/** 轻量内存适配器（避免 core 测试依赖 adapter 包） */
class TestAdapter implements StorageAdapter {
  readonly name = 'test';
  readonly docs = new Map<string, { document: Doc; updatedAt: number }>();
  readonly summaries = new Map<string, DocumentSummary>();

  async save(id: string, document: BookDocument, options: SaveOptions = {}): Promise<void> {
    const updatedAt = options.updatedAt ?? 0;
    this.docs.set(id, { document, updatedAt });
    const previous = this.summaries.get(id);
    this.summaries.set(id, {
      ...previous,
      id,
      title: document.metadata.title,
      updatedAt,
    });
  }

  async load(id: string): Promise<BookDocument | undefined> {
    return this.docs.get(id)?.document;
  }

  async list(): Promise<DocumentSummary[]> {
    return [...this.summaries.values()].map((summary) => ({ ...summary }));
  }

  async updateSummary(id: string, patch: Partial<DocumentSummary>): Promise<DocumentSummary | undefined> {
    const current = this.summaries.get(id);
    if (current === undefined) {
      return undefined;
    }
    const next = { ...current, ...patch, id };
    this.summaries.set(id, next);
    return next;
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
}

/** 打包一本书为 .btbook 字节 */
async function packBook(id: string, title: string, updatedAt: number) {
  return jsonCodec.zip(
    buildBookPackFiles({
      id,
      document: sampleDoc(title),
      createdAt: updatedAt,
      summary: { id, title, updatedAt, progress: 0.5 },
    }),
  );
}

describe('备份包文件规划', () => {
  it('清单记录书目与设置/样式存在性', async () => {
    const files = buildLibraryBackupFiles({
      createdAt: 1_700_000_000_000,
      books: [{ id: 'a', title: '论语', archive: await packBook('a', '论语', 100) }],
      settings: { theme: 'paper' },
      styles: { named: [] },
    });
    expect(files.map((file) => file.path)).toEqual([
      'manifest.json',
      'books/a.btbook',
      'settings.json',
      'styles.json',
    ]);
    const manifest = parseLibraryBackupManifest(files);
    expect(manifest.books).toEqual([{ id: 'a', title: '论语', path: 'books/a.btbook' }]);
    expect(manifest.hasSettings).toBe(true);
    expect(manifest.hasStyles).toBe(true);
  });

  it('重复 id 在包内自动加序号，避免覆盖', async () => {
    const files = buildLibraryBackupFiles({
      createdAt: 1,
      books: [
        { id: 'a', title: '甲', archive: await packBook('a', '甲', 1) },
        { id: 'a', title: '甲2', archive: await packBook('a', '甲2', 2) },
      ],
    });
    const manifest = parseLibraryBackupManifest(files);
    expect(manifest.books.map((book) => book.path)).toEqual(['books/a.btbook', 'books/a-2.btbook']);
  });

  it('副本 id 依次递增', () => {
    expect(nextCopyId('a', new Set())).toBe('a-copy');
    expect(nextCopyId('a', new Set(['a-copy']))).toBe('a-copy-2');
    expect(nextCopyId('a', new Set(['a-copy', 'a-copy-2']))).toBe('a-copy-3');
  });

  it('冲突策略选择：merge / overwrite / keep-both', () => {
    const existing = new Map([['a', { id: 'a', title: '旧', updatedAt: 100 }]]);
    const taken = new Set(['a']);
    expect(
      resolveConflictTarget({ id: 'a', updatedAt: 200, existing, taken, strategy: 'merge' }),
    ).toEqual({ action: 'write', id: 'a' });
    expect(
      resolveConflictTarget({ id: 'a', updatedAt: 50, existing, taken, strategy: 'merge' }),
    ).toEqual({ action: 'skip' });
    expect(
      resolveConflictTarget({ id: 'a', updatedAt: 50, existing, taken, strategy: 'overwrite' }),
    ).toEqual({ action: 'write', id: 'a' });
    expect(
      resolveConflictTarget({ id: 'a', updatedAt: 50, existing, taken, strategy: 'keep-both' }),
    ).toEqual({ action: 'write', id: 'a-copy' });
  });
});

describe('restoreLibrary', () => {
  it('空实例导入还原书目、封面与进度', async () => {
    const files = buildLibraryBackupFiles({
      createdAt: 1,
      books: [
        { id: 'a', title: '论语', archive: await packBook('a', '论语', 100) },
        { id: 'b', title: '史记', archive: await packBook('b', '史记', 200) },
      ],
      settings: { fontScale: 1.2 },
    });
    const target = new TestAdapter();
    const progress: LibraryRestoreProgress[] = [];
    const result = await restoreLibrary({
      files,
      codec: jsonCodec,
      target,
      onProgress: (item) => progress.push(item),
    });

    expect(result.restored).toEqual(['a', 'b']);
    expect(result.failures).toEqual([]);
    expect(result.settings).toEqual({ fontScale: 1.2 });
    expect((await target.load('a'))?.metadata.title).toBe('论语');
    expect(target.summaries.get('a')?.progress).toBe(0.5);
    expect(progress.map((item) => item.current)).toEqual([1, 2, 2]);
    expect(progress[progress.length - 1]?.phase).toBe('done');
  });

  it('merge 策略保留较新、跳过较旧', async () => {
    const target = new TestAdapter();
    await target.save('a', sampleDoc('新稿'), { updatedAt: 500 });
    const files = buildLibraryBackupFiles({
      createdAt: 1,
      books: [{ id: 'a', title: '旧稿', archive: await packBook('a', '旧稿', 100) }],
    });

    const result = await restoreLibrary({
      files,
      codec: jsonCodec,
      target,
      strategy: BACKUP_CONFLICT_STRATEGIES.MERGE,
    });
    expect(result.skipped).toEqual(['a']);
    expect((await target.load('a'))?.metadata.title).toBe('新稿');
  });

  it('keep-both 生成副本而非覆盖', async () => {
    const target = new TestAdapter();
    await target.save('a', sampleDoc('原稿'), { updatedAt: 500 });
    const files = buildLibraryBackupFiles({
      createdAt: 1,
      books: [{ id: 'a', title: '导入稿', archive: await packBook('a', '导入稿', 100) }],
    });

    const result = await restoreLibrary({
      files,
      codec: jsonCodec,
      target,
      strategy: BACKUP_CONFLICT_STRATEGIES.KEEP_BOTH,
    });
    expect(result.copies).toEqual([{ sourceId: 'a', id: 'a-copy' }]);
    expect((await target.load('a'))?.metadata.title).toBe('原稿');
    expect((await target.load('a-copy'))?.metadata.title).toBe('导入稿');
  });

  it('损坏包与非法 IR 进失败清单，不影响其余书', async () => {
    const good = await packBook('good', '好书', 10);
    const brokenIr = buildBookPackFiles({
      id: 'bad-ir',
      document: sampleDoc('坏书'),
      createdAt: 10,
    }).map((file) =>
      file.path === 'document.json'
        ? { path: file.path, data: new TextEncoder().encode('{"root":{"type":"nope"}}') }
        : file,
    );
    const badIrArchive = await jsonCodec.zip(brokenIr);
    const files = buildLibraryBackupFiles({
      createdAt: 1,
      books: [
        { id: 'good', title: '好书', archive: good },
        { id: 'bad-ir', title: '坏书', archive: badIrArchive },
        { id: 'missing', title: '缺包', archive: new Uint8Array([1, 2, 3]) },
      ],
    });

    const target = new TestAdapter();
    const result = await restoreLibrary({ files, codec: jsonCodec, target });
    expect(result.restored).toEqual(['good']);
    expect(result.failures.map((item) => item.id)).toEqual(['bad-ir', 'missing']);
    expect(result.failures.every((item) => item.message.length > 0)).toBe(true);
  });

  it('结构性错误仍拒绝落库（未知插件类型只告警）', async () => {
    const archive = await jsonCodec.zip(
      buildBookPackFiles({
        id: 'x',
        document: {
          schemaVersion: '0.3.0',
          metadata: { title: '结构坏' },
          // 容器节点上带 text：结构性错误，与插件类型无关
          root: { type: 'book', children: [{ type: 'paragraph', text: '非法' }] },
        },
        createdAt: 1,
      }),
    );
    const files = buildLibraryBackupFiles({
      createdAt: 1,
      books: [{ id: 'x', title: '结构坏', archive }],
    });
    const target = new TestAdapter();
    const result = await restoreLibrary({ files, codec: jsonCodec, target });
    expect(result.restored).toEqual([]);
    expect(result.failures[0]?.code).toBe('INVALID_DOCUMENT');
    expect(target.docs.size).toBe(0);
  });
});

describe('恢复校验：插件类型（H4）', () => {
  /** 含 classical 插件节点与标记的文档（core 不认识这些类型） */
  function classicalDoc(): BookDocument {
    const doc = sampleDoc('论语');
    doc.root.children = [
      {
        type: 'collation-mark',
        attrs: { symbol: '○' },
        children: [],
      },
      {
        type: NODE_TYPES.PARAGRAPH,
        children: [
          { type: 'text', text: '子曰', marks: [{ type: 'judou', attrs: { symbol: '，' } }] },
        ],
      },
    ];
    return doc;
  }

  async function restoreClassical(
    options: Omit<Parameters<typeof restoreLibrary>[0], 'files' | 'codec' | 'target'> = {},
  ) {
    const archive = await jsonCodec.zip(
      buildBookPackFiles({ id: 'lunyu', document: classicalDoc(), createdAt: 1 }),
    );
    const files = buildLibraryBackupFiles({
      createdAt: 1,
      books: [{ id: 'lunyu', title: '论语', archive }],
    });
    const target = new TestAdapter();
    const result = await restoreLibrary({ files, codec: jsonCodec, target, ...options });
    return { target, result };
  }

  it('未知插件类型默认降级为 warning，书籍照常恢复', async () => {
    const warnings: string[] = [];
    const { target, result } = await restoreClassical({
      onBookValidated: (context) => {
        warnings.push(...context.warnings.map((issue) => issue.code));
      },
    });

    expect(result.restored).toEqual(['lunyu']);
    expect(result.failures).toEqual([]);
    expect(await target.load('lunyu')).toBeDefined();
    expect(warnings).toContain('unknown-node-type');
    expect(warnings).toContain('unknown-mark-type');
  });

  it('登记插件类型后不再产生未知类型警告', async () => {
    const warnings: string[] = [];
    const { result } = await restoreClassical({
      validateOptions: {
        knownNodeTypes: ['collation-mark'],
        knownMarkTypes: ['judou'],
      },
      onBookValidated: (context) => {
        warnings.push(...context.warnings.map((issue) => issue.code));
      },
    });

    expect(result.restored).toEqual(['lunyu']);
    expect(warnings).toEqual([]);
  });

  it('显式收紧（unknownTypesAsWarning: false）时仍拒绝插件类型文档', async () => {
    const { target, result } = await restoreClassical({
      validateOptions: { unknownTypesAsWarning: false },
    });

    expect(result.restored).toEqual([]);
    expect(result.failures[0]?.code).toBe('INVALID_DOCUMENT');
    expect(result.failures[0]?.message).toContain('未知');
    expect(target.docs.size).toBe(0);
  });
});
