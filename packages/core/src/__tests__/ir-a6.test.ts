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
    expect(result.applied).toHaveLength(2);
    expect(result.applied[0]?.from).toBe('0.1.0');
    expect(result.applied[1]?.from).toBe('0.2.0');
    expect(result.toVersion).toBe(IR_SCHEMA_VERSION);
    expect(result.document.schemaVersion).toBe(IR_SCHEMA_VERSION);
    expect(result.issues.filter((issue) => issue.severity === 'error')).toHaveLength(0);
  });
});
