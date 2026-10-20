/**
 * K4 索引附录导出：导出期追加「索引」章、跨文件回跳、可关闭
 */
import {
  MARK_TYPES,
  NODE_TYPES,
  createEmptyDocument,
  type BookDocument,
  type BookNode,
} from '@bibliotype/core';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { exportEpub } from '../epub.js';

function indexText(text: string, term: string): BookNode {
  return {
    type: NODE_TYPES.TEXT,
    text,
    marks: [{ type: MARK_TYPES.INDEX_TERM, attrs: { term } }],
  };
}

function sampleDoc(): BookDocument {
  const doc = createEmptyDocument({ title: '索引样本' });
  doc.root.children = [
    {
      type: NODE_TYPES.CHAPTER,
      id: 'ch-1',
      attrs: { title: '第一章' },
      children: [
        {
          type: NODE_TYPES.PARAGRAPH,
          id: 'p-1',
          children: [indexText('朱熹', '朱熹')],
        },
      ],
    },
    {
      type: NODE_TYPES.CHAPTER,
      id: 'ch-2',
      attrs: { title: '第二章' },
      children: [
        {
          type: NODE_TYPES.PARAGRAPH,
          id: 'p-2',
          children: [indexText('礼', '礼')],
        },
      ],
    },
  ];
  return doc;
}

function xhtmlFiles(bytes: Uint8Array): Array<[string, string]> {
  const files = unzipSync(bytes);
  return Object.entries(files)
    .filter(([name]) => name.endsWith('.xhtml'))
    .map(([name, data]) => [name, strFromU8(data)]);
}

describe('EPUB 索引附录', () => {
  it('追加索引章并生成跨文件回跳链接', () => {
    const bytes = exportEpub(sampleDoc(), { modified: '2026-01-02T00:00:00Z' });
    const files = xhtmlFiles(bytes);
    /* 书名可能含「索引」，故按「同时含两个词条 + 跨文件链接」定位附录文件 */
    const index = files.find(
      ([, html]) =>
        html.includes('朱熹') && html.includes('礼') && html.includes('href="text/sec-'),
    );
    expect(index).toBeDefined();

    const html = index?.[1] ?? '';
    expect(html).toContain('text/sec-');
  });

  it('调用方附录的 # 锚点改写为跨文件地址', () => {
    const appendix = {
      type: NODE_TYPES.APPENDIX,
      id: 'collation-summary',
      attrs: { title: '校勘记' },
      children: [
        { type: NODE_TYPES.HEADING, attrs: { level: 1 }, children: [{ type: 'text', text: '校勘记' }] },
        {
          type: NODE_TYPES.PARAGRAPH,
          children: [
            {
              type: NODE_TYPES.TEXT,
              text: '1',
              marks: [{ type: MARK_TYPES.LINK, attrs: { href: '#p-1' } }],
            },
          ],
        },
      ],
    };
    const bytes = exportEpub(sampleDoc(), {
      modified: '2026-01-02T00:00:00Z',
      includeIndex: false,
      appendices: [appendix],
    });
    const files = xhtmlFiles(bytes);
    /* nav.xhtml 也含附录标题，按附录节点的 id 定位正文文件 */
    const summary = files.find(([, html]) => html.includes('id="collation-summary"'));
    expect(summary).toBeDefined();
    expect(summary?.[1]).toMatch(/href="text\/sec-\d+\.xhtml#p-1"/);
  });

  it('includeIndex=false 时不追加索引章', () => {
    const bytes = exportEpub(sampleDoc(), {
      modified: '2026-01-02T00:00:00Z',
      includeIndex: false,
    });
    expect(
      xhtmlFiles(bytes).some(([, html]) => html.includes('朱熹') && html.includes('礼')),
    ).toBe(false);
  });
});
