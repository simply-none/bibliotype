/**
 * E2 分卷导出：按 volume 切分、目录隔离、无卷退化为单本
 */
import { describe, expect, it } from 'vitest';
import { NODE_TYPES, createEmptyDocument, type BookDocument } from '@bibliotype/core';
import { strFromU8, unzipSync } from 'fflate';
import { exportEpub } from '../epub.js';
import { exportEpubVolumes } from '../volumes.js';

const FIXED_MODIFIED = '2026-01-02T00:00:00Z';

function paragraph(id: string, text: string) {
  return { type: NODE_TYPES.PARAGRAPH, id, children: [{ type: 'text' as const, text }] };
}

function twoVolumeDoc(): BookDocument {
  const doc = createEmptyDocument({
    title: '文集',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  });
  doc.root.children = [
    {
      type: NODE_TYPES.VOLUME,
      id: 'v-1',
      attrs: { title: '卷一' },
      children: [
        {
          type: NODE_TYPES.CHAPTER,
          id: 'c-1',
          attrs: { title: '第一章' },
          children: [paragraph('p-1', '卷一正文')],
        },
      ],
    },
    {
      type: NODE_TYPES.VOLUME,
      id: 'v-2',
      attrs: { title: '卷二' },
      children: [
        {
          type: NODE_TYPES.CHAPTER,
          id: 'c-2',
          attrs: { title: '第二章' },
          children: [paragraph('p-2', '卷二正文')],
        },
      ],
    },
  ];
  return doc;
}

function readEntry(bytes: Uint8Array, suffix: string): string | undefined {
  const files = unzipSync(bytes);
  const key = Object.keys(files).find((name) => name.endsWith(suffix));
  return key === undefined ? undefined : strFromU8(files[key]!);
}

describe('exportEpubVolumes', () => {
  it('两卷文档产出两个 EPUB，文件名含卷名', () => {
    const outputs = exportEpubVolumes(twoVolumeDoc(), { modified: FIXED_MODIFIED });
    expect(outputs).toHaveLength(2);
    expect(outputs[0]?.name).toBe('1-卷一.epub');
    expect(outputs[1]?.name).toBe('2-卷二.epub');
    expect(outputs[0]?.index).toBe(0);
    expect(outputs[1]?.index).toBe(1);
    expect(outputs[0]?.bytes.byteLength).toBeGreaterThan(0);
    expect(outputs[1]?.bytes.byteLength).toBeGreaterThan(0);
  });

  it('各卷目录只含本卷章节', () => {
    const outputs = exportEpubVolumes(twoVolumeDoc(), { modified: FIXED_MODIFIED });
    const firstNav = readEntry(outputs[0]!.bytes, 'nav.xhtml') ?? '';
    const secondNav = readEntry(outputs[1]!.bytes, 'nav.xhtml') ?? '';
    expect(firstNav).toContain('第一章');
    expect(firstNav).not.toContain('第二章');
    expect(secondNav).toContain('第二章');
    expect(secondNav).not.toContain('第一章');
  });

  it('无卷文档返回单卷，产物与 exportEpub 一致', () => {
    const doc = createEmptyDocument({
      title: '单本',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
    doc.root.children = [paragraph('p-1', '正文')];
    const outputs = exportEpubVolumes(doc, { modified: FIXED_MODIFIED });
    expect(outputs).toHaveLength(1);
    expect(outputs[0]?.name).toBe('单本.epub');
    expect(outputs[0]?.bytes).toEqual(exportEpub(doc, { modified: FIXED_MODIFIED }));
  });

  it('各卷标识符不同且确定（同输入重复导出一致）', () => {
    const doc = twoVolumeDoc();
    const first = exportEpubVolumes(doc, { modified: FIXED_MODIFIED });
    const second = exportEpubVolumes(doc, { modified: FIXED_MODIFIED });
    const idOf = (bytes: Uint8Array): string => {
      const opf = readEntry(bytes, 'content.opf') ?? '';
      return /<dc:identifier[^>]*>([^<]+)</.exec(opf)?.[1] ?? '';
    };
    expect(idOf(first[0]!.bytes)).not.toBe(idOf(first[1]!.bytes));
    expect(idOf(first[0]!.bytes)).toBe(idOf(second[0]!.bytes));
  });
});
