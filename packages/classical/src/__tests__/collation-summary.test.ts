/**
 * K2 校勘汇总表：编号排序、摘要截断、回跳链接
 */
import { MARK_TYPES, NODE_TYPES, createEmptyDocument, type BookDocument, type BookNode } from '@bibliotype/core';
import { describe, expect, it } from 'vitest';
import { buildCollationSummary, collectCollationEntries } from '../collation-summary.js';
import { CLASSICAL_NODE_TYPES } from '../node-types.js';

function note(id: string, marker: number | null, text: string): BookNode {
  return {
    type: CLASSICAL_NODE_TYPES.COLLATION_NOTE,
    id,
    ...(marker === null ? {} : { attrs: { marker } }),
    children: [
      {
        type: NODE_TYPES.PARAGRAPH,
        children: [{ type: 'text', text }],
      },
    ],
  };
}

function sampleDoc(): BookDocument {
  const doc = createEmptyDocument({ title: '校勘' });
  doc.root.children = [
    {
      type: NODE_TYPES.CHAPTER,
      id: 'ch-1',
      attrs: { title: '学而第一' },
      children: [
        note('fn-2', 2, '校本作「人」，底本作「仁」。'),
        note('fn-1', 1, '底本「习」下有一「之」字。'),
        note('fn-9', null, '未编号旧注。'),
      ],
    },
  ];
  return doc;
}

describe('collectCollationEntries', () => {
  it('按编号升序，未编号条目排最后', () => {
    const entries = collectCollationEntries(sampleDoc());
    expect(entries.map((entry) => entry.marker)).toEqual([1, 2, null]);
    expect(entries.map((entry) => entry.anchorId)).toEqual(['fn-1', 'fn-2', 'fn-9']);
  });

  it('摘要过长时截断', () => {
    const entries = collectCollationEntries(sampleDoc(), 5);
    expect(entries[0]?.text).toBe('底本「习」…');
  });
});

describe('buildCollationSummary', () => {
  it('生成 appendix 节点并把编号链接到注文', () => {
    const summary = buildCollationSummary(sampleDoc(), {
      hrefFor: (id) => `text/sec-3.xhtml#${id}`,
    });
    expect(summary.type).toBe(NODE_TYPES.APPENDIX);
    expect(summary.id).toBe('collation-summary');
    expect(summary.attrs?.['title']).toBe('校勘记');

    const firstEntry = summary.children?.[1];
    const marker = firstEntry?.children?.[0];
    expect(marker?.text).toContain('1');
    expect(marker?.marks?.[0]?.type).toBe(MARK_TYPES.LINK);
    expect(marker?.marks?.[0]?.attrs?.['href']).toBe('text/sec-3.xhtml#fn-1');
  });
});
