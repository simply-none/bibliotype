/**
 * 尾注聚合：章末 / 书末重排、原文档不可变、脚注不受影响、导出接线。
 */
import { describe, expect, it } from 'vitest';
import { NODE_TYPES, createEmptyDocument, type BookDocument, type BookNode } from '@bibliotype/core';
import { strFromU8, unzipSync } from 'fflate';
import { groupEndnotes } from '../endnotes.js';
import { exportEpub } from '../epub.js';

const FIXED_MODIFIED = '2024-01-01T00:00:00Z';

function paragraph(text: string): BookNode {
  return { type: NODE_TYPES.PARAGRAPH, children: [{ type: NODE_TYPES.TEXT, text }] };
}

function endnote(text: string, id: string): BookNode {
  return { type: NODE_TYPES.ENDNOTE, id, attrs: { marker: '1' }, children: [paragraph(text)] };
}

function chapter(id: string, title: string, children: BookNode[]): BookNode {
  return { type: NODE_TYPES.CHAPTER, id, attrs: { title }, children };
}

function sampleRoot(): BookNode {
  return {
    type: NODE_TYPES.BOOK,
    children: [
      chapter('chap-1', '学而第一', [paragraph('甲'), endnote('尾注一', 'en-1'), paragraph('乙')]),
      chapter('chap-2', '为政第二', [paragraph('丙'), endnote('尾注二', 'en-2')]),
    ],
  };
}

function types(node: BookNode | undefined): string[] {
  return (node?.children ?? []).map((child) => child.type);
}

function textOf(node: BookNode | undefined): string {
  if (node === undefined) return '';
  if (node.type === NODE_TYPES.TEXT) return node.text ?? '';
  return (node.children ?? []).map(textOf).join('');
}

function sampleDocument(root: BookNode): BookDocument {
  const doc = createEmptyDocument({ title: '论语' });
  doc.root = root;
  return doc;
}

function readEntries(bytes: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, data] of Object.entries(unzipSync(bytes))) out[name] = strFromU8(data);
  return out;
}

describe('groupEndnotes：章末聚合', () => {
  it('尾注移到章末并加标题行，正文顺序不变', () => {
    const root = sampleRoot();
    const result = groupEndnotes(root, { scope: 'chapter' });

    expect(types(result.children?.[0])).toEqual([
      NODE_TYPES.PARAGRAPH,
      NODE_TYPES.PARAGRAPH,
      NODE_TYPES.HEADING,
      NODE_TYPES.ENDNOTE,
    ]);
    expect(textOf(result.children?.[0]?.children?.[2])).toBe('注释');
    expect(result.children?.[0]?.children?.[3]?.id).toBe('en-1');
  });

  it('原文档不被改动（深拷贝）', () => {
    const root = sampleRoot();
    groupEndnotes(root, { scope: 'chapter' });

    expect(types(root.children?.[0])).toEqual([
      NODE_TYPES.PARAGRAPH,
      NODE_TYPES.ENDNOTE,
      NODE_TYPES.PARAGRAPH,
    ]);
  });

  it('嵌在节内的尾注上提到章末；脚注保持就地', () => {
    const root: BookNode = {
      type: NODE_TYPES.BOOK,
      children: [
        chapter('chap-1', '章一', [
          {
            type: NODE_TYPES.SECTION,
            id: 'sec-1',
            attrs: { title: '节一' },
            children: [paragraph('节内'), endnote('节内尾注', 'en-1')],
          },
          { type: NODE_TYPES.FOOTNOTE, id: 'fn-1', attrs: { marker: '1' }, children: [paragraph('脚注')] },
        ]),
      ],
    };
    const result = groupEndnotes(root, { scope: 'chapter' });

    expect(types(result.children?.[0])).toEqual([
      NODE_TYPES.SECTION,
      NODE_TYPES.FOOTNOTE,
      NODE_TYPES.HEADING,
      NODE_TYPES.ENDNOTE,
    ]);
    expect(types(result.children?.[0]?.children?.[0])).toEqual([NODE_TYPES.PARAGRAPH]);
  });

  it('title 为空串不排标题行；自定义标题生效', () => {
    const plain = groupEndnotes(sampleRoot(), { scope: 'chapter', title: '' });
    expect(types(plain.children?.[0])).not.toContain(NODE_TYPES.HEADING);

    const custom = groupEndnotes(sampleRoot(), { scope: 'chapter', title: '校勘记' });
    expect(textOf(custom.children?.[0]?.children?.[2])).toBe('校勘记');
  });
});

describe('groupEndnotes：书末聚合', () => {
  it('全部尾注收到书末新增一章，正文各章不再含尾注', () => {
    const result = groupEndnotes(sampleRoot(), { scope: 'book' });

    expect(result.children).toHaveLength(3);
    expect(types(result.children?.[0])).not.toContain(NODE_TYPES.ENDNOTE);
    expect(result.children?.[2]?.type).toBe(NODE_TYPES.CHAPTER);
    expect(result.children?.[2]?.id).toBe('endnotes');
    expect(types(result.children?.[2])).toEqual([
      NODE_TYPES.HEADING,
      NODE_TYPES.ENDNOTE,
      NODE_TYPES.ENDNOTE,
    ]);
    expect(textOf(result.children?.[2])).toContain('尾注一');
  });

  it('id 冲突时追加后缀', () => {
    const root = sampleRoot();
    root.children?.push(chapter('endnotes', '既有附录', [paragraph('x')]));
    const result = groupEndnotes(root, { scope: 'book' });
    const children = result.children ?? [];
    expect(children[children.length - 1]?.id).toBe('endnotes-2');
  });

  it('没有尾注时原样返回（仍为克隆）', () => {
    const root: BookNode = {
      type: NODE_TYPES.BOOK,
      children: [chapter('chap-1', '章一', [paragraph('正文')])],
    };
    expect(groupEndnotes(root, { scope: 'book' })).toEqual(root);
  });
});

describe('exportEpub 尾注聚合选项', () => {
  it('chapter 范围：尾注排到章末标题行之后', () => {
    const doc = sampleDocument(sampleRoot());
    const files = readEntries(
      exportEpub(doc, { modified: FIXED_MODIFIED, endnoteGrouping: 'chapter' }),
    );
    const body = files['OEBPS/text/sec-0.xhtml'] ?? '';

    expect(body).toContain('epub:type="endnote"');
    expect(body).toContain('注释');
    expect(body.indexOf('甲')).toBeLessThan(body.indexOf('乙'));
    expect(body.indexOf('乙')).toBeLessThan(body.indexOf('尾注一'));
  });

  it('keep（缺省）不动尾注位置', () => {
    const doc = sampleDocument(sampleRoot());
    const files = readEntries(exportEpub(doc, { modified: FIXED_MODIFIED }));
    const body = files['OEBPS/text/sec-0.xhtml'] ?? '';
    expect(body.indexOf('尾注一')).toBeLessThan(body.indexOf('乙'));
  });
});
