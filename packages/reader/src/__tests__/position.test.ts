/**
 * 阅读位置快照测试：序列化、锚点定位、版式变化后恢复、锚点失效回退。
 */
import { describe, expect, it } from 'vitest';
import { createBlockAnchor, createEmptyDocument, createTextAnchor } from '@bibliotype/core';
import type { BookDocument } from '@bibliotype/core';
import { Reader } from '../reader.js';
import {
  READING_POSITION_SCHEMA_VERSION,
  createReadingPosition,
  parseReadingPosition,
  positionAnchorKey,
  serializeReadingPosition,
} from '../position.js';
import type { BlockSizeEstimator } from '../document-blocks.js';

const sizes: Record<string, number> = {
  'h-1': 30,
  'p-1': 60,
  'p-2': 60,
  'p-3': 60,
};

function estimator(): BlockSizeEstimator {
  return (node) => sizes[node.id ?? ''] ?? 60;
}

function sampleDoc(): BookDocument {
  const doc = createEmptyDocument({ title: '论语' });
  doc.root.children = [
    {
      id: 'chap-1',
      type: 'chapter',
      attrs: { title: '学而第一' },
      children: [
        { id: 'h-1', type: 'heading', children: [{ type: 'text', text: '学而第一' }] },
        { id: 'p-1', type: 'paragraph', children: [{ type: 'text', text: '子曰' }] },
        { id: 'p-2', type: 'paragraph', children: [{ type: 'text', text: '有朋自远方来' }] },
      ],
    },
    {
      id: 'chap-2',
      type: 'chapter',
      attrs: { title: '为政第二' },
      children: [{ id: 'p-3', type: 'paragraph', children: [{ type: 'text', text: '为政以德' }] }],
    },
  ];
  return doc;
}

function createReader(pageMainSize = 100): Reader {
  return new Reader({ pageMainSize, estimator: estimator() });
}

describe('位置快照序列化', () => {
  it('创建 / 序列化 / 解析往返一致', () => {
    const position = createReadingPosition(
      createBlockAnchor('p-2'),
      3,
      0.42,
      '2026-10-20T00:00:00.000Z',
    );
    const json = serializeReadingPosition(position);
    expect(parseReadingPosition(json)).toEqual(position);
    expect(positionAnchorKey(position)).toBe('bt:block:p-2');
  });

  it('文本锚点完整保留偏移', () => {
    const position = createReadingPosition(createTextAnchor('p-1', 2, 3), 1, 0.1);
    expect(parseReadingPosition(serializeReadingPosition(position))).toEqual(position);
  });

  it('缺省 savedAt 时快照不含该字段', () => {
    const position = createReadingPosition(createBlockAnchor('p-1'), 0, 0);
    expect(position.savedAt).toBeUndefined();
    expect(serializeReadingPosition(position)).not.toContain('savedAt');
  });

  it('非法参数抛 RangeError', () => {
    expect(() => createReadingPosition(createBlockAnchor('p-1'), -1, 0)).toThrow(RangeError);
    expect(() => createReadingPosition(createBlockAnchor('p-1'), 0, 1.5)).toThrow(RangeError);
  });

  it('非法 JSON / 缺锚点 / 缺页码抛 TypeError', () => {
    expect(() => parseReadingPosition('oops')).toThrow(TypeError);
    expect(() => parseReadingPosition('{"pageIndex":0}')).toThrow(TypeError);
    expect(() => parseReadingPosition('{"anchor":{"type":"block","nodeId":"p-1"}}')).toThrow(TypeError);
    expect(() =>
      parseReadingPosition(
        '{"anchor":{"type":"block","nodeId":"p-1"},"pageIndex":-2,"progress":0}',
      ),
    ).toThrow(TypeError);
  });

  it('schemaVersion 固定写入', () => {
    const position = createReadingPosition(createBlockAnchor('p-1'), 0, 0);
    expect(position.schemaVersion).toBe(READING_POSITION_SCHEMA_VERSION);
  });
});

describe('Reader 位置接口', () => {
  it('getPosition 以当前页首块为锚点', () => {
    const reader = createReader();
    reader.loadDocument(sampleDoc());
    const position = reader.getPosition({ savedAt: '2026-10-20T00:00:00.000Z' });
    expect(position?.anchor).toEqual(createBlockAnchor(reader.getPageBlocks(0)[0]?.id ?? ''));
    expect(position?.pageIndex).toBe(0);
    expect(position?.progress).toBeCloseTo(1 / reader.totalPages);
    expect(position?.savedAt).toBe('2026-10-20T00:00:00.000Z');
  });

  it('未载入文档时返回 undefined', () => {
    expect(new Reader().getPosition()).toBeUndefined();
  });

  it('翻页后位置随之变化并可恢复', () => {
    const reader = createReader();
    reader.loadDocument(sampleDoc());
    reader.nextPage();
    const savedPage = reader.currentPage;
    const position = reader.getPosition();
    const pageBlocks = reader.getPageBlocks(savedPage).map((block) => block.id);

    reader.goToPage(0);
    expect(reader.restorePosition(position!)).toBe(true);
    expect(reader.currentPage).toBe(savedPage);

    const restored = reader.getPageBlocks(reader.currentPage).map((block) => block.id);
    expect(restored).toEqual(pageBlocks);
  });

  it('接受 JSON 字符串', () => {
    const reader = createReader();
    reader.loadDocument(sampleDoc());
    reader.goToPage(reader.totalPages - 1);
    const json = serializeReadingPosition(reader.getPosition()!);
    reader.goToPage(0);
    expect(reader.restorePosition(json)).toBe(true);
    expect(reader.currentPage).toBe(reader.totalPages - 1);
  });

  it('版式变化（页容量改变）后按锚点而非页码恢复', () => {
    const reader = createReader(100);
    reader.loadDocument(sampleDoc());
    reader.goToPage(reader.totalPages - 1);
    const position = reader.getPosition()!;

    const before = reader.totalPages;
    reader.repaginate({ pageMainSize: 300 });
    // 章首强制换页，故仍为 2 页（但页数与页容量均已变化）
    expect(reader.totalPages).toBeLessThan(before);
    expect(reader.restorePosition(position)).toBe(true);
    // 锚点目标仍存在：定位到包含该块的页
    const anchorId = position.anchor.nodeId;
    expect(reader.getPageBlocks(reader.currentPage).some((block) => block.id === anchorId)).toBe(true);
  });

  it('锚点失效时回退快照页码（越界收敛到末页）', () => {
    const reader = createReader();
    reader.loadDocument(sampleDoc());
    const ghost = createReadingPosition(createBlockAnchor('deleted-node'), 1, 0.5);
    expect(reader.restorePosition(ghost)).toBe(true);
    expect(reader.currentPage).toBe(1);

    const beyond = createReadingPosition(createBlockAnchor('deleted-node'), 99, 1);
    expect(reader.restorePosition(beyond)).toBe(true);
    expect(reader.currentPage).toBe(reader.totalPages - 1);
  });

  it('空文档不可恢复', () => {
    const reader = new Reader();
    expect(reader.restorePosition(createReadingPosition(createBlockAnchor('p-1'), 0, 0))).toBe(false);
  });
});
