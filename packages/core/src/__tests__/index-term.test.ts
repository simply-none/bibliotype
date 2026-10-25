/**
 * K4 索引词标记：常量、0.3.0 迁移、term 校验
 */
import { describe, expect, it } from 'vitest';
import { IR_SCHEMA_VERSION } from '../ir/document.js';
import {
  DOCUMENT_ISSUE_CODES,
  MARK_TYPES,
  NODE_TYPES,
  createEmptyDocument,
  migrateDocument,
  validateDocument,
  type BookDocument,
} from '../index.js';

function documentWithMark(term: unknown): BookDocument {
  const doc = createEmptyDocument({ title: '索引词' });
  doc.root.children = [
    {
      type: NODE_TYPES.PARAGRAPH,
      id: 'p-1',
      children: [
        {
          type: NODE_TYPES.TEXT,
          text: '朱熹',
          marks: [{ type: MARK_TYPES.INDEX_TERM, attrs: { term: term as string } }],
        },
      ],
    },
  ];
  return doc;
}

describe('index-term 契约', () => {
  it('标记常量与 0.3.0 版本', () => {
    expect(MARK_TYPES.INDEX_TERM).toBe('index-term');
    const doc = createEmptyDocument({ title: '版本' });
    expect(doc.schemaVersion).toBe(IR_SCHEMA_VERSION);
  });

  it('0.2.0 → 0.3.0 空迁移', () => {
    const legacy: BookDocument = { ...createEmptyDocument({ title: '旧书' }), schemaVersion: '0.2.0' };
    const result = migrateDocument(legacy);
    /* 0.3.0 → 0.4.0（夹注行内化）并入 */
    expect(result.applied).toHaveLength(2);
    expect(result.applied[0]?.from).toBe('0.2.0');
    expect(result.toVersion).toBe(IR_SCHEMA_VERSION);
    expect(result.document.schemaVersion).toBe(IR_SCHEMA_VERSION);
  });

  it('term 非空时校验通过', () => {
    const result = validateDocument(documentWithMark('朱熹'));
    expect(result.errors).toHaveLength(0);
  });

  it('term 为空串时上报 invalid-index-term', () => {
    const result = validateDocument(documentWithMark('   '));
    expect(
      result.errors.some((issue) => issue.code === DOCUMENT_ISSUE_CODES.INVALID_INDEX_TERM),
    ).toBe(true);
  });
});
