/**
 * 历史版本：节点级 diff、内联 diff、快照校验、保留策略与回滚。
 */
import { describe, expect, it } from 'vitest';
import { NODE_TYPES } from '../ir/node-types.js';
import { createEmptyDocument } from '../ir/document.js';
import type { BookDocument } from '../ir/document.js';
import { diffDocuments, inlineTextDiff } from '../history/diff.js';
import {
  assertRetentionPolicy,
  createSnapshot,
  nextSnapshotVersion,
  restoreSnapshot,
  selectExpiredSnapshots,
  snapshotChecksum,
} from '../history/snapshot.js';
import type { DocumentSnapshotMeta } from '../history/snapshot.js';

function doc(title: string, paragraphs: string[]): BookDocument {
  const document = createEmptyDocument({ title });
  document.root.children = paragraphs.map((text, index) => ({
    type: NODE_TYPES.PARAGRAPH,
    id: `p-${index}`,
    children: [{ type: 'text', text }],
  }));
  return document;
}

describe('inlineTextDiff', () => {
  it('识别插入 / 删除 / 未变片段', () => {
    expect(inlineTextDiff('学而时习之', '学而时习之')).toEqual([
      { kind: 'equal', text: '学而时习之' },
    ]);
    const segments = inlineTextDiff('学而时习之', '学而时习之也');
    expect(segments[0]).toEqual({ kind: 'equal', text: '学而时习之' });
    expect(segments[1]).toEqual({ kind: 'insert', text: '也' });

    const removed = inlineTextDiff('甲乙丙', '甲丙');
    expect(removed.map((segment) => segment.kind)).toContain('delete');
    expect(removed.map((segment) => segment.text).join('')).toBe('甲乙丙');
  });

  it('超长文本退化为整段替换', () => {
    const before = '甲'.repeat(2100);
    const after = `${before}乙`;
    expect(inlineTextDiff(before, after).map((segment) => segment.kind)).toEqual([
      'delete',
      'insert',
    ]);
  });
});

describe('diffDocuments', () => {
  it('统计新增 / 删除 / 修改', () => {
    const before = doc('论语', ['学而', '为政', '八佾']);
    const after = doc('论语集注', ['学而', '为政·改', '里仁', '述而']);
    const result = diffDocuments(before, after);

    expect(result.added).toBeGreaterThanOrEqual(1);
    expect(result.removed).toBeGreaterThanOrEqual(1);
    expect(result.modified).toBeGreaterThanOrEqual(1);
    const kinds = result.changes.map((change) => change.kind);
    expect(kinds).toContain('added');
    expect(kinds).toContain('removed');
    expect(kinds).toContain('modified');
    expect(result.changes.some((change) => change.path === 'metadata')).toBe(true);
  });

  it('完全相同的文档无差异', () => {
    const same = doc('论语', ['学而']);
    expect(diffDocuments(same, same)).toEqual({
      changes: [],
      added: 0,
      removed: 0,
      modified: 0,
    });
  });
});

describe('快照与保留策略', () => {
  const base = doc('论语', ['学而']);

  it('快照校验和稳定，可校验还原', () => {
    const snapshot = createSnapshot({
      documentId: 'book-1',
      document: base,
      version: 1,
      createdAt: 1000,
      label: '初稿',
    });
    expect(snapshot.documentId).toBe('book-1');
    expect(snapshot.label).toBe('初稿');
    expect(snapshot.checksum).toBe(snapshotChecksum(base));

    const restored = restoreSnapshot(snapshot);
    expect(restored.ok).toBe(true);
    if (restored.ok) {
      expect(restored.document).toEqual(base);
    }
  });

  it('篡改内容后拒绝回滚并给出错误码', () => {
    const snapshot = createSnapshot({
      documentId: 'book-1',
      document: base,
      version: 1,
      createdAt: 1000,
    });
    const tampered = {
      ...snapshot,
      document: doc('论语', ['被改']),
    };
    const result = restoreSnapshot(tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('CHECKSUM_MISMATCH');
      expect(result.message).toContain('校验和');
    }
  });

  it('结构性错误时拒绝回滚', () => {
    const broken: BookDocument = {
      schemaVersion: '0.3.0',
      metadata: { title: '坏文档' },
      // 容器上带 text：结构性错误（与未知插件类型无关）
      root: { type: 'book', children: [{ type: 'paragraph', text: '非法' }] },
    };
    const snapshot = createSnapshot({
      documentId: 'book-1',
      document: broken,
      version: 2,
      createdAt: 1000,
    });
    const result = restoreSnapshot(snapshot);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('INVALID_DOCUMENT');
    }
  });

  it('含插件类型（古籍标记）的快照默认可回滚，并回传 warning', () => {
    const pluginDoc: BookDocument = {
      schemaVersion: '0.3.0',
      metadata: { title: '论语' },
      root: {
        type: 'book',
        children: [
          { type: 'collation-mark', attrs: { symbol: '○' } },
          {
            type: 'paragraph',
            children: [
              { type: 'text', text: '子曰', marks: [{ type: 'judou', attrs: { symbol: '，' } }] },
            ],
          },
        ],
      },
    };
    const snapshot = createSnapshot({
      documentId: 'book-1',
      document: pluginDoc,
      version: 3,
      createdAt: 1000,
    });

    const result = restoreSnapshot(snapshot);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document).toEqual(pluginDoc);
      expect(result.warnings?.map((issue) => issue.code)).toEqual([
        'unknown-node-type',
        'unknown-mark-type',
      ]);
    }
  });

  it('登记插件类型后无 warning；显式严格时拒绝回滚', () => {
    const pluginDoc: BookDocument = {
      schemaVersion: '0.3.0',
      metadata: { title: '论语' },
      root: {
        type: 'book',
        children: [{ type: 'collation-mark', attrs: { symbol: '○' } }],
      },
    };
    const snapshot = createSnapshot({
      documentId: 'book-1',
      document: pluginDoc,
      version: 4,
      createdAt: 1000,
    });

    const lenient = restoreSnapshot(snapshot, {
      validateOptions: { knownNodeTypes: ['collation-mark'] },
    });
    expect(lenient.ok).toBe(true);
    if (lenient.ok) {
      expect(lenient.warnings).toBeUndefined();
    }

    const strict = restoreSnapshot(snapshot, {
      validateOptions: { unknownTypesAsWarning: false },
    });
    expect(strict.ok).toBe(false);
    if (!strict.ok) {
      expect(strict.code).toBe('INVALID_DOCUMENT');
      expect(strict.message).toContain('未知');
    }
  });

  it('下一个版本号单调递增', () => {
    const metas: DocumentSnapshotMeta[] = [
      { documentId: 'a', version: 1, createdAt: 1 },
      { documentId: 'a', version: 4, createdAt: 2 },
    ];
    expect(nextSnapshotVersion(metas)).toBe(5);
    expect(nextSnapshotVersion([])).toBe(1);
  });

  it('保留策略：按份数 / 按天数 / 取更严格者', () => {
    const day = 24 * 60 * 60 * 1000;
    const metas: DocumentSnapshotMeta[] = [
      { documentId: 'a', version: 1, createdAt: 0 },
      { documentId: 'a', version: 2, createdAt: 10 * day },
      { documentId: 'a', version: 3, createdAt: 20 * day },
    ];
    expect(
      selectExpiredSnapshots(metas, { maxCount: 2, now: 20 * day }).map((meta) => meta.version),
    ).toEqual([1]);
    expect(
      selectExpiredSnapshots(metas, { maxAgeDays: 5, now: 20 * day }).map((meta) => meta.version),
    ).toEqual([1, 2]);
    expect(
      selectExpiredSnapshots(metas, { maxCount: 2, maxAgeDays: 5, now: 20 * day }).map(
        (meta) => meta.version,
      ),
    ).toEqual([1, 2]);
  });

  it('非法保留策略直接报错，避免清空历史', () => {
    expect(() => assertRetentionPolicy({ now: 0 })).toThrow(RangeError);
    expect(() => assertRetentionPolicy({ maxCount: 0, now: 0 })).toThrow(RangeError);
    expect(() => assertRetentionPolicy({ maxAgeDays: 0, now: 0 })).toThrow(RangeError);
    expect(() => assertRetentionPolicy({ maxCount: 1, now: 0 })).not.toThrow();
  });
});
