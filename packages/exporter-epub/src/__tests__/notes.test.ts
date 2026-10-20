/**
 * 注释块导出语义：EPUB 3 输出 `epub:type`，EPUB 2 不输出。
 */
import { describe, expect, it } from 'vitest';
import { MARK_TYPES, NODE_TYPES, createEmptyDocument, type BookDocument } from '@bibliotype/core';
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
          children: [
            { type: NODE_TYPES.TEXT, text: '子曰：学而时习之。' },
            {
              type: NODE_TYPES.TEXT,
              text: '1',
              marks: [
                { type: MARK_TYPES.NOTE_REF, attrs: { targetId: 'fn-1', refId: 'ref-1' } },
              ],
            },
          ],
        },
        {
          type: NODE_TYPES.FOOTNOTE,
          id: 'fn-1',
          attrs: { marker: '1', refId: 'ref-1' },
          children: [
            {
              type: NODE_TYPES.PARAGRAPH,
              children: [{ type: NODE_TYPES.TEXT, text: '习，鸟数飞也。' }],
            },
          ],
        },
        {
          type: NODE_TYPES.ENDNOTE,
          id: 'en-1',
          attrs: { marker: '1' },
          children: [
            {
              type: NODE_TYPES.PARAGRAPH,
              children: [{ type: NODE_TYPES.TEXT, text: '篇末注。' }],
            },
          ],
        },
      ],
    },
  ];
  return doc;
}

function readEntries(bytes: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, data] of Object.entries(unzipSync(bytes))) {
    out[name] = strFromU8(data);
  }
  return out;
}

describe('EPUB 注释块', () => {
  it('EPUB 3 内容文档带 epub:type 与注码，章节壳声明 xmlns:epub', () => {
    const files = readEntries(exportEpub(sampleDoc(), { modified: FIXED_MODIFIED }));
    const body = files['OEBPS/text/sec-0.xhtml'] ?? '';

    expect(body).toContain('xmlns:epub="http://www.idpf.org/2007/ops"');
    expect(body).toContain('<aside id="fn-1" class="bt-footnote" epub:type="footnote">');
    expect(body).toContain('<aside id="en-1" class="bt-endnote" epub:type="endnote">');
    expect(body).toContain('<span class="bt-note-marker">1</span>习，鸟数飞也。');
    /* 正文引用与注文回跳成对输出 */
    expect(body).toContain(
      '<a id="ref-1" class="bt-mark-noteref" href="#fn-1" epub:type="noteref">1</a>',
    );
    expect(body).toContain('<a class="bt-note-backref" href="#ref-1">↩</a>');
    /* 注文未混入正文段落 */
    expect(body).toContain('<p id="p-1" class="bt-paragraph">子曰：学而时习之。');
  });

  it('EPUB 2 不输出 epub:type（老引擎不认该属性）', () => {
    const files = readEntries(
      exportEpub(sampleDoc(), { modified: FIXED_MODIFIED, version: '2.0' }),
    );
    const body = files['OEBPS/text/sec-0.xhtml'] ?? '';

    expect(body).toContain('class="bt-footnote"');
    expect(body).not.toContain('epub:type="footnote"');
    expect(body).not.toContain('epub:type="endnote"');
    /* 引用仍是可点击链接，只是不带 EPUB 3 语义属性 */
    expect(body).toContain('<a id="ref-1" class="bt-mark-noteref" href="#fn-1">1</a>');
    expect(body).not.toContain('epub:type="noteref"');
  });
});
