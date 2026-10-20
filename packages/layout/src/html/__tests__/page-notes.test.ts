import { describe, expect, it } from 'vitest';
import { NODE_TYPES, type BookNode } from '@bibliotype/core';
import { serializePageNotes } from '../page-notes.js';

function footnote(id: string, text: string): BookNode {
  return {
    type: NODE_TYPES.FOOTNOTE,
    id,
    children: [{ type: NODE_TYPES.PARAGRAPH, id: `${id}-p`, children: [{ type: 'text', text }] }],
  };
}

describe('serializePageNotes', () => {
  it('空注区返回空串', () => {
    expect(serializePageNotes([])).toBe('');
  });

  it('渲染注区容器与每条 bt-page-note', () => {
    const html = serializePageNotes([footnote('fn-1', '注一'), footnote('fn-2', '注二')]);
    expect(html).toContain('class="bt-page-notes"');
    expect(html).toContain('data-note-id="fn-1"');
    expect(html).toContain('class="bt-footnote"');
    expect((html.match(/class="bt-page-note"/g) ?? []).length).toBe(2);
  });

  it('续注输出「续前页」标记且可关闭', () => {
    const continued = serializePageNotes([footnote('fn-2', '注二')], { continued: true });
    expect(continued).toContain('bt-note-continued--prev');
    expect(continued).toContain('续前页');
    const none = serializePageNotes([footnote('fn-2', '注二')]);
    expect(none).not.toContain('bt-note-continued--prev');
  });

  it('超限仅打标记不裁剪注文', () => {
    const overflow = serializePageNotes([footnote('fn-1', '注一')], { overflow: true });
    expect(overflow).toContain('bt-page-notes--overflow');
    expect(overflow).toContain('data-overflow="true"');
    expect(overflow).toContain('注一');
  });
});
