/**
 * 流式分块（D5）：章边界、块 / 字双上限、稳定 key、按节点取位置。
 */
import { describe, expect, it } from 'vitest';
import { createEmptyDocument } from '@bibliotype/core';
import type { BookDocument, BookNode } from '@bibliotype/core';
import { Reader } from '../reader.js';
import { buildFlowChunks } from '../flow.js';
import type { BlockSizeEstimator } from '../document-blocks.js';

/** 统一块高，避免估算差异干扰断言 */
const fixedSize: BlockSizeEstimator = () => 40;

function paragraph(id: string, text: string): BookNode {
  return { id, type: 'paragraph', children: [{ type: 'text', text }] };
}

/** 两章：第一章 5 段（无 id 的两段），第二章 2 段 */
function sampleDoc(): BookDocument {
  const doc = createEmptyDocument({ title: '论语' });
  doc.root.children = [
    {
      id: 'chap-1',
      type: 'chapter',
      attrs: { title: '学而第一' },
      children: [
        { id: 'h-1', type: 'heading', children: [{ type: 'text', text: '学而第一' }] },
        paragraph('p-1', '子曰学而时习之'),
        paragraph('p-2', '有朋自远方来'),
        { type: 'paragraph', children: [{ type: 'text', text: '无 id 的一段' }] },
        { id: 'p-4', type: 'paragraph', children: [{ type: 'text', text: '人不知而不愠' }] },
      ],
    },
    {
      id: 'chap-2',
      type: 'chapter',
      children: [
        { id: 'h-2', type: 'heading', children: [{ type: 'text', text: '为政第二' }] },
        paragraph('p-5', '为政以德'),
        paragraph('p-6', '譬如北辰'),
      ],
    },
  ];
  return doc;
}

function createReader(doc: BookDocument = sampleDoc()): Reader {
  const reader = new Reader({ pageMainSize: 120, estimator: fixedSize });
  reader.loadDocument(doc);
  return reader;
}

describe('buildFlowChunks', () => {
  it('按章切分，块不跨章，标题取 heading 文本', () => {
    const chunks = buildFlowChunks(sampleDoc(), { maxBlocksPerChunk: 3 });
    expect(chunks.map((chunk) => chunk.containerId)).toEqual([
      'chap-1',
      'chap-1',
      'chap-2',
    ]);
    expect(chunks[0]?.title).toBe('学而第一');
    // 第二章没有 attrs.title，回落到首个 heading
    expect(chunks[2]?.title).toBe('为政第二');
    // 第一章 5 块按 3 块一片切成 3 + 2（末片不补满）
    expect(chunks[0]?.nodes).toHaveLength(3);
    expect(chunks[1]?.nodes).toHaveLength(2);
    expect(chunks[1]?.startIndex).toBe(3);
    expect(chunks[2]?.startIndex).toBe(5);
  });

  it('无 id 的块合成 stable key，重复调用结果一致', () => {
    const first = buildFlowChunks(sampleDoc());
    const second = buildFlowChunks(sampleDoc());
    expect(first).toEqual(second);

    const ids = first.flatMap((chunk) => chunk.nodeIds);
    expect(ids).toContain('flow-3');
    // 有 id 的保持原值
    expect(ids).toContain('p-1');
    // key 全局唯一
    expect(new Set(first.map((chunk) => chunk.key)).size).toBe(first.length);
  });

  it('字数上限先到也切块', () => {
    const doc = createEmptyDocument({ title: '长文' });
    doc.root.children = [
      {
        id: 'chap-long',
        type: 'chapter',
        children: [
          paragraph('a', '一'.repeat(40)),
          paragraph('b', '二'.repeat(40)),
          paragraph('c', '三'.repeat(40)),
        ],
      },
    ];
    const chunks = buildFlowChunks(doc, { maxCharsPerChunk: 50 });
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.nodeIds).toEqual(['a', 'b']);
    expect(chunks[1]?.nodeIds).toEqual(['c']);
  });

  it('空文档与无块容器返回空列表', () => {
    const doc = createEmptyDocument({ title: '空' });
    expect(buildFlowChunks(doc)).toEqual([]);

    doc.root.children = [{ id: 'chap-empty', type: 'chapter', children: [] }];
    expect(buildFlowChunks(doc)).toEqual([]);
  });
});

describe('Reader 流式 API', () => {
  it('getFlowChunks 命中缓存并在换文档后失效', () => {
    const reader = createReader();
    const first = reader.getFlowChunks();
    expect(reader.getFlowChunks()).toBe(first);

    reader.loadDocument(sampleDoc());
    expect(reader.getFlowChunks()).not.toBe(first);
  });

  it('getFlowChunkIndex 支持块 id 与章 id', () => {
    const reader = createReader();
    // 默认选项下第一章 5 块即一片，第二章是第二片
    expect(reader.getFlowChunkIndex('p-1')).toBe(0);
    expect(reader.getFlowChunkIndex('p-4')).toBe(0);
    expect(reader.getFlowChunkIndex('chap-2')).toBe(1);
    expect(reader.getFlowChunkIndex('missing')).toBeUndefined();

    // 选项变化后缓存重算，分片更细
    expect(reader.getFlowChunkIndex('p-4', { maxBlocksPerChunk: 3 })).toBe(1);
  });

  it('getNode 取块与容器，未命中返回 undefined', () => {
    const reader = createReader();
    expect(reader.getNode('p-2')?.type).toBe('paragraph');
    expect(reader.getNode('chap-1')?.type).toBe('chapter');
    expect(reader.getNode('nope')).toBeUndefined();
  });

  it('getPositionForNode 的锚点可被 restorePosition 命中', () => {
    const reader = createReader();
    const position = reader.getPositionForNode('p-4');
    expect(position?.anchor).toEqual({ type: 'block', nodeId: 'p-4' });
    expect(position?.pageIndex).toBe(reader.getPageOfNode('p-4'));
    expect(position?.progress).toBeGreaterThan(0);
    expect(position?.progress).toBeLessThanOrEqual(1);

    expect(reader.restorePosition(position!)).toBe(true);
    expect(reader.currentPage).toBe(reader.getPageOfNode('p-4'));
  });

  it('容器 id 取位置落在首个块；不存在的节点返回 undefined', () => {
    const reader = createReader();
    const position = reader.getPositionForNode('chap-2');
    expect(position?.anchor).toEqual({ type: 'block', nodeId: 'h-2' });
    expect(reader.getPositionForNode('missing')).toBeUndefined();
    expect(reader.getPositionForNode('chap-empty')).toBeUndefined();
  });
});
