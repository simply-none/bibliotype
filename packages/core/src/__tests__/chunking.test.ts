/**
 * 分片切片器测试（纯函数，不依赖存储实现）
 *
 * 关注三件事：
 * 1. 往返一致性（骨架 + 片能还原出相同的 IR 结构）；
 * 2. 增量语义（引用未变的片不重写、id 不变）；
 * 3. 局部结构变化（插入 / 删除段落）只重写局部片。
 */
import { describe, expect, it } from 'vitest';
import { NODE_TYPES } from '../ir/node-types.js';
import { createEmptyDocument } from '../ir/document.js';
import type { BookDocument } from '../ir/document.js';
import type { BookNode } from '../ir/nodes.js';
import {
  CHUNK_BUDGET_BYTES,
  buildChunkedSnapshot,
  fromSkeleton,
  type ChunkSlice,
} from '../storage/chunking.js';

/** 造一个段落节点 */
function paragraph(id: string, text: string): BookNode {
  return {
    type: NODE_TYPES.PARAGRAPH,
    id,
    children: [{ type: 'text', text }],
  };
}

/** 造一本「扁平多段落」大文档（模拟导入书：顶层全是段落） */
function flatBook(count: number, charsPer = 200): BookDocument {
  const doc = createEmptyDocument({ title: '分片样本' });
  const children: BookNode[] = [];
  for (let i = 0; i < count; i += 1) {
    children.push(paragraph(`p-${i}`, String(i % 10).repeat(charsPer)));
  }
  doc.root.children = children;
  return doc;
}

/** 切片上下文工厂：模拟适配器的 WeakMap + 自增 id */
function createHarness(): {
  ids: WeakMap<BookNode, string>;
  nextId: () => string;
} {
  let seq = 0;
  return {
    ids: new WeakMap<BookNode, string>(),
    nextId: () => `c-${(seq += 1)}`,
  };
}

/** 收集切片树里所有片（id → 节点数组） */
function collectChunks(slice: ChunkSlice, into = new Map<string, BookNode[]>()): Map<string, BookNode[]> {
  if (slice.kind === 'chunk') {
    into.set(slice.id, slice.nodes);
    return into;
  }
  for (const child of slice.children) collectChunks(child, into);
  return into;
}

/** 收集各片估算体积 */
function collectSizes(slice: ChunkSlice, into: number[] = []): number[] {
  if (slice.kind === 'chunk') {
    into.push(slice.size);
    return into;
  }
  for (const child of slice.children) collectSizes(child, into);
  return into;
}

describe('buildChunkedSnapshot', () => {
  it('大文档切成多片，每片不超过预算', () => {
    const doc = flatBook(400);
    const harness = createHarness();
    const snapshot = buildChunkedSnapshot(doc.root, undefined, harness.ids, harness.nextId);

    expect(snapshot.chunkIds.size).toBeGreaterThan(1);
    for (const size of collectSizes(snapshot.root)) {
      expect(size).toBeLessThanOrEqual(CHUNK_BUDGET_BYTES);
    }
  });

  it('骨架 + 片可完整还原文档根', () => {
    const doc = flatBook(120);
    const harness = createHarness();
    const snapshot = buildChunkedSnapshot(doc.root, undefined, harness.ids, harness.nextId);

    const chunkMap = collectChunks(snapshot.root);
    expect(fromSkeleton(snapshot.skeleton, chunkMap)).toEqual(doc.root);
  });

  it('原文不变再切一轮：不产生任何写入', () => {
    const doc = flatBook(120);
    const harness = createHarness();
    const first = buildChunkedSnapshot(doc.root, undefined, harness.ids, harness.nextId);
    const second = buildChunkedSnapshot(doc.root, first.root, harness.ids, harness.nextId);

    expect(second.writes).toHaveLength(0);
    expect([...second.chunkIds].sort()).toEqual([...first.chunkIds].sort());
  });

  it('只改一个段落：只重写它所在的片，其余片 id 不变', () => {
    const doc = flatBook(200);
    const harness = createHarness();
    const first = buildChunkedSnapshot(doc.root, undefined, harness.ids, harness.nextId);

    // 结构共享：只替换第 100 段，其余节点对象沿用
    const children = doc.root.children as BookNode[];
    const editedChildren = children.map((node, index) =>
      index === 100 ? paragraph('p-100', '改过的一段文字') : node,
    );
    const edited: BookNode = { ...doc.root, children: editedChildren };
    const second = buildChunkedSnapshot(edited, first.root, harness.ids, harness.nextId);

    // 局部重切：写入片数远小于总片数
    expect(first.chunkIds.size).toBeGreaterThan(3);
    expect(second.writes.length).toBeLessThanOrEqual(2);

    // 未变的片 id 仍在（说明没有被「整体重切」换掉 id）
    const kept = [...first.chunkIds].filter((id) => second.chunkIds.has(id));
    expect(kept.length).toBeGreaterThanOrEqual(first.chunkIds.size - 2);
  });

  it('插入一个段落：只新增 / 重写局部片，尾部片仍复用', () => {
    const doc = flatBook(200);
    const harness = createHarness();
    const first = buildChunkedSnapshot(doc.root, undefined, harness.ids, harness.nextId);

    const children = doc.root.children as BookNode[];
    const inserted = [
      ...children.slice(0, 100),
      paragraph('p-new', '插入的一段'),
      ...children.slice(100),
    ];
    const edited: BookNode = { ...doc.root, children: inserted };
    const second = buildChunkedSnapshot(edited, first.root, harness.ids, harness.nextId);

    expect(second.writes.length).toBeLessThanOrEqual(3);
    // 文档末尾的片（远离插入点）必须原样复用
    // 注意：本包 tsconfig 的 lib 为 ES2020，Array.prototype.at 在类型层面不存在
    const lastChunkIdList = [...first.chunkIds];
    const lastChunk = lastChunkIdList[lastChunkIdList.length - 1] as string;
    expect(second.chunkIds.has(lastChunk)).toBe(true);

    // 还原：合并「上一轮片」与「本轮新写片」后应得到 201 段
    const chunkMap = collectChunks(first.root);
    for (const write of second.writes) chunkMap.set(write.chunkId, write.nodes);
    const restored = fromSkeleton(second.skeleton, chunkMap);
    expect(restored?.children?.length).toBe(201);
  });

  it('删除一个段落：只在用集合收缩，写入保持局部', () => {
    const doc = flatBook(200);
    const harness = createHarness();
    const first = buildChunkedSnapshot(doc.root, undefined, harness.ids, harness.nextId);

    const children = doc.root.children as BookNode[];
    const edited: BookNode = {
      ...doc.root,
      children: [...children.slice(0, 3), ...children.slice(4)],
    };
    const second = buildChunkedSnapshot(edited, first.root, harness.ids, harness.nextId);

    expect(second.chunkIds.size).toBeLessThanOrEqual(first.chunkIds.size);
    expect(second.writes.length).toBeLessThanOrEqual(2);

    const chunkMap = collectChunks(first.root);
    for (const write of second.writes) chunkMap.set(write.chunkId, write.nodes);
    expect(fromSkeleton(second.skeleton, chunkMap)?.children?.length).toBe(199);
  });
});
