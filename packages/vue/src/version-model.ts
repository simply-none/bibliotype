/**
 * 历史版本视图模型（纯函数）
 *
 * 负责「版本列表分组（今日 / 昨日 / 更早）」与「差异行渲染模型」，
 * 让 `BtVersionHistory` 只做展示。
 */
import type { DocumentChange, DocumentDiff, DocumentSnapshotMeta } from '@bibliotype/core';
import { formatWordCount } from './book-shelf-model.js';

/** 时间分组键 */
export const VERSION_GROUP_KEYS = {
  TODAY: 'today',
  YESTERDAY: 'yesterday',
  EARLIER: 'earlier',
} as const;

/** 时间分组键联合 */
export type VersionGroupKey = (typeof VERSION_GROUP_KEYS)[keyof typeof VERSION_GROUP_KEYS];

/** 版本条目 */
export interface VersionItem {
  /** 版本号 */
  version: number;
  /** 标签（缺省 `版本 N`） */
  label: string;
  /** 创建时间文案（`14:05` / `10-20 14:05`） */
  timeText: string;
  /** 字数文案 */
  wordCountText: string;
  /** 是否为当前对照版本 */
  active: boolean;
}

/** 版本分组 */
export interface VersionGroup {
  /** 分组键 */
  key: VersionGroupKey;
  /** 分组标题 */
  label: string;
  /** 组内条目（版本号降序） */
  items: VersionItem[];
}

/** 版本历史模型 */
export interface VersionHistoryModel {
  /** 分组（今日 → 昨日 → 更早） */
  groups: VersionGroup[];
  /** 版本总数 */
  total: number;
  /** 是否为空 */
  empty: boolean;
}

/** 差异行（对比面板） */
export interface DiffRow {
  /** 种类 */
  kind: DocumentChange['kind'];
  /** 种类中文名 */
  kindLabel: string;
  /** 路径（点击定位用） */
  path: string;
  /** 变化前 */
  beforeText: string;
  /** 变化后 */
  afterText: string;
}

/** 差异汇总文案（`+2 −1 ~3`） */
export function diffSummaryText(diff: DocumentDiff): string {
  return `+${diff.added} −${diff.removed} ~${diff.modified}`;
}

/** 两位补零 */
function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** 取某时间所在自然日的 0 点 */
function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** 时间分组（今日 / 昨日 / 更早） */
export function versionGroupOf(createdAt: number, now: number): VersionGroupKey {
  const today = startOfDay(now);
  const yesterday = today - 86_400_000;
  if (createdAt >= today) {
    return VERSION_GROUP_KEYS.TODAY;
  }
  if (createdAt >= yesterday) {
    return VERSION_GROUP_KEYS.YESTERDAY;
  }
  return VERSION_GROUP_KEYS.EARLIER;
}

/** 时间文案 */
export function versionTimeText(createdAt: number, now: number): string {
  const date = new Date(createdAt);
  const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  const group = versionGroupOf(createdAt, now);
  if (group === VERSION_GROUP_KEYS.TODAY) {
    return time;
  }
  return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${time}`;
}

/** 构建版本历史模型 */
export function buildVersionHistoryModel(
  metas: readonly DocumentSnapshotMeta[],
  options: { now: number; activeVersion?: number },
): VersionHistoryModel {
  const sorted = [...metas].sort((left, right) => right.version - left.version);
  const buckets: Record<VersionGroupKey, VersionItem[]> = {
    today: [],
    yesterday: [],
    earlier: [],
  };
  for (const meta of sorted) {
    const group = versionGroupOf(meta.createdAt, options.now);
    buckets[group].push({
      version: meta.version,
      label: meta.label ?? `版本 ${meta.version}`,
      timeText: versionTimeText(meta.createdAt, options.now),
      wordCountText: formatWordCount(meta.wordCount),
      active: options.activeVersion === meta.version,
    });
  }
  const labels: Record<VersionGroupKey, string> = {
    today: '今日',
    yesterday: '昨日',
    earlier: '更早',
  };
  const order: VersionGroupKey[] = ['today', 'yesterday', 'earlier'];
  const groups: VersionGroup[] = [];
  for (const key of order) {
    const items = buckets[key];
    if (items.length > 0) {
      groups.push({ key, label: labels[key], items });
    }
  }
  return { groups, total: sorted.length, empty: sorted.length === 0 };
}

/** 差异行构建 */
export function buildDiffRows(diff: DocumentDiff): DiffRow[] {
  const labels: Record<DocumentChange['kind'], string> = {
    added: '新增',
    removed: '删除',
    modified: '修改',
  };
  return diff.changes.map((change) => ({
    kind: change.kind,
    kindLabel: labels[change.kind],
    path: change.path,
    beforeText: change.before ?? '',
    afterText: change.after ?? '',
  }));
}
