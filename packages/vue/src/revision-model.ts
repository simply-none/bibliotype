/**
 * 修订侧栏视图模型（纯函数）
 *
 * 输入 core 的 `RevisionEntry[]`，输出按类型分组、带时间文案的列表模型；
 * 组件不自行算文案，保证侧栏、导出、测试三处口径一致。
 */
import { REVISION_MARK_TYPES, revisionTypeLabel } from '@bibliotype/core';
import type { RevisionEntry, RevisionMarkType } from '@bibliotype/core';
import { formatRelativeTime } from './book-shelf-model.js';

/** 侧栏条目 */
export interface RevisionItem {
  /** 修订标识（接受 / 拒绝的命令参数） */
  changeId: string;
  /** 修订类型 */
  type: RevisionMarkType;
  /** 类型中文名 */
  typeLabel: string;
  /** 作者文案 */
  authorText: string;
  /** 时间文案 */
  timeText: string;
  /** 受影响文本（超长截断） */
  excerpt: string;
  /** 结构路径（定位用） */
  path: string;
}

/** 类型计数 */
export interface RevisionCounts {
  /** 插入 */
  insertion: number;
  /** 删除 */
  deletion: number;
  /** 格式变更 */
  formatChange: number;
}

/** 侧栏模型 */
export interface RevisionSidebarModel {
  /** 条目（按文档顺序） */
  items: RevisionItem[];
  /** 类型计数 */
  counts: RevisionCounts;
  /** 总数 */
  total: number;
  /** 参与者列表（去重、按首次出现） */
  authors: string[];
  /** 是否为空 */
  empty: boolean;
}

/** 文本摘要最大长度 */
const EXCERPT_LIMIT = 40;

/** 截断摘要 */
export function excerptText(text: string): string {
  const trimmed = text.trim();
  const chars = [...trimmed];
  if (chars.length <= EXCERPT_LIMIT) {
    return trimmed;
  }
  return `${chars.slice(0, EXCERPT_LIMIT).join('')}…`;
}

/** 构建侧栏模型 */
export function buildRevisionModel(
  entries: readonly RevisionEntry[],
  options: { now: number },
): RevisionSidebarModel {
  const counts: RevisionCounts = { insertion: 0, deletion: 0, formatChange: 0 };
  const authors: string[] = [];
  const items = entries.map((entry): RevisionItem => {
    if (entry.type === REVISION_MARK_TYPES.INSERTION) {
      counts.insertion += 1;
    } else if (entry.type === REVISION_MARK_TYPES.DELETION) {
      counts.deletion += 1;
    } else {
      counts.formatChange += 1;
    }
    const authorText = entry.author ?? '匿名';
    if (!authors.includes(authorText)) {
      authors.push(authorText);
    }
    return {
      changeId: entry.changeId,
      type: entry.type,
      typeLabel: revisionTypeLabel(entry.type),
      authorText,
      timeText: formatRelativeTime(entry.timestamp, options.now),
      excerpt: excerptText(entry.text),
      path: entry.path,
    };
  });

  return {
    items,
    counts,
    total: items.length,
    authors,
    empty: items.length === 0,
  };
}

/** 侧栏底部统计文案（`插 2 · 删 1 · 格式 1`） */
export function revisionCountsText(counts: RevisionCounts): string {
  return `插 ${counts.insertion} · 删 ${counts.deletion} · 格式 ${counts.formatChange}`;
}
