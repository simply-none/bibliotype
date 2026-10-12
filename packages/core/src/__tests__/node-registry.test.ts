/**
 * 节点注册表测试
 */
import { describe, expect, it } from 'vitest';
import { NodeTypeRegistry, NodeTypeConflictError } from '../node/node-registry.js';
import type { NodeTypeDefinition } from '../node/node-type.js';

const paragraph: NodeTypeDefinition = {
  type: 'paragraph',
  namespace: 'core',
  kind: 'block',
  isContainer: true,
};

const jiaozhu: NodeTypeDefinition = {
  type: 'jiaozhu',
  namespace: 'classical',
  kind: 'block',
  isContainer: true,
  description: '夹注',
};

describe('NodeTypeRegistry', () => {
  it('注册并查询节点类型', () => {
    const registry = new NodeTypeRegistry();
    registry.register(paragraph);
    expect(registry.has('paragraph')).toBe(true);
    expect(registry.get('paragraph')?.namespace).toBe('core');
  });

  it('重复注册抛出冲突错误', () => {
    const registry = new NodeTypeRegistry();
    registry.register(paragraph);
    expect(() => registry.register(paragraph)).toThrow(NodeTypeConflictError);
  });

  it('批量注册冲突时原子回滚', () => {
    const registry = new NodeTypeRegistry();
    registry.register(paragraph);
    expect(() => registry.registerAll([jiaozhu, paragraph])).toThrow(
      NodeTypeConflictError,
    );
    // jiaozhu 应被回滚，不保留半注册状态
    expect(registry.has('jiaozhu')).toBe(false);
  });

  it('按命名空间过滤', () => {
    const registry = new NodeTypeRegistry();
    registry.registerAll([paragraph, jiaozhu]);
    const classical = registry.listByNamespace('classical');
    expect(classical).toHaveLength(1);
    expect(classical[0]?.type).toBe('jiaozhu');
  });
});
