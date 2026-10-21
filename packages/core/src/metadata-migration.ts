/**
 * 旧版元数据迁移（K7）
 *
 * 早期把「藏地 / 索书号 / 版本类型」等古籍字段塞在 `extra`（插件自由字段）里，
 * K7 起提升为 `BookMetadata` 的顶层字段。迁移规则：
 *
 * - 顶层已有值时**以顶层为准**，不覆盖作者显式填写的内容；
 * - 迁移后从 `extra` 移除同名键；`extra` 变空则整个字段删除；
 * - 幂等：重复调用返回等价结果，不引入时间 / 随机值。
 */
import type { BookMetadata, ClassicalCategory, EditionType } from './ir/metadata.js';
import { isClassicalDivision, isEditionType } from './metadata-validation.js';

/** `extra` 中待迁移的键 */
const LEGACY_KEYS = ['repository', 'callNumber', 'editionType', 'classicalCategory'] as const;

/** 规范化旧版四部对象（只接受 `{ division, subdivision? }`） */
function readClassicalCategory(value: unknown): ClassicalCategory | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (!isClassicalDivision(record['division'])) return undefined;
  const subdivision = record['subdivision'];
  return {
    division: record['division'],
    ...(typeof subdivision === 'string' && subdivision.trim() !== ''
      ? { subdivision: subdivision.trim() }
      : {}),
  };
}

/**
 * 迁移旧版 `extra` 中的古籍字段
 *
 * @param metadata 原元数据（不会被修改）
 * @returns 迁移后的新对象
 */
export function migrateLegacyMetadata(metadata: BookMetadata): BookMetadata {
  const extra = metadata.extra;
  if (extra === undefined) return metadata;

  const nextExtra: Record<string, unknown> = { ...extra };
  const next: BookMetadata = { ...metadata };

  if (metadata.repository === undefined && typeof extra['repository'] === 'string') {
    const value = extra['repository'].trim();
    if (value !== '') next.repository = value;
    delete nextExtra['repository'];
  }

  if (metadata.callNumber === undefined && typeof extra['callNumber'] === 'string') {
    const value = extra['callNumber'].trim();
    if (value !== '') next.callNumber = value;
    delete nextExtra['callNumber'];
  }

  if (metadata.editionType === undefined && isEditionType(extra['editionType'])) {
    next.editionType = extra['editionType'] as EditionType;
    delete nextExtra['editionType'];
  }

  if (metadata.classicalCategory === undefined) {
    const category = readClassicalCategory(extra['classicalCategory']);
    if (category !== undefined) {
      next.classicalCategory = category;
      delete nextExtra['classicalCategory'];
    }
  }

  // 已迁移的键不论是否采用（顶层优先）都从 extra 清掉，避免两处并存
  for (const key of LEGACY_KEYS) {
    if (next[key] !== undefined) delete nextExtra[key];
  }

  if (Object.keys(nextExtra).length === 0) {
    delete next.extra;
  } else {
    next.extra = nextExtra;
  }

  return next;
}
