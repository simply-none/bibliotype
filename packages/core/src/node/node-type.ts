/**
 * 节点类型定义（注册表的登记单元）
 *
 * 核心包预置 NODE_TYPES 中的现代书籍节点；
 * 古籍专有节点由 @bibliotype/classical 通过注册机制补充（对应 D8：
 * 古籍节点定义放在 classical，editor 仅提供注册 API）。
 */

/** 节点族：区分块级与行内，影响布局与编辑行为 */
export type NodeKind = 'block' | 'inline' | 'text';

/** 节点类型定义 */
export interface NodeTypeDefinition {
  /** 节点类型名（语义标签，kebab-case，全局唯一） */
  type: string;
  /** 所属命名空间（如 "core"、"classical"），用于归属与冲突提示 */
  namespace: string;
  /** 节点族 */
  kind: NodeKind;
  /** 是否可包含子节点 */
  isContainer: boolean;
  /** 说明（供文档与调试展示） */
  description?: string;
}

/** 命名空间常量 */
export const NAMESPACES = {
  /** 核心现代书籍节点 */
  CORE: 'core',
  /** 古籍专有节点 */
  CLASSICAL: 'classical',
} as const;
