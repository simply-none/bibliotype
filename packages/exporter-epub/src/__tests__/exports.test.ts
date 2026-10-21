/**
 * I9 SSR/Node 冒烟：node 环境（无 DOM）导入包入口，
 * 断言关键导出存在且顶层不触发 DOM 访问。
 */
import { describe, expect, it } from 'vitest';

describe('node 环境导入冒烟（exporter-epub）', () => {
  it(
    '导入前后均无 DOM 全局依赖（并行负载下动态导入较慢，放宽超时）',
    async () => {
      expect(typeof document).toBe('undefined');
      const ns = await import('../index');
      expect(typeof document).toBe('undefined');
      expect(Object.keys(ns).length).toBeGreaterThan(0);
    },
    30_000,
  );

  it('关键导出存在', async () => {
    const ns = await import('../index');
    expect(typeof ns.exportEpub).toBe('function');
    expect(typeof ns.validateEpub).toBe('function');
    expect(typeof ns.groupEndnotes).toBe('function');
  });
});
