/**
 * 存储适配器契约（Port）
 *
 * 对应调研清单 § 七「存储」与 D4（不规划后端、存储中立）、D9（本地存储面向 Electron）：
 * - core 定义端口（本文件），各 adapter-* 包提供实现：
 *   - @bibliotype/adapter-indexeddb：Web 端（IndexedDB）；
 *   - @bibliotype/adapter-sqlite：Electron 端（数据库）；
 *   - @bibliotype/adapter-http：远端（自建服务）。
 *
 * 本模块仅含类型，无运行时逻辑。
 */
import type { BookDocument } from '../ir/document.js';
import type { BookMetadata } from '../ir/metadata.js';

/** 持久化的文档记录 */
export interface StoredDocument {
  /** 文档标识 */
  id: string;
  /** IR 文档 */
  document: BookDocument;
  /** 书目元数据（冗余存储，便于列表页免解析全文） */
  metadata: BookMetadata;
  /** 最后更新时间（epoch ms） */
  updatedAt: number;
}

/** 文档摘要（列表页展示） */
export interface DocumentSummary {
  id: string;
  /** 标题（取自 metadata.title） */
  title: string;
  /** 最后更新时间（epoch ms） */
  updatedAt: number;
}

/** 保存选项 */
export interface SaveOptions {
  /** 指定更新时间（缺省为当前时间；测试可注入以获得确定性） */
  updatedAt?: number;
}

/**
 * 存储适配器接口
 *
 * 约定：
 * - save 为整体覆盖语义（IR 全量持久化）；
 * - load 未命中返回 undefined（不抛错）；
 * - list 按 updatedAt 降序返回摘要；
 * - delete 返回是否存在并已删除；
 * - close 释放底层资源（IDB 连接等），调用后仍可再次使用（延迟重开）。
 */
export interface StorageAdapter {
  /** 适配器名称（如 'indexeddb' / 'memory'） */
  readonly name: string;
  /** 保存（覆盖）文档 */
  save(id: string, document: BookDocument, options?: SaveOptions): Promise<void>;
  /** 读取文档（未命中返回 undefined） */
  load(id: string): Promise<BookDocument | undefined>;
  /** 列出全部文档摘要（按更新时间降序） */
  list(): Promise<DocumentSummary[]>;
  /** 删除文档 */
  delete(id: string): Promise<boolean>;
  /** 清空全部文档 */
  clear(): Promise<void>;
  /** 释放底层资源 */
  close(): Promise<void>;
}
