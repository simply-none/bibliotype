/**
 * 编辑器规格注册表（对应 D8）
 *
 * editor 仅提供节点 / 标记的 ProseMirror 规格注册 API；
 * 古籍等插件包（如 @bibliotype/classical）在初始化时批量注册其专有节点，
 * 卸载时按命名空间注销，保证未安装插件时 editor 独立可用。
 */
import { NODE_TYPES } from '@bibliotype/core';
import { Schema, type MarkSpec, type NodeSpec } from 'prosemirror-model';

/** 编辑器节点规格条目 */
export interface EditorNodeSpecEntry {
  /** 节点类型名（须与 IR 节点 type 一致，如 paragraph） */
  type: string;
  /** ProseMirror 节点规格 */
  spec: NodeSpec;
  /** 所属命名空间（按此注销），缺省为 core */
  namespace?: string;
}

/** 编辑器标记规格条目 */
export interface EditorMarkSpecEntry {
  /** 标记类型名（须与 IR 标记 type 一致，如 strong） */
  type: string;
  /** ProseMirror 标记规格 */
  spec: MarkSpec;
  /** 所属命名空间（按此注销），缺省为 core */
  namespace?: string;
}

/** 默认命名空间 */
export const DEFAULT_EDITOR_NAMESPACE = 'core';

/** 默认根节点类型（IR 的 book 根） */
export const DEFAULT_EDITOR_TOP_NODE: string = NODE_TYPES.BOOK;

/** 规格注册冲突错误 */
export class EditorSpecConflictError extends Error {
  constructor(kind: 'node' | 'mark', type: string) {
    super(`编辑器 ${kind === 'node' ? '节点' : '标记'}规格 "${type}" 已注册。`);
    this.name = 'EditorSpecConflictError';
  }
}

/** 注册表初始化参数 */
export interface EditorSchemaRegistryInit {
  nodes?: readonly EditorNodeSpecEntry[];
  marks?: readonly EditorMarkSpecEntry[];
}

/** 构建 schema 选项 */
export interface BuildSchemaOptions {
  /** 根节点类型（缺省 book） */
  topNode?: string;
}

/** 编辑器规格注册表 */
export class EditorSchemaRegistry {
  private readonly nodes = new Map<string, EditorNodeSpecEntry>();
  private readonly marks = new Map<string, EditorMarkSpecEntry>();

  constructor(init: EditorSchemaRegistryInit = {}) {
    for (const entry of init.nodes ?? []) {
      this.registerNode(entry);
    }
    for (const entry of init.marks ?? []) {
      this.registerMark(entry);
    }
  }

  /** 注册单个节点规格（重复注册抛错） */
  registerNode(entry: EditorNodeSpecEntry): void {
    if (this.nodes.has(entry.type)) {
      throw new EditorSpecConflictError('node', entry.type);
    }
    this.nodes.set(entry.type, {
      ...entry,
      namespace: entry.namespace ?? DEFAULT_EDITOR_NAMESPACE,
    });
  }

  /** 注册单个标记规格（重复注册抛错） */
  registerMark(entry: EditorMarkSpecEntry): void {
    if (this.marks.has(entry.type)) {
      throw new EditorSpecConflictError('mark', entry.type);
    }
    this.marks.set(entry.type, {
      ...entry,
      namespace: entry.namespace ?? DEFAULT_EDITOR_NAMESPACE,
    });
  }

  /** 批量注册（原子操作：任一冲突则全部回滚） */
  registerAll(init: EditorSchemaRegistryInit): void {
    const nodeTypes: string[] = [];
    const markTypes: string[] = [];
    try {
      for (const entry of init.nodes ?? []) {
        this.registerNode(entry);
        nodeTypes.push(entry.type);
      }
      for (const entry of init.marks ?? []) {
        this.registerMark(entry);
        markTypes.push(entry.type);
      }
    } catch (error) {
      for (const type of nodeTypes) {
        this.nodes.delete(type);
      }
      for (const type of markTypes) {
        this.marks.delete(type);
      }
      throw error;
    }
  }

  /** 是否已注册节点规格 */
  hasNode(type: string): boolean {
    return this.nodes.has(type);
  }

  /** 是否已注册标记规格 */
  hasMark(type: string): boolean {
    return this.marks.has(type);
  }

  /** 注销单个节点规格 */
  unregisterNode(type: string): boolean {
    return this.nodes.delete(type);
  }

  /** 注销单个标记规格 */
  unregisterMark(type: string): boolean {
    return this.marks.delete(type);
  }

  /**
   * 按命名空间批量注销（节点与标记一并清理，插件卸载时调用）
   *
   * @returns 注销的数量
   */
  unregisterByNamespace(namespace: string): number {
    let removed = 0;
    for (const [type, entry] of this.nodes) {
      if (entry.namespace === namespace) {
        this.nodes.delete(type);
        removed += 1;
      }
    }
    for (const [type, entry] of this.marks) {
      if (entry.namespace === namespace) {
        this.marks.delete(type);
        removed += 1;
      }
    }
    return removed;
  }

  /** 列出全部节点规格条目 */
  listNodes(): EditorNodeSpecEntry[] {
    return [...this.nodes.values()];
  }

  /** 列出全部标记规格条目 */
  listMarks(): EditorMarkSpecEntry[] {
    return [...this.marks.values()];
  }

  /** 构建 ProseMirror Schema（根节点缺省为 book） */
  buildSchema(options: BuildSchemaOptions = {}): Schema {
    const topNode = options.topNode ?? DEFAULT_EDITOR_TOP_NODE;
    if (!this.nodes.has(topNode)) {
      throw new RangeError(`无法构建 schema：根节点类型 "${topNode}" 未注册。`);
    }

    const nodes: Record<string, NodeSpec> = {};
    for (const [type, entry] of this.nodes) {
      nodes[type] = entry.spec;
    }
    const marks: Record<string, MarkSpec> = {};
    for (const [type, entry] of this.marks) {
      marks[type] = entry.spec;
    }

    return new Schema({ topNode, nodes, marks });
  }
}
