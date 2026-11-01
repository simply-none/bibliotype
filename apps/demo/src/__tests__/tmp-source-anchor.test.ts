/**
 * 临时验证：EPUB 导入产物携带源锚点（data-source-anchor → attrs.sourceAnchor）
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { epubToBookDocument } from '@bibliotype/import-epub';
import { buildClassicalEditorSchema } from '@bibliotype/classical/editor';

describe('导入产物源锚点（临时验证）', () => {
  it('目标标题块携带 attrs.sourceAnchor（复合键）', () => {
    const epubPath = 'C:/cod/note_npm/少有人走的路：心智成熟的旅程(1-8全套) The Road Less Traveled A New Psychology of Love, Traditional Values and Spiritual Growth (斯科特·派克,Scott Peck,于海生).epub';
    const buf = readFileSync(epubPath);
    const schema = buildClassicalEditorSchema();
    const doc = epubToBookDocument(new Uint8Array(buf), schema, { title: '验证' });

    let hit: { id: string; attrs: Record<string, unknown> } | null = null;
    const scan = (node: { type: string; id?: string; attrs?: Record<string, unknown>; children?: unknown[] }) => {
      if (hit !== null) return;
      const text = ((node.children ?? []) as { type: string; text?: string }[])
        .filter((c) => c.type === 'text')
        .map((c) => c.text ?? '')
        .join('');
      if (node.type === 'heading' && /第一部分\s+自律/.test(text)) {
        hit = { id: node.id ?? '', attrs: node.attrs ?? {} };
        return;
      }
      for (const child of (node.children ?? []) as never[]) scan(child);
    };
    scan(doc.root as never);
    console.log('heading hit:', JSON.stringify(hit));
    expect(hit).not.toBeNull();
    expect((hit as unknown as { attrs: Record<string, unknown> }).attrs.sourceAnchor).toBe(
      'text/part0006.html#sigil_toc_id_6',
    );
  });
});
