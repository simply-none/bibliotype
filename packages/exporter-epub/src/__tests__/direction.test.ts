/**
 * 翻页方向与 EPUB 2 guide：直排书 RTL、横排保持缺省、guide 仅 EPUB 2 输出。
 */
import { describe, expect, it } from 'vitest';
import { NODE_TYPES, createEmptyDocument, type BookDocument } from '@bibliotype/core';
import { CLASSICAL_LAYOUT_OPTIONS } from '@bibliotype/layout';
import { strFromU8, unzipSync } from 'fflate';
import { exportEpub } from '../epub.js';

const FIXED_MODIFIED = '2024-01-01T00:00:00Z';

function sampleDoc(): BookDocument {
  const doc = createEmptyDocument({ title: '论语' });
  doc.root.children = [
    {
      type: NODE_TYPES.CHAPTER,
      id: 'chap-1',
      attrs: { title: '学而第一' },
      children: [
        {
          type: NODE_TYPES.PARAGRAPH,
          id: 'p-1',
          children: [{ type: NODE_TYPES.TEXT, text: '子曰：学而时习之。' }],
        },
      ],
    },
  ];
  return doc;
}

function readEntries(bytes: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, data] of Object.entries(unzipSync(bytes))) out[name] = strFromU8(data);
  return out;
}

function opfOf(bytes: Uint8Array): string {
  return readEntries(bytes)['OEBPS/content.opf'] ?? '';
}

describe('翻页方向', () => {
  it('直排（vertical-rl）默认 page-progression-direction="rtl"', () => {
    const opf = opfOf(
      exportEpub(sampleDoc(), { modified: FIXED_MODIFIED, layout: CLASSICAL_LAYOUT_OPTIONS }),
    );
    expect(opf).toContain('page-progression-direction="rtl"');
  });

  it('横排缺省不输出该属性（EPUB 缺省 ltr）', () => {
    const opf = opfOf(exportEpub(sampleDoc(), { modified: FIXED_MODIFIED }));
    expect(opf).not.toContain('page-progression-direction');
  });

  it('可显式覆盖：横排版式也能强制 rtl', () => {
    const opf = opfOf(
      exportEpub(sampleDoc(), { modified: FIXED_MODIFIED, pageDirection: 'rtl' }),
    );
    expect(opf).toContain('page-progression-direction="rtl"');
  });

  it('显式 ltr 覆盖直排版式的推导值', () => {
    const opf = opfOf(
      exportEpub(sampleDoc(), {
        modified: FIXED_MODIFIED,
        layout: CLASSICAL_LAYOUT_OPTIONS,
        pageDirection: 'ltr',
      }),
    );
    expect(opf).not.toContain('page-progression-direction');
  });
});

describe('EPUB 2 guide', () => {
  it('EPUB 2 输出 toc / text 两个引用', () => {
    const opf = opfOf(
      exportEpub(sampleDoc(), { modified: FIXED_MODIFIED, version: '2.0' }),
    );
    expect(opf).toContain('<guide>');
    expect(opf).toContain('<reference type="toc" href="nav.xhtml" title="目录"/>');
    expect(opf).toContain('<reference type="text" href="text/sec-0.xhtml" title="正文"/>');
  });

  it('EPUB 3 不输出 guide（已由 nav landmarks 取代）', () => {
    const opf = opfOf(exportEpub(sampleDoc(), { modified: FIXED_MODIFIED }));
    expect(opf).not.toContain('<guide>');
  });
});
