/**
 * 书架视图模型（纯函数）
 *
 * 组件只负责渲染，所有「怎么算」都在这里：字数缩写、相对时间、进度文案、
 * 封面占位字、标签统计。时间由调用方注入，测试与 SSR 结果稳定。
 */
import type { DocumentSummary } from '@bibliotype/core';

/** 书架卡片（组件渲染所需的最小字段集） */
export interface ShelfCard {
  /** 文档 id */
  id: string;
  /** 标题 */
  title: string;
  /** 作者展示文案（缺省「未署名」） */
  authorText: string;
  /** 标签列表 */
  tags: string[];
  /** 封面缩略图（data URI / asset 引用；缺省用占位） */
  coverThumbnail?: string;
  /** 封面占位字（标题首字） */
  glyph: string;
  /** 阅读进度百分比（0–100 整数） */
  progressPercent: number;
  /** 进度文案（`32%`） */
  progressText: string;
  /** 字数文案（`1.2 万字`） */
  wordCountText: string;
  /** 最近阅读文案（`3 小时前` / `未读`） */
  recentText: string;
  /** 元信息行（`朱熹 · 1.2 万字`） */
  metaText: string;
}

/** 标签筛选胶囊 */
export interface TagFacet {
  /** 标签名 */
  tag: string;
  /** 命中数量 */
  count: number;
}

/** 度数缩写阈值 */
const TEN_THOUSAND = 10_000;

/** 两位补零 */
function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** 字数文案：`980 字` / `1.2 万字` / `—` */
export function formatWordCount(count: number | undefined): string {
  if (count === undefined || !Number.isFinite(count) || count < 0) {
    return '—';
  }
  if (count < TEN_THOUSAND) {
    return `${count} 字`;
  }
  const scaled = count / TEN_THOUSAND;
  return `${scaled >= 100 ? Math.round(scaled) : Math.round(scaled * 10) / 10} 万字`;
}

/** 相对时间文案（缺省「未读」） */
export function formatRelativeTime(timestamp: number | undefined, now: number): string {
  if (timestamp === undefined || !Number.isFinite(timestamp)) {
    return '未读';
  }
  const delta = now - timestamp;
  if (delta < 60_000) {
    return '刚刚';
  }
  if (delta < 3_600_000) {
    return `${Math.floor(delta / 60_000)} 分钟前`;
  }
  if (delta < 86_400_000) {
    return `${Math.floor(delta / 3_600_000)} 小时前`;
  }
  if (delta < 30 * 86_400_000) {
    return `${Math.floor(delta / 86_400_000)} 天前`;
  }
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** 进度归一（0–100 整数） */
export function normalizeProgress(progress: number | undefined): number {
  if (progress === undefined || !Number.isFinite(progress)) {
    return 0;
  }
  const clamped = Math.min(1, Math.max(0, progress));
  return Math.round(clamped * 100);
}

/** 标题首字（用于封面占位；空标题给「书」） */
export function titleGlyph(title: string): string {
  const chars = [...title.trim()];
  return chars.length === 0 ? '书' : (chars[0] ?? '书');
}

/** 构建单张卡片 */
export function buildShelfCard(summary: DocumentSummary, now: number): ShelfCard {
  const authorText = summary.author ?? '未署名';
  const wordCountText = formatWordCount(summary.wordCount);
  const progressPercent = normalizeProgress(summary.progress);
  const card: ShelfCard = {
    id: summary.id,
    title: summary.title,
    authorText,
    tags: summary.tags ?? [],
    glyph: titleGlyph(summary.title),
    progressPercent,
    progressText: `${progressPercent}%`,
    wordCountText,
    recentText: formatRelativeTime(summary.lastOpenedAt ?? summary.updatedAt, now),
    metaText: `${authorText} · ${wordCountText}`,
  };
  if (summary.coverThumbnail !== undefined && summary.coverThumbnail !== '') {
    card.coverThumbnail = summary.coverThumbnail;
  }
  return card;
}

/** 批量构建卡片 */
export function buildShelfCards(
  summaries: readonly DocumentSummary[],
  options: { now: number },
): ShelfCard[] {
  return summaries.map((summary) => buildShelfCard(summary, options.now));
}

/** 标签统计（按出现次数降序，同数按名称升序） */
export function buildTagFacets(summaries: readonly DocumentSummary[]): TagFacet[] {
  const counts = new Map<string, number>();
  for (const summary of summaries) {
    for (const tag of summary.tags ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((left, right) => (right.count - left.count) || (left.tag < right.tag ? -1 : 1));
}

/** 空库提示文案（按是否有检索条件区分） */
export function emptyShelfHint(options: { hasQuery: boolean }): string {
  return options.hasQuery
    ? '没有匹配的书，试试更换关键词或清空标签筛选。'
    : '书架还是空的，导入第一本书开始整理。';
}
