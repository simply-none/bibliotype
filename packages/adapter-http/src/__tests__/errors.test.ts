/**
 * 统一错误兼容测试（I8）：HttpAdapterError 并入 BibliotypeError 后，
 * 旧 instanceof 与字段断言不变，新增 code / details / hint。
 */
import { BIBLIOTYPE_ERROR_CODES, BibliotypeError, isBibliotypeError } from '@bibliotype/core';
import { describe, expect, it } from 'vitest';
import { HttpAdapterError } from '../adapter';

describe('HttpAdapterError 统一错误兼容（I8）', () => {
  it('旧断言仍过：instanceof Error / status / path / name / message', () => {
    const error = new HttpAdapterError('请求失败', 404, '/documents');
    expect(error instanceof Error).toBe(true);
    expect(error.name).toBe('HttpAdapterError');
    expect(error.message).toBe('请求失败');
    expect(error.status).toBe(404);
    expect(error.path).toBe('/documents');
  });

  it('新增：code / details / hint 与统一判定', () => {
    const error = new HttpAdapterError('请求失败', 404, '/documents');
    expect(error instanceof BibliotypeError).toBe(true);
    expect(isBibliotypeError(error)).toBe(true);
    expect(error.code).toBe(BIBLIOTYPE_ERROR_CODES.HTTP_REQUEST_FAILED);
    expect(error.details).toEqual({ status: 404, path: '/documents' });
    expect(error.hint).toContain('404');
  });

  it('网络错误（status=0）hint 指向连通性排查', () => {
    const error = new HttpAdapterError('网络错误', 0, '/documents');
    expect(error.hint).toContain('网络');
  });
});
