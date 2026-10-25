/**
 * A6 IR 契约校验与迁移测试
 */
import { describe, expect, it } from 'vitest';
import { NODE_TYPES } from '../ir/node-types.js';
import { IR_SCHEMA_VERSION, createEmptyDocument } from '../ir/document.js';
import type { BookDocument } from '../ir/document.js';
import { DOCUMENT_ISSUE_CODES, validateDocument } from '../ir/validate.js';
import { migrateDocument } from '../ir/migrate.js';

function docWith(children: BookDocument['root']['children']): BookDocument {
  const doc = createEmptyDocument({ title: 'A6' });
  doc.root.children = children;
  return doc;
}

describe('A6 结构校验', () => {
  it('columns 超出 1~3 记 error', () => {
    const doc = docWith([
      {
        type: NODE_TYPES.CHAPTER,
        id: 'ch-1',
        attrs: { title: '章', columns: 4 },
        children: [{ type: NODE_TYPES.PARAGRAPH, id: 'p-1', children: [] }],
      },
    ]);
    const result = validateDocument(doc);
    expect(result.ok).toBe(false);
    expect(result.errors.some((issue) => issue.code === DOCUMENT_ISSUE_CODES.INVALID_ATTR_VALUE)).toBe(
      true,
    );
  });

  it('合法 columns 通过', () => {
    const doc = docWith([
      {
        type: NODE_TYPES.CHAPTER,
        id: 'ch-1',
        attrs: { title: '章', columns: 3 },
        children: [{ type: NODE_TYPES.PARAGRAPH, id: 'p-1', children: [] }],
      },
    ]);
    expect(validateDocument(doc).ok).toBe(true);
  });

  it('condition 空内容记 error', () => {
    const doc = docWith([
      { type: NODE_TYPES.CONDITION, id: 'cond-1', attrs: { when: 'platform=epub' }, children: [] },
    ]);
    const result = validateDocument(doc);
    expect(result.errors.some((issue) => issue.path.includes('children'))).toBe(true);
  });

  it('condition 非法表达式记 error', () => {
    const doc = docWith([
      {
        type: NODE_TYPES.CONDITION,
        id: 'cond-1',
        attrs: { when: 'platform==epub' },
        children: [{ type: NODE_TYPES.PARAGRAPH, id: 'p-1', children: [] }],
      },
    ]);
    const result = validateDocument(doc);
    expect(
      result.errors.some((issue) => issue.code === DOCUMENT_ISSUE_CODES.INVALID_ATTR_VALUE),
    ).toBe(true);
  });

  it('页眉重复记 error', () => {
    const doc = docWith([
      { type: NODE_TYPES.PAGE_HEADER, id: 'h-1', children: [] },
      { type: NODE_TYPES.PAGE_HEADER, id: 'h-2', children: [] },
    ]);
    const result = validateDocument(doc);
    expect(result.errors.some((issue) => issue.message.includes('至多一个'))).toBe(true);
  });

  it('页眉嵌套在章内记 error', () => {
    const doc = docWith([
      {
        type: NODE_TYPES.CHAPTER,
        id: 'ch-1',
        attrs: { title: '章' },
        children: [{ type: NODE_TYPES.PAGE_HEADER, id: 'h-1', children: [] }],
      },
    ]);
    const result = validateDocument(doc);
    expect(result.errors.some((issue) => issue.message.includes('直接子节点'))).toBe(true);
  });
});

describe('A6 迁移', () => {
  it('0.1.0 迁移到当前版本且旧结构保持合法', () => {
    const legacy: BookDocument = { ...createEmptyDocument({ title: '旧书' }), schemaVersion: '0.1.0' };
    const result = migrateDocument(legacy);
    /* 0.1.0 → 0.2.0 → 0.3.0 → 0.4.0（夹注行内化）三步 */
    expect(result.applied).toHaveLength(3);
    expect(result.applied[0]?.from).toBe('0.1.0');
    expect(result.applied[1]?.from).toBe('0.2.0');
    expect(result.applied[2]?.from).toBe('0.3.0');
    expect(result.toVersion).toBe(IR_SCHEMA_VERSION);
    expect(result.document.schemaVersion).toBe(IR_SCHEMA_VERSION);
    expect(result.issues.filter((issue) => issue.severity === 'error')).toHaveLength(0);
  });
});

describe('0.4.0 双行夹注行内化迁移', () => {
  /** 0.3.0 形态：章下块位夹注（编辑保存后的规范化「容器+段落」形态） */
  function legacyDoubleNoteDoc(): BookDocument {
    const doc = createEmptyDocument({ title: '夹注迁移' });
    doc.root = {
      type: NODE_TYPES.BOOK,
      children: [
        {
          type: NODE_TYPES.CHAPTER,
          id: 'c1',
          children: [
            {
              type: NODE_TYPES.PARAGRAPH,
              id: 'p1',
              children: [{ type: 'text', text: '正文一句。' }],
            },
            {
              type: 'double-note',
              id: 'dn1',
              children: [
                {
                  type: NODE_TYPES.PARAGRAPH,
                  children: [{ type: 'text', text: '注文六字。' }],
                },
              ],
            },
          ],
        },
      ],
    };
    return doc;
  }

  it('容器内段落展平为行内 children；块位夹注包一层段落', () => {
    const legacy = { ...legacyDoubleNoteDoc(), schemaVersion: '0.3.0' };
    const result = migrateDocument(legacy);
    expect(result.applied.map((step) => step.from)).toEqual(['0.3.0']);
    const chapter = result.document.root.children?.[0];
    const children = chapter?.children ?? [];
    /* 块位夹注已包段落：children = [p1, paragraph(double-note)] */
    expect(children.map((child) => child.type)).toEqual([
      NODE_TYPES.PARAGRAPH,
      NODE_TYPES.PARAGRAPH,
    ]);
    const wrap = children[1]!;
    const note = wrap.children?.[0]!;
    expect(note.type).toBe('double-note');
    expect(note.id).toBe('dn1'); /* id 保留 */
    /* 旧段落形态展平：夹注直接挂 text */
    expect(note.children?.[0]?.type).toBe('text');
    expect((note.children?.[0] as { text?: string }).text).toBe('注文六字。');
    /* 入参不可变 */
    expect((legacy.root.children?.[0] as { children?: unknown[] }).children).toHaveLength(2);
  });

  it('段内夹注（已行内位）原样保留，不重复包裹', () => {
    const doc = createEmptyDocument({ title: '段内' });
    doc.root = {
      type: NODE_TYPES.BOOK,
      children: [
        {
          type: NODE_TYPES.CHAPTER,
          children: [
            {
              type: NODE_TYPES.PARAGRAPH,
              children: [
                { type: 'text', text: '前文' },
                { type: 'double-note', id: 'dn-in', children: [{ type: 'text', text: '注' }] },
                { type: 'text', text: '后文' },
              ],
            },
          ],
        },
      ],
    };
    const result = migrateDocument({ ...doc, schemaVersion: '0.3.0' });
    const para = result.document.root.children?.[0]?.children?.[0]!;
    expect(para.children).toHaveLength(3);
    expect(para.children?.[1]?.type).toBe('double-note');
  });

  it('无夹注的 0.3.0 文档：迁移仅升版本号，结构逐字节等价', () => {
    const doc = createEmptyDocument({ title: '无夹注' });
    doc.root = {
      type: NODE_TYPES.BOOK,
      children: [
        { type: NODE_TYPES.CHAPTER, children: [{ type: NODE_TYPES.PARAGRAPH, children: [{ type: 'text', text: '文' }] }] },
      ],
    };
    const result = migrateDocument({ ...doc, schemaVersion: '0.3.0' });
    expect(result.document.root).toEqual(doc.root);
  });
});
