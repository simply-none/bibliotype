/**
 * 古籍规格向编辑器注册（对应 D8）
 *
 * classical → editor 单向依赖：classical 提供规格数据，
 * editor 提供注册 API；使用方注册后即可用古籍节点构建编辑 schema。
 */
import { NAMESPACES } from '@bibliotype/core';
import {
  createDefaultEditorSchemaRegistry,
  type EditorSchemaRegistry,
} from '@bibliotype/editor';
import type { Schema } from 'prosemirror-model';
import { CLASSICAL_EDITOR_MARK_SPECS, CLASSICAL_EDITOR_NODE_SPECS } from './editor-specs.js';

/**
 * 向编辑器注册表注册古籍节点与标记规格
 *
 * @param registry 编辑器规格注册表（通常含标准规格）
 * @returns 注销函数（卸载古籍扩展时调用，按 classical 命名空间清理）
 */
export function registerClassicalEditorSpecs(registry: EditorSchemaRegistry): () => void {
  registry.registerAll({
    nodes: CLASSICAL_EDITOR_NODE_SPECS,
    marks: CLASSICAL_EDITOR_MARK_SPECS,
  });
  return () => {
    registry.unregisterByNamespace(NAMESPACES.CLASSICAL);
  };
}

/**
 * 构建含古籍规格的完整编辑器 Schema（标准规格 + 古籍规格）
 */
export function buildClassicalEditorSchema(): Schema {
  const registry = createDefaultEditorSchemaRegistry();
  registerClassicalEditorSpecs(registry);
  return registry.buildSchema();
}
