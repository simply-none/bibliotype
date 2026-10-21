/**
 * @bibliotype/annotation 统一导出入口
 *
 * 标注 = 不改进正文的旁注数据：高亮 / 书签 / 笔记 / 评论。
 * 位置一律用 `@bibliotype/core` 的锚点契约表达，重排与版式切换不会漂移。
 */

/* ---------- 类型 ---------- */
export { ANNOTATION_KINDS } from './types.js';
export type {
  AnnotationKind,
  AnnotationAuthor,
  CommentEntry,
  Annotation,
  AnnotationSet,
  AnnotationFilter,
  AnnotationStorage,
} from './types.js';

/* ---------- 构造 ---------- */
export {
  DEFAULT_HIGHLIGHT_COLOR,
  defaultClock,
  buildAnnotationId,
  createAnnotation,
  createHighlight,
  createBookmark,
  createNote,
  createComment,
  addComment,
  setCommentResolved,
} from './create.js';
export type { CreateAnnotationOptions } from './create.js';

/* ---------- 序列化 ---------- */
export {
  ANNOTATION_SCHEMA_VERSION,
  isAnnotation,
  validateAnnotations,
  serializeAnnotationSet,
  deserializeAnnotationSet,
} from './serialize.js';

/* ---------- Markdown 导出 ---------- */
export { annotationsToMarkdown } from './markdown.js';

/* ---------- 加密存储（注记独立密钥） ---------- */
export { createEncryptedAnnotationStorage } from './encrypted-storage.js';
export type { EncryptedAnnotationStorageOptions } from './encrypted-storage.js';

/* ---------- 容器 ---------- */
export { AnnotationStore } from './store.js';
export type { AnnotationPatch, AnnotationListener } from './store.js';

/* ---------- 解析 ---------- */
export {
  resolveAnnotation,
  resolveAnnotations,
  groupAnnotationsByNode,
  countByKind,
} from './resolve.js';
export type { ResolvedAnnotation, AnnotationResolution } from './resolve.js';
