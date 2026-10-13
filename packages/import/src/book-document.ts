/**
 * 块节点 → BookDocument（文档级组装，纯函数）
 *
 * 定位：import 包的基础组装单元——把一串 ProseMirror 块节点合成合法的 `book` 根，
 * 经 editor 的 `pmNodeToIr` 回收为 IR，再连同注入的 `metadata` 组装为 `BookDocument`。
 * - 依赖方向：import → editor（pmNodeToIr）、import → core（类型与常量），符合依赖矩阵；
 * - 确定性：`metadata`（含时间字段）一律由调用方注入，包内不读当前时间（红线 §四.6）。
 */
import { IR_SCHEMA_VERSION, NODE_TYPES, type BookDocument, type BookMetadata } from '@bibliotype/core';
import { pmNodeToIr } from '@bibliotype/editor';
import type { Node as PmNode, Schema } from 'prosemirror-model';

/**
 * 由块节点组装 BookDocument
 *
 * @param nodes 块级 PM 节点（须为 `book` 根 `content: block*` 可接受的子节点）
 * @param schema 编辑器 schema（其 topNode 应为 `book`）
 * @param metadata 书目元数据（由调用方注入，保证确定性）
 * @returns 合法 BookDocument（`root.type` 固定为 `book`）
 */
export function nodesToBookDocument(
  nodes: readonly PmNode[],
  schema: Schema,
  metadata: BookMetadata,
): BookDocument {
  const bookType = schema.nodes[NODE_TYPES.BOOK];
  if (bookType === undefined) {
    throw new RangeError(`schema 中未定义节点类型 "${NODE_TYPES.BOOK}"，无法组装文档根。`);
  }
  // createChecked 校验内容表达式；空内容省略 children（与 pmNodeToIr 规范化一致）
  const rootPm = bookType.createChecked(null, nodes.length > 0 ? [...nodes] : undefined);
  return {
    schemaVersion: IR_SCHEMA_VERSION,
    metadata,
    root: pmNodeToIr(rootPm),
  };
}
