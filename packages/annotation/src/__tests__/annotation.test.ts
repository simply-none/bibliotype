/**
 * 标注包行为测试：构造确定性、容器读写、序列化往返、锚点解析与持久化。
 */
import { describe, expect, it, vi } from 'vitest';
import { createBlockAnchor, createEmptyDocument, createTextAnchor } from '@bibliotype/core';
import type { BookDocument, BookNode } from '@bibliotype/core';
import {
  ANNOTATION_KINDS,
  ANNOTATION_SCHEMA_VERSION,
  AnnotationStore,
  DEFAULT_HIGHLIGHT_COLOR,
  addComment,
  countByKind,
  createBookmark,
  createComment,
  createHighlight,
  createNote,
  deserializeAnnotationSet,
  groupAnnotationsByNode,
  isAnnotation,
  resolveAnnotations,
  serializeAnnotationSet,
  setCommentResolved,
} from '../index.js';
import type { AnnotationSet, AnnotationStorage } from '../index.js';

const FIXED = '2026-10-20T00:00:00.000Z';
const clock = (): string => FIXED;
const author = { id: 'u1', name: '读者' };

function buildDocument(): BookDocument {
  const doc = createEmptyDocument({ title: '论语' });
  doc.root.children = [
    {
      id: 'ch1',
      type: 'chapter',
      children: [
        { id: 'p1', type: 'paragraph', children: [{ type: 'text', text: '学而时习之，不亦说乎' }] },
        { id: 'p2', type: 'paragraph', children: [{ type: 'text', text: '有朋自远方来' }] },
      ],
    },
  ];
  return doc;
}

function findNode(root: BookNode, id: string): BookNode | undefined {
  if (root.id === id) {
    return root;
  }
  for (const child of root.children ?? []) {
    const hit = findNode(child, id);
    if (hit) {
      return hit;
    }
  }
  return undefined;
}

describe('标注构造', () => {
  it('相同输入产生相同 id（确定性）', () => {
    const anchor = createTextAnchor('p1', 0, 4);
    const first = createHighlight(anchor, { createdAt: FIXED, author });
    const second = createHighlight(anchor, { createdAt: FIXED, author });
    expect(first.id).toBe(second.id);
    expect(first.color).toBe(DEFAULT_HIGHLIGHT_COLOR);
    expect(first.updatedAt).toBe(FIXED);
  });

  it('不同区间产生不同 id', () => {
    const first = createHighlight(createTextAnchor('p1', 0, 4), { createdAt: FIXED });
    const second = createHighlight(createTextAnchor('p1', 1, 4), { createdAt: FIXED });
    expect(first.id).not.toBe(second.id);
  });

  it('clock 注入生效', () => {
    const annotation = createBookmark(createBlockAnchor('p1'), { clock });
    expect(annotation.createdAt).toBe(FIXED);
  });

  it('笔记空正文抛错', () => {
    expect(() => createNote(createBlockAnchor('p1'), '   ')).toThrow(RangeError);
  });

  it('评论线程可追加与解决', () => {
    const created = createComment(createTextAnchor('p1', 0, 2), '此处可疑', author, { createdAt: FIXED });
    expect(created.kind).toBe(ANNOTATION_KINDS.COMMENT);
    expect(created.comments?.length).toBe(1);
    expect(created.resolved).toBe(false);

    const appended = addComment(created, '同意', { id: 'u2' }, { createdAt: '2026-10-21T00:00:00.000Z' });
    expect(appended.comments?.length).toBe(2);
    expect(created.comments?.length).toBe(1);

    const resolved = setCommentResolved(appended, true, { createdAt: '2026-10-22T00:00:00.000Z' });
    expect(resolved.resolved).toBe(true);
    expect(appended.resolved).toBe(false);
  });

  it('非评论类型不能追加评论', () => {
    const highlight = createHighlight(createBlockAnchor('p1'), { createdAt: FIXED });
    expect(() => addComment(highlight, 'x', author)).toThrow(TypeError);
  });
});

describe('AnnotationStore', () => {
  it('新增 / 读取 / 更新 / 删除', () => {
    const store = new AnnotationStore();
    const note = createNote(createBlockAnchor('p1'), '第一条', { createdAt: FIXED });
    store.add(note);
    expect(store.size).toBe(1);
    expect(store.get(note.id)?.body).toBe('第一条');

    const updated = store.update(note.id, { body: '改过', updatedAt: FIXED });
    expect(updated?.body).toBe('改过');
    expect(store.remove(note.id)).toBe(true);
    expect(store.remove(note.id)).toBe(false);
    expect(store.size).toBe(0);
  });

  it('重复 id 抛错，批量新增原子性', () => {
    const store = new AnnotationStore();
    const note = createNote(createBlockAnchor('p1'), 'x', { createdAt: FIXED });
    store.add(note);
    expect(() => store.add(note)).toThrow(RangeError);

    const other = createNote(createBlockAnchor('p2'), 'y', { createdAt: FIXED });
    expect(() => store.addMany([other, note])).toThrow(RangeError);
    expect(store.size).toBe(1);
    expect(store.has(other.id)).toBe(false);
  });

  it('按种类 / 节点 / 解决状态过滤', () => {
    const store = new AnnotationStore([
      createHighlight(createTextAnchor('p1', 0, 2), { createdAt: FIXED }),
      createBookmark(createBlockAnchor('p2'), { createdAt: FIXED }),
      setCommentResolved(
        createComment(createBlockAnchor('p1'), '评论', author, { createdAt: FIXED }),
        true,
        { createdAt: FIXED },
      ),
    ]);
    expect(store.list({ kind: ANNOTATION_KINDS.HIGHLIGHT })).toHaveLength(1);
    expect(store.list({ kind: [ANNOTATION_KINDS.BOOKMARK, ANNOTATION_KINDS.COMMENT] })).toHaveLength(2);
    expect(store.list({ nodeId: 'p1' })).toHaveLength(2);
    expect(store.list({ includeResolved: false })).toHaveLength(2);
  });

  it('外部修改返回值不影响内部状态', () => {
    const store = new AnnotationStore();
    const note = store.add(createNote(createBlockAnchor('p1'), 'x', { createdAt: FIXED }));
    note.comments?.push({ id: 'hack', author, body: 'x', createdAt: FIXED });
    note.body = 'changed';
    expect(store.get(note.id)?.body).toBe('x');
  });

  it('subscribe 收到快照，取消后不再通知', () => {
    const store = new AnnotationStore();
    const listener = vi.fn();
    const off = store.subscribe(listener);
    store.add(createBookmark(createBlockAnchor('p1'), { createdAt: FIXED }));
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    store.add(createBookmark(createBlockAnchor('p2'), { createdAt: FIXED }));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('hydrate / persist 对接持久化端口', async () => {
    const saved = new Map<string, AnnotationSet>();
    const storage: AnnotationStorage = {
      name: 'memory',
      loadAnnotations: async (bookId) => saved.get(bookId),
      saveAnnotations: async (bookId, set) => {
        saved.set(bookId, set);
      },
      clearAnnotations: async (bookId) => {
        saved.delete(bookId);
      },
    };
    const store = new AnnotationStore([createBookmark(createBlockAnchor('p1'), { createdAt: FIXED })]);
    await store.persist(storage, 'book-1');
    expect(saved.get('book-1')?.schemaVersion).toBe(ANNOTATION_SCHEMA_VERSION);

    const restored = new AnnotationStore();
    const count = await restored.hydrate(storage, 'book-1');
    expect(count).toBe(1);
    expect(restored.size).toBe(1);
    expect(await restored.hydrate(storage, 'missing')).toBe(0);
  });
});

describe('序列化', () => {
  it('不同插入顺序序列化结果一致', () => {
    const a = createBookmark(createBlockAnchor('p1'), { createdAt: FIXED });
    const b = createHighlight(createTextAnchor('p2', 0, 2), { createdAt: '2026-10-21T00:00:00.000Z' });
    expect(serializeAnnotationSet([a, b])).toBe(serializeAnnotationSet([b, a]));
  });

  it('往返一致', () => {
    const annotations = [
      createBookmark(createBlockAnchor('p1'), { createdAt: FIXED }),
      createNote(createBlockAnchor('p2'), '笔记', { createdAt: FIXED }),
    ];
    const json = serializeAnnotationSet(annotations);
    const set = deserializeAnnotationSet(json);
    expect(set.schemaVersion).toBe(ANNOTATION_SCHEMA_VERSION);
    expect(set.annotations).toHaveLength(2);
    expect(AnnotationStore.fromJSON(json).size).toBe(2);
  });

  it('非法输入抛 TypeError', () => {
    expect(() => deserializeAnnotationSet('not json')).toThrow(TypeError);
    expect(() => deserializeAnnotationSet('{"annotations":{}}')).toThrow(TypeError);
    expect(() => deserializeAnnotationSet('{"annotations":[{"id":"x"}]}')).toThrow(TypeError);
  });

  it('isAnnotation 拒绝不完整对象', () => {
    expect(isAnnotation({ id: 'x' })).toBe(false);
    expect(isAnnotation(null)).toBe(false);
    expect(isAnnotation(createHighlight(createBlockAnchor('p1'), { createdAt: FIXED }))).toBe(true);
  });
});

describe('锚点解析', () => {
  it('有效锚点解析出当前文本，失效锚点归入孤儿', () => {
    const doc = buildDocument();
    const valid = createHighlight(createTextAnchor('p1', 0, 4), { createdAt: FIXED });
    const orphan = createHighlight(createBlockAnchor('deleted-node'), { createdAt: FIXED });
    const resolution = resolveAnnotations(doc.root, [valid, orphan]);

    expect(resolution.resolved).toHaveLength(1);
    expect(resolution.resolved[0]?.text).toBe('学而时习');
    expect(resolution.resolved[0]?.node.id).toBe('p1');
    expect(resolution.orphans.map((item) => item.id)).toEqual([orphan.id]);
  });

  it('分组键按 nodeId 升序', () => {
    const doc = buildDocument();
    const resolution = resolveAnnotations(doc.root, [
      createHighlight(createBlockAnchor('p2'), { createdAt: FIXED }),
      createHighlight(createBlockAnchor('p1'), { createdAt: FIXED }),
    ]);
    expect([...groupAnnotationsByNode(resolution).keys()]).toEqual(['p1', 'p2']);
  });

  it('countByKind 统计有效标注', () => {
    const doc = buildDocument();
    const resolution = resolveAnnotations(doc.root, [
      createHighlight(createBlockAnchor('p1'), { createdAt: FIXED }),
      createBookmark(createBlockAnchor('p1'), { createdAt: FIXED }),
      createBookmark(createBlockAnchor('missing'), { createdAt: FIXED }),
    ]);
    expect(countByKind(resolution)).toEqual({ highlight: 1, bookmark: 1 });
  });

  it('文档节点存在时 findNode 辅助与解析一致', () => {
    const doc = buildDocument();
    expect(findNode(doc.root, 'p1')?.type).toBe('paragraph');
  });
});
