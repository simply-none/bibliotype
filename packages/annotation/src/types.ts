/**
 * 标注（Annotation）数据结构
 *
 * 标注不进正文流：正文仍是唯一事实源，标注只是「挂在不改正文的位置」上的旁注。
 * 位置用 core 的 `Anchor`（节点 id + 字符偏移）表达，因此重排、改字号、切直排都不会丢。
 *
 * 四类语义（同一套结构，避免为每种类型各造一套模型）：
 * - `highlight` 高亮：只有颜色与区间；
 * - `bookmark` 书签：块级或文本级位置书签，可带标题；
 * - `note` 笔记：单条短文本；
 * - `comment` 评论：多条评论组成的线程，可标记已解决。
 */
import type { Anchor, Attrs, Timestamp } from '@bibliotype/core';

/** 标注种类常量 */
export const ANNOTATION_KINDS = {
  /** 高亮 */
  HIGHLIGHT: 'highlight',
  /** 书签 */
  BOOKMARK: 'bookmark',
  /** 笔记 */
  NOTE: 'note',
  /** 评论（线程） */
  COMMENT: 'comment',
} as const;

/** 标注种类联合 */
export type AnnotationKind = (typeof ANNOTATION_KINDS)[keyof typeof ANNOTATION_KINDS];

/** 标注作者（协同 / 多用户场景需要） */
export interface AnnotationAuthor {
  /** 用户标识 */
  id: string;
  /** 显示名 */
  name?: string;
  /** 标识色（高亮 / 光标着色用，CSS 颜色串） */
  color?: string;
}

/** 评论条目 */
export interface CommentEntry {
  /** 条目标识 */
  id: string;
  /** 作者 */
  author: AnnotationAuthor;
  /** 正文（纯文本） */
  body: string;
  /** 创建时间（ISO 8601） */
  createdAt: Timestamp;
}

/** 单条标注 */
export interface Annotation {
  /** 标注标识（确定性内容哈希，见 create*.ts） */
  id: string;
  /** 标注种类 */
  kind: AnnotationKind;
  /** 位置锚点（core 契约） */
  anchor: Anchor;
  /** 高亮颜色（CSS 颜色串；highlight 用） */
  color?: string;
  /** 短文本：笔记正文 / 书签标题 */
  body?: string;
  /** 评论线程（comment 用） */
  comments?: CommentEntry[];
  /** 是否已解决（comment 用） */
  resolved?: boolean;
  /** 作者（创建者） */
  author?: AnnotationAuthor;
  /** 扩展属性（插件自定义，值必须为标量） */
  attrs?: Attrs;
  /** 创建时间（ISO 8601） */
  createdAt: Timestamp;
  /** 最近修改时间（ISO 8601） */
  updatedAt: Timestamp;
}

/** 标注集合（可序列化形态） */
export interface AnnotationSet {
  /** 集合 schema 版本 */
  schemaVersion: string;
  /** 标注列表 */
  annotations: Annotation[];
}

/** 标注查询过滤条件 */
export interface AnnotationFilter {
  /** 按种类过滤 */
  kind?: AnnotationKind | readonly AnnotationKind[];
  /** 按目标节点 id 过滤 */
  nodeId?: string;
  /** 是否包含已解决的评论（缺省 true） */
  includeResolved?: boolean;
}

/** 标注持久化端口（indexedDB / http 等由适配层实现） */
export interface AnnotationStorage {
  /** 适配器名称 */
  readonly name: string;
  /** 读取标注集合（未命中返回 undefined） */
  loadAnnotations(bookId: string): Promise<AnnotationSet | undefined>;
  /** 保存标注集合（整体覆盖） */
  saveAnnotations(bookId: string, set: AnnotationSet): Promise<void>;
  /** 清空某本书的标注 */
  clearAnnotations(bookId: string): Promise<void>;
}
