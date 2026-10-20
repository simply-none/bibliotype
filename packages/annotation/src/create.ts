/**
 * 标注构造：由锚点生成各类标注（纯函数，不修改入参）
 *
 * - 时间：缺省从注入的 `clock` 取（测试传固定时钟即可获得确定性输出）；
 * - id：`kind + 锚点 + 时间 + 作者 + 正文` 的内容哈希，天然去重，不用随机数。
 */
import type { Anchor, Timestamp } from '@bibliotype/core';
import { serializeAnchor } from '@bibliotype/core';
import { hashString } from './hash.js';
import { ANNOTATION_KINDS } from './types.js';
import type {
  Annotation,
  AnnotationAuthor,
  AnnotationKind,
  CommentEntry,
} from './types.js';

/** 高亮默认颜色（与主题 highlight 令牌一致） */
export const DEFAULT_HIGHLIGHT_COLOR = '#ffe58f';

/** 默认时钟（运行时取当前时间；测试请通过 clock / createdAt 注入） */
export function defaultClock(): Timestamp {
  return new Date().toISOString();
}

/** 创建标注的通用选项 */
export interface CreateAnnotationOptions {
  /** 显式指定 id（缺省按内容哈希生成） */
  id?: string;
  /** 作者 */
  author?: AnnotationAuthor;
  /** 显式创建时间（优先于 clock） */
  createdAt?: Timestamp;
  /** 时钟注入（确定性测试用） */
  clock?: () => Timestamp;
  /** 高亮颜色 */
  color?: string;
  /** 短文本（笔记正文 / 书签标题） */
  body?: string;
  /** 扩展属性 */
  attrs?: Annotation['attrs'];
}

/** 解析创建时间 */
function resolveTime(options: CreateAnnotationOptions): Timestamp {
  if (options.createdAt !== undefined) {
    return options.createdAt;
  }
  return (options.clock ?? defaultClock)();
}

/** 生成确定性标注 id */
export function buildAnnotationId(
  kind: AnnotationKind,
  anchor: Anchor,
  time: Timestamp,
  author?: AnnotationAuthor,
  body?: string,
): string {
  return hashString(`${kind}|${serializeAnchor(anchor)}|${time}|${author?.id ?? ''}|${body ?? ''}`);
}

/** 创建任意种类的标注 */
export function createAnnotation(
  kind: AnnotationKind,
  anchor: Anchor,
  options: CreateAnnotationOptions = {},
): Annotation {
  const time = resolveTime(options);
  const annotation: Annotation = {
    id: options.id ?? buildAnnotationId(kind, anchor, time, options.author, options.body),
    kind,
    anchor,
    createdAt: time,
    updatedAt: time,
  };
  if (options.author !== undefined) {
    annotation.author = options.author;
  }
  if (options.color !== undefined) {
    annotation.color = options.color;
  }
  if (options.body !== undefined) {
    annotation.body = options.body;
  }
  if (options.attrs !== undefined) {
    annotation.attrs = { ...options.attrs };
  }
  if (kind === ANNOTATION_KINDS.COMMENT) {
    annotation.comments = [];
    annotation.resolved = false;
  }
  return annotation;
}

/** 创建高亮（缺省颜色为 DEFAULT_HIGHLIGHT_COLOR） */
export function createHighlight(
  anchor: Anchor,
  options: CreateAnnotationOptions = {},
): Annotation {
  return createAnnotation(ANNOTATION_KINDS.HIGHLIGHT, anchor, {
    color: DEFAULT_HIGHLIGHT_COLOR,
    ...options,
  });
}

/** 创建书签 */
export function createBookmark(
  anchor: Anchor,
  options: CreateAnnotationOptions = {},
): Annotation {
  return createAnnotation(ANNOTATION_KINDS.BOOKMARK, anchor, options);
}

/** 创建笔记（正文必填） */
export function createNote(
  anchor: Anchor,
  body: string,
  options: CreateAnnotationOptions = {},
): Annotation {
  if (!body.trim()) {
    throw new RangeError('创建笔记失败：正文不能为空。');
  }
  return createAnnotation(ANNOTATION_KINDS.NOTE, anchor, { ...options, body });
}

/** 创建评论线程（首条评论必填） */
export function createComment(
  anchor: Anchor,
  body: string,
  author: AnnotationAuthor,
  options: CreateAnnotationOptions = {},
): Annotation {
  const annotation = createAnnotation(ANNOTATION_KINDS.COMMENT, anchor, {
    ...options,
    author: options.author ?? author,
  });
  return addComment(annotation, body, author, options);
}

/** 追加评论条目（返回新对象，原标注不变） */
export function addComment(
  annotation: Annotation,
  body: string,
  author: AnnotationAuthor,
  options: CreateAnnotationOptions = {},
): Annotation {
  if (annotation.kind !== ANNOTATION_KINDS.COMMENT) {
    throw new TypeError('追加评论失败：目标标注不是评论类型。');
  }
  if (!body.trim()) {
    throw new RangeError('追加评论失败：正文不能为空。');
  }
  const time = options.createdAt ?? (options.clock ?? defaultClock)();
  const entry: CommentEntry = {
    id: options.id ?? hashString(`${annotation.id}|${time}|${author.id}|${body}`),
    author,
    body,
    createdAt: time,
  };
  return {
    ...annotation,
    comments: [...(annotation.comments ?? []), entry],
    updatedAt: time,
  };
}

/** 标记评论线程已解决 / 取消解决（返回新对象） */
export function setCommentResolved(
  annotation: Annotation,
  resolved: boolean,
  options: CreateAnnotationOptions = {},
): Annotation {
  if (annotation.kind !== ANNOTATION_KINDS.COMMENT) {
    throw new TypeError('设置解决状态失败：目标标注不是评论类型。');
  }
  const time = options.createdAt ?? (options.clock ?? defaultClock)();
  return { ...annotation, resolved, updatedAt: time };
}
