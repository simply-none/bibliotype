/**
 * 书籍文档（IR 顶层结构）
 *
 * BookDocument 是 bibliotype 的中枢数据形态：
 * 编辑器产出它、渲染器消费它、导出器转换它、协同层将其映射到 Y.Doc。
 */
import type { BookNode } from './nodes.js';
import type { BookMetadata } from './metadata.js';
import { NODE_TYPES } from './node-types.js';

/** IR Schema 版本号（结构不兼容变更时递增，用于迁移） */
export const IR_SCHEMA_VERSION = '0.1.0';

/** 书籍文档 */
export interface BookDocument {
  /** Schema 版本（用于向后兼容迁移） */
  schemaVersion: string;
  /** 书目元数据 */
  metadata: BookMetadata;
  /** 正文根节点（type 固定为 NODE_TYPES.BOOK） */
  root: BookNode;
}

/** 创建一个空书籍文档 */
export function createEmptyDocument(metadata: BookMetadata): BookDocument {
  return {
    schemaVersion: IR_SCHEMA_VERSION,
    metadata,
    root: {
      type: NODE_TYPES.BOOK,
      children: [],
    },
  };
}

/** 校验文档基本形态（轻量结构检查，非完整 Schema 校验） */
export function isBookDocument(value: unknown): value is BookDocument {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const doc = value as Partial<BookDocument>;
  return (
    typeof doc.schemaVersion === 'string' &&
    typeof doc.metadata === 'object' &&
    doc.metadata !== null &&
    typeof doc.metadata.title === 'string' &&
    typeof doc.root === 'object' &&
    doc.root !== null &&
    doc.root.type === NODE_TYPES.BOOK
  );
}
