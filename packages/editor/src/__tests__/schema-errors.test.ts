/**
 * 统一错误兼容测试（I8）：EditorSpecConflictError 并入 BibliotypeError 后，
 * 旧 instanceof 与 message 断言不变，新增 code / details / hint。
 */
import { BIBLIOTYPE_ERROR_CODES, BibliotypeError, isBibliotypeError } from '@bibliotype/core';
import { describe, expect, it } from 'vitest';
import { EditorSpecConflictError } from '../schema-registry';

describe('EditorSpecConflictError 统一错误兼容（I8）', () => {
  it('旧断言仍过：instanceof Error / name / message', () => {
    const error = new EditorSpecConflictError('node', 'paragraph');
    expect(error instanceof Error).toBe(true);
    expect(error.name).toBe('EditorSpecConflictError');
    expect(error.message).toBe('编辑器 节点规格 "paragraph" 已注册。');
  });

  it('新增：code / details / hint 与统一判定', () => {
    const error = new EditorSpecConflictError('mark', 'ruby');
    expect(error instanceof BibliotypeError).toBe(true);
    expect(isBibliotypeError(error)).toBe(true);
    expect(error.code).toBe(BIBLIOTYPE_ERROR_CODES.EDITOR_SPEC_CONFLICT);
    expect(error.details).toEqual({ kind: 'mark', type: 'ruby' });
    expect(typeof error.hint).toBe('string');
  });
});
