/**
 * 版本迁移测试：逐级迁移、缺环报错、迁移后校验、确定性。
 */
import { describe, expect, it } from 'vitest';
import {
  IR_SCHEMA_VERSION,
  LEGACY_SCHEMA_VERSION,
  MigrationPathError,
  createEmptyDocument,
  migrateDocument,
  readSchemaVersion,
} from '../index.js';
import type { MigrationStep, RawBookDocument } from '../index.js';

function legacyDocument(version: string): RawBookDocument {
  return {
    schemaVersion: version,
    metadata: { title: '论语' },
    root: { type: 'book', children: [] },
  };
}

const v0to1: MigrationStep = {
  from: '0.0.0',
  to: '0.1.0',
  description: '补齐卷节点',
  migrate: (doc) => ({ ...doc, metadata: { ...(doc.metadata as object), language: 'zh-Hant' } }),
};

describe('migrateDocument', () => {
  it('已是最新版本时不执行任何步骤', () => {
    const document = createEmptyDocument({ title: '论语' });
    const result = migrateDocument(document);
    expect(result.applied).toHaveLength(0);
    expect(result.fromVersion).toBe(IR_SCHEMA_VERSION);
    expect(result.toVersion).toBe(IR_SCHEMA_VERSION);
    expect(result.issues).toHaveLength(0);
  });

  it('按步骤逐级迁移并回填版本号', () => {
    const v1to2: MigrationStep = {
      from: '0.1.0',
      to: '0.2.0',
      migrate: (doc) => ({ ...doc, extra: true }),
    };
    const result = migrateDocument(legacyDocument(LEGACY_SCHEMA_VERSION), {
      targetVersion: '0.2.0',
      steps: [v0to1, v1to2],
    });
    expect(result.applied.map((step) => step.to)).toEqual(['0.1.0', '0.2.0']);
    expect(result.document.schemaVersion).toBe('0.2.0');
    expect(result.document.metadata.language).toBe('zh-Hant');
  });

  it('迁移链不通时抛 MigrationPathError', () => {
    expect(() => migrateDocument(legacyDocument('0.0.0'))).toThrow(MigrationPathError);
  });

  it('缺少 schemaVersion 的历史数据按 0.0.0 处理', () => {
    expect(readSchemaVersion({})).toBe(LEGACY_SCHEMA_VERSION);
    expect(readSchemaVersion(undefined)).toBe(LEGACY_SCHEMA_VERSION);
    expect(readSchemaVersion({ schemaVersion: '' })).toBe(LEGACY_SCHEMA_VERSION);
  });

  it('迁移后执行结构校验并返回问题', () => {
    const broken: MigrationStep = {
      from: '0.0.0',
      to: IR_SCHEMA_VERSION,
      migrate: (doc) => ({ ...doc, root: { type: 'book', children: [{ type: 'unknown-x' }] } }),
    };
    const result = migrateDocument(legacyDocument(LEGACY_SCHEMA_VERSION), { steps: [broken] });
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues[0]?.code).toBe('unknown-node-type');
  });

  it('validate:false 跳过校验', () => {
    const broken: MigrationStep = {
      from: '0.0.0',
      to: IR_SCHEMA_VERSION,
      migrate: (doc) => ({ ...doc, root: { type: 'book', children: [{ type: 'unknown-x' }] } }),
    };
    const result = migrateDocument(legacyDocument(LEGACY_SCHEMA_VERSION), {
      steps: [broken],
      validate: false,
    });
    expect(result.issues).toHaveLength(0);
  });

  it('非对象输入抛 TypeError', () => {
    expect(() => migrateDocument(null)).toThrow(TypeError);
    expect(() => migrateDocument([])).toThrow(TypeError);
  });
});
