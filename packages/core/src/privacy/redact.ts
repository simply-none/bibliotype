/**
 * 导出脱敏
 *
 * 目标：把「不想随导出物扩散」的信息去掉——批注、作者署名、阅读进度。
 * 只做**结构裁剪**，不改正文；返回新对象，不修改入参。
 *
 * 与加密的分工：加密解决「存储不可读」，脱敏解决「导出后不含敏感字段」。
 */
import type { BookDocument } from '../ir/document.js';
import type { BookMetadata } from '../ir/metadata.js';

/** 脱敏选项 */
export interface RedactOptions {
  /** 隐藏责任者（清空 contributors，出版信息里的 publisher 保留） */
  hideAuthors?: boolean;
  /** 隐藏阅读进度（`metadata.extra` 中的进度类字段） */
  hideProgress?: boolean;
  /** 隐藏批注（按 kind 剔除，默认 `['comment']`） */
  hideComments?: boolean;
  /** 需要剔除的标注种类（`hideComments` 为 true 时生效） */
  commentKinds?: readonly string[];
  /** 作者占位名（`keepAuthorPlaceholder` 为 true 时写入 contributors） */
  authorPlaceholder?: string;
  /** 是否保留一个占位作者（默认 false，直接清空） */
  keepAuthorPlaceholder?: boolean;
}

/** 阅读进度相关扩展字段（脱敏时移除） */
export const READING_PROGRESS_KEYS = [
  'progress',
  'readingProgress',
  'lastOpenedAt',
  'readingPosition',
  'currentPage',
] as const;

/** 默认为「批注」类的标注 kind */
const DEFAULT_COMMENT_KINDS: readonly string[] = ['comment'];

/** 可脱敏的标注最小结构（保持结构类型，不依赖 annotation 包） */
export interface RedactableAnnotation {
  /** 标注种类 */
  kind?: string;
  /** 作者信息 */
  author?: unknown;
  /** 评论线程 */
  comments?: unknown;
  /** 其他字段原样保留 */
  [key: string]: unknown;
}

/** 清空阅读进度字段 */
function redactExtra(extra: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (extra === undefined) {
    return undefined;
  }
  const next: Record<string, unknown> = { ...extra };
  for (const key of READING_PROGRESS_KEYS) {
    delete next[key];
  }
  return next;
}

/**
 * 脱敏文档元数据
 *
 * 正文（root）原样引用——导出层只读，不做深拷贝以免大文档额外开销。
 */
export function redactDocument(document: BookDocument, options: RedactOptions = {}): BookDocument {
  const metadata: BookMetadata = { ...document.metadata };
  if (options.hideAuthors === true) {
    if (options.keepAuthorPlaceholder === true) {
      metadata.contributors = [{ name: options.authorPlaceholder ?? '佚名' }];
    } else {
      delete metadata.contributors;
    }
  }
  if (options.hideProgress === true) {
    const extra = redactExtra(metadata.extra);
    if (extra === undefined || Object.keys(extra).length === 0) {
      delete metadata.extra;
    } else {
      metadata.extra = extra;
    }
  }
  return { ...document, metadata };
}

/** 剔除评论线程里的作者与时间（保留正文与回复顺序） */
function redactComments(comments: unknown): unknown {
  if (!Array.isArray(comments)) {
    return comments;
  }
  return comments.map((entry) => {
    if (typeof entry !== 'object' || entry === null) {
      return entry;
    }
    const next: Record<string, unknown> = { ...(entry as Record<string, unknown>) };
    delete next['author'];
    delete next['createdAt'];
    delete next['updatedAt'];
    return next;
  });
}

/**
 * 脱敏标注列表
 *
 * - `hideComments`：剔除 `commentKinds` 中的标注（默认仅 `comment`）；
 * - `hideAuthors`：去掉顶层 `author` 与线程内每条评论的作者 / 时间。
 */
export function redactAnnotations<T extends RedactableAnnotation>(
  items: readonly T[],
  options: RedactOptions = {},
): T[] {
  const dropKinds = new Set(options.commentKinds ?? DEFAULT_COMMENT_KINDS);
  const result: T[] = [];
  for (const item of items) {
    if (options.hideComments === true && item.kind !== undefined && dropKinds.has(item.kind)) {
      continue;
    }
    const next: T = { ...item };
    if (options.hideAuthors === true) {
      delete next.author;
      if (next.comments !== undefined) {
        next.comments = redactComments(next.comments);
      }
    }
    result.push(next);
  }
  return result;
}

/** 判定是否需要脱敏（供导出入口快速短路） */
export function needsRedaction(options: RedactOptions = {}): boolean {
  return options.hideAuthors === true || options.hideProgress === true || options.hideComments === true;
}
