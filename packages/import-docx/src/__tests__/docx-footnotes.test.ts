// @vitest-environment happy-dom
/**
 * F5 脚注 HTML 归一化：引用 → noteref 链接、列表项 → footnote 容器
 */
import { NODE_TYPES, type BookNode } from '@bibliotype/core';
import { buildEditorSchema } from '@bibliotype/editor';
import { htmlToBookDocument } from '@bibliotype/import';
import { describe, expect, it } from 'vitest';
import { normalizeDocxFootnotes } from '../docx-html.js';

const MAMMOTH_HTML =
  '<p>正文中有注<sup><a href="#footnote-1" id="footnote-ref-1">1</a></sup>。</p>' +
  '<ol><li id="footnote-1"><p>注文内容 <a href="#footnote-ref-1">↑</a></p></li></ol>';

describe('normalizeDocxFootnotes', () => {
  it('引用转 noteref 链接，注文转 footnote 容器，空列表移除', () => {
    const html = normalizeDocxFootnotes(MAMMOTH_HTML);
    expect(html).toContain('class="bt-mark-noteref"');
    expect(html).toContain('href="#fn-docx-1"');
    expect(html).toContain('class="bt-footnote"');
    expect(html).toContain('data-marker="1"');
    expect(html).not.toContain('<ol>');
    expect(html).not.toContain('↑');
  });

  it('无脚注的 HTML 原样返回', () => {
    const html = '<p>普通段落</p>';
    expect(normalizeDocxFootnotes(html)).toBe(html);
  });
});

describe('归一化后的 HTML 回收为 IR', () => {
  function findNote(nodes: readonly BookNode[] | undefined): BookNode | undefined {
    for (const node of nodes ?? []) {
      if (node.type === NODE_TYPES.FOOTNOTE) return node;
      const found = findNote(node.children);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  it('产出 footnote 节点与 noteref 标记', () => {
    const schema = buildEditorSchema();
    const doc = htmlToBookDocument(normalizeDocxFootnotes(MAMMOTH_HTML), schema, { title: '脚注' });
    const note = findNote(doc.root.children);
    expect(note?.type).toBe(NODE_TYPES.FOOTNOTE);
    expect(note?.attrs?.['marker']).toBe(1);
    expect(note?.id).toBe('fn-docx-1');
    expect(note?.attrs?.['refId']).toBe('ref-docx-1');

    const text = JSON.stringify(doc.root);
    expect(text).toContain('noteref');
    expect(text).toContain('fn-docx-1');
  });
});
