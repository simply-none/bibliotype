/**
 * 默认编辑器 Schema 工厂
 *
 * 预置 core 标准节点 / 标记规格；
 * 插件包（如 classical）注册古籍规格后重新 buildSchema 即可获得完整 schema。
 */
import type { Schema } from 'prosemirror-model';
import { CORE_EDITOR_MARK_SPECS } from './core-mark-specs.js';
import { CORE_EDITOR_NODE_SPECS } from './core-node-specs.js';
import { EditorSchemaRegistry } from './schema-registry.js';

/** 创建预置标准规格的注册表 */
export function createDefaultEditorSchemaRegistry(): EditorSchemaRegistry {
  return new EditorSchemaRegistry({
    nodes: CORE_EDITOR_NODE_SPECS,
    marks: CORE_EDITOR_MARK_SPECS,
  });
}

/** 一步构建标准编辑器 Schema */
export function buildEditorSchema(): Schema {
  return createDefaultEditorSchemaRegistry().buildSchema();
}
