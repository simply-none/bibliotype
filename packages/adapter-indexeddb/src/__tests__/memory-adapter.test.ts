/**
 * MemoryAdapter 测试
 *
 * 通用行为由公共契约套件覆盖（与 IndexedDbAdapter / 未来 sqlite 共用同一口径），
 * 本文件只保留内存实现特有的断言。
 */
import { describe, expect, it } from 'vitest';
import { MemoryAdapter } from '../memory-adapter.js';
import { runStorageContractTests } from '@bibliotype/core/testing';

runStorageContractTests({
  name: 'MemoryAdapter（存储契约）',
  create: () => new MemoryAdapter(),
});

describe('MemoryAdapter 专有行为', () => {
  it('名称为 memory', () => {
    expect(new MemoryAdapter().name).toBe('memory');
  });
});
