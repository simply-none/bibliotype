/**
 * 统一错误基类测试（I8）
 *
 * 覆盖：基类字段、isBibliotypeError（含负例与跨实例品牌）、错误码表稳定、
 * 序列化 / 反序列化往返（含 cause 链与非 Error cause）、既有错误类兼容
 * （instanceof Error / 原 name / 原 message / 新增 code 与 details）。
 */
import { describe, expect, it } from 'vitest';
import {
  BIBLIOTYPE_ERROR_CODES,
  BibliotypeError,
  CRYPTO_ERROR_CODES,
  CryptoError,
  MigrationPathError,
  NodeTypeConflictError,
  PluginConflictError,
  BookPackError,
  BOOK_PACK_ERROR_CODES,
  deserializeBibliotypeError,
  isBibliotypeError,
  migrateDocument,
  serializeBibliotypeError,
} from '../index';

describe('BibliotypeError 基类', () => {
  it('携带 code / details / hint / cause，name 为 BibliotypeError', () => {
    const cause = new Error('根因');
    const error = new BibliotypeError('TEST_CODE', '测试错误', {
      details: { key: 'value', count: 3 },
      hint: '修复建议',
      cause,
    });
    expect(error.name).toBe('BibliotypeError');
    expect(error.code).toBe('TEST_CODE');
    expect(error.message).toBe('测试错误');
    expect(error.details).toEqual({ key: 'value', count: 3 });
    expect(error.hint).toBe('修复建议');
    expect(error.cause).toBe(cause);
    expect(error instanceof Error).toBe(true);
  });

  it('缺省 options 时 details / hint / cause 均为 undefined', () => {
    const error = new BibliotypeError('TEST_CODE', '测试错误');
    expect(error.details).toBeUndefined();
    expect(error.hint).toBeUndefined();
    expect(error.cause).toBeUndefined();
  });
});

describe('isBibliotypeError', () => {
  it('基类与子类实例判定为真', () => {
    expect(isBibliotypeError(new BibliotypeError('A', 'a'))).toBe(true);
    expect(isBibliotypeError(new CryptoError(CRYPTO_ERROR_CODES.WRONG_KEY, '口令错误'))).toBe(true);
    expect(isBibliotypeError(new PluginConflictError('demo'))).toBe(true);
  });

  it('负例：普通 Error / 原始值 / 缺 code 的对象均判定为假', () => {
    expect(isBibliotypeError(new Error('普通错误'))).toBe(false);
    expect(isBibliotypeError('BibliotypeError')).toBe(false);
    expect(isBibliotypeError(null)).toBe(false);
    expect(isBibliotypeError(undefined)).toBe(false);
    expect(isBibliotypeError({ code: 'FAKE' })).toBe(false);
    expect(isBibliotypeError({ code: 123 })).toBe(false);
  });
});

describe('错误码表稳定（I8）', () => {
  it('登记码与契约一致，不得漂移', () => {
    expect(BIBLIOTYPE_ERROR_CODES.PLUGIN_CONFLICT).toBe('PLUGIN_CONFLICT');
    expect(BIBLIOTYPE_ERROR_CODES.NODE_TYPE_CONFLICT).toBe('NODE_TYPE_CONFLICT');
    expect(BIBLIOTYPE_ERROR_CODES.MIGRATION_PATH_MISSING).toBe('MIGRATION_PATH_MISSING');
    expect(BIBLIOTYPE_ERROR_CODES.EDITOR_SPEC_CONFLICT).toBe('EDITOR_SPEC_CONFLICT');
    expect(BIBLIOTYPE_ERROR_CODES.HTTP_REQUEST_FAILED).toBe('HTTP_REQUEST_FAILED');
  });

  it('既有稳定码（CryptoError / BookPackError）保持原值', () => {
    expect(new CryptoError(CRYPTO_ERROR_CODES.WRONG_KEY, '口令错误').code).toBe('WRONG_KEY');
    expect(new BookPackError(BOOK_PACK_ERROR_CODES.INVALID_MANIFEST, '清单非法').code).toBe('INVALID_MANIFEST');
  });
});

describe('序列化往返（I8）', () => {
  it('code / details / hint / name / message 全量还原', () => {
    const error = new BibliotypeError('TEST_CODE', '测试错误', {
      details: { key: 'value' },
      hint: '修复建议',
    });
    const roundTrip = deserializeBibliotypeError(JSON.parse(JSON.stringify(serializeBibliotypeError(error))));
    expect(roundTrip).toBeInstanceOf(BibliotypeError);
    expect(roundTrip.name).toBe('BibliotypeError');
    expect(roundTrip.code).toBe('TEST_CODE');
    expect(roundTrip.message).toBe('测试错误');
    expect(roundTrip.details).toEqual({ key: 'value' });
    expect(roundTrip.hint).toBe('修复建议');
  });

  it('cause 链：统一错误递归还原，普通 Error 退化为 { name, message }', () => {
    const root = new Error('根因');
    const mid = new BibliotypeError('MID_CODE', '中间层', { cause: root });
    const top = new BibliotypeError('TOP_CODE', '顶层', { cause: mid });
    const roundTrip = deserializeBibliotypeError(JSON.parse(JSON.stringify(serializeBibliotypeError(top))));
    expect(roundTrip.cause).toBeInstanceOf(BibliotypeError);
    const midRestored = roundTrip.cause as BibliotypeError;
    expect(midRestored.code).toBe('MID_CODE');
    expect(midRestored.cause).toBeInstanceOf(Error);
    expect((midRestored.cause as Error).message).toBe('根因');
  });

  it('非 Error 的 cause 转为 { message } 字符串', () => {
    const error = new BibliotypeError('A', 'a', { cause: '字符串根因' });
    const payload = serializeBibliotypeError(error);
    expect(payload.cause?.message).toBe('字符串根因');
  });

  it('负例：非统一错误序列化抛 TypeError', () => {
    expect(() => serializeBibliotypeError(new Error('普通错误'))).toThrow(TypeError);
    expect(() => serializeBibliotypeError('oops')).toThrow(TypeError);
    expect(() => serializeBibliotypeError(null)).toThrow(TypeError);
  });

  it('负例：非法载荷反序列化抛统一错误', () => {
    expect(() => deserializeBibliotypeError('not-object')).toThrow(BibliotypeError);
    expect(() => deserializeBibliotypeError({})).toThrow(BibliotypeError);
    expect(() => deserializeBibliotypeError({ message: '缺 code' })).toThrow(BibliotypeError);
  });
});

describe('既有错误类兼容（I8）', () => {
  it('PluginConflictError：旧断言仍过，新增 code / details / hint', () => {
    const error = new PluginConflictError('demo');
    expect(error instanceof Error).toBe(true);
    expect(error instanceof BibliotypeError).toBe(true);
    expect(error.name).toBe('PluginConflictError');
    expect(error.message).toBe('插件 "demo" 已安装。请勿重复安装同名插件。');
    expect(error.code).toBe(BIBLIOTYPE_ERROR_CODES.PLUGIN_CONFLICT);
    expect(error.details).toEqual({ name: 'demo' });
    expect(typeof error.hint).toBe('string');
  });

  it('NodeTypeConflictError：旧断言仍过，新增 code / details', () => {
    const error = new NodeTypeConflictError('paragraph');
    expect(error instanceof Error).toBe(true);
    expect(error.name).toBe('NodeTypeConflictError');
    expect(error.message).toContain('节点类型 "paragraph" 已被注册');
    expect(error.code).toBe(BIBLIOTYPE_ERROR_CODES.NODE_TYPE_CONFLICT);
    expect(error.details).toEqual({ type: 'paragraph' });
  });

  it('MigrationPathError：缺步抛错带 details { from, to }', () => {
    const document = { schemaVersion: '9.9.9', root: { type: 'book', id: 'root', children: [] } } as never;
    let caught: unknown;
    try {
      migrateDocument(document, { targetVersion: '0.2.0' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MigrationPathError);
    const migrationError = caught as MigrationPathError;
    expect(migrationError instanceof BibliotypeError).toBe(true);
    expect(migrationError.code).toBe(BIBLIOTYPE_ERROR_CODES.MIGRATION_PATH_MISSING);
    expect(migrationError.details?.from).toBe('9.9.9');
    expect(migrationError.details?.to).toBe('0.2.0');
  });
});
