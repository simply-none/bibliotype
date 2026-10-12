/**
 * 节点类型注册表
 *
 * 全局唯一的节点类型名录：
 * - core 启动时预置现代书籍节点；
 * - 插件（如 classical）通过 register 批量补充；
 * - 注册冲突时抛出明确错误（含命名空间提示），避免静默覆盖。
 */
import type { NodeTypeDefinition } from './node-type.js';

/** 注册冲突错误 */
export class NodeTypeConflictError extends Error {
  constructor(type: string) {
    super(
      `节点类型 "${type}" 已被注册。若为不同业务语义，请使用独立命名空间前缀（如 "classical:jiaozhu"）。`,
    );
    this.name = 'NodeTypeConflictError';
  }
}

/** 节点类型注册表 */
export class NodeTypeRegistry {
  private readonly definitions = new Map<string, NodeTypeDefinition>();

  /** 注册单个节点类型（重复注册抛错） */
  register(definition: NodeTypeDefinition): void {
    if (this.definitions.has(definition.type)) {
      throw new NodeTypeConflictError(definition.type);
    }
    this.definitions.set(definition.type, definition);
  }

  /** 批量注册（原子操作：任一冲突则全部回滚） */
  registerAll(definitions: readonly NodeTypeDefinition[]): void {
    const registered: string[] = [];
    try {
      for (const def of definitions) {
        this.register(def);
        registered.push(def.type);
      }
    } catch (error) {
      // 回滚已注册项，保证批量语义的原子性
      for (const type of registered) {
        this.definitions.delete(type);
      }
      throw error;
    }
  }

  /** 查询定义 */
  get(type: string): NodeTypeDefinition | undefined {
    return this.definitions.get(type);
  }

  /** 是否已注册 */
  has(type: string): boolean {
    return this.definitions.has(type);
  }

  /** 列出全部已注册类型 */
  list(): NodeTypeDefinition[] {
    return [...this.definitions.values()];
  }

  /** 按命名空间过滤 */
  listByNamespace(namespace: string): NodeTypeDefinition[] {
    return this.list().filter((def) => def.namespace === namespace);
  }

  /**
   * 注销单个节点类型（插件卸载时使用）
   *
   * @returns 是否存在并已注销
   */
  unregister(type: string): boolean {
    return this.definitions.delete(type);
  }

  /**
   * 按命名空间批量注销（插件 dispose 时调用）
   *
   * @returns 注销的数量
   */
  unregisterByNamespace(namespace: string): number {
    let removed = 0;
    for (const [type, def] of this.definitions) {
      if (def.namespace === namespace) {
        this.definitions.delete(type);
        removed += 1;
      }
    }
    return removed;
  }
}
