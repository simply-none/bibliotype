/**
 * EPUB 标识符工具
 *
 * 缺省标识符需「确定性」：同一文档重复导出得到同一 urn，
 * 便于版本比对与增量发布（不使用随机 UUID）。
 */
import type { BookDocument, BookMetadata } from '@bibliotype/core';

/** FNV-1a 32 位散列（十六进制，8 字符） */
export function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** 从元数据解析已有标识符（取首个非空项） */
export function resolveIdentifier(metadata: BookMetadata): string | undefined {
  const found = metadata.identifiers?.find((item) => item.value.length > 0);
  return found?.value;
}

/** 生成确定性缺省标识符（urn:bibliotype:<hash>，散列源含书名与时间戳） */
export function buildDefaultIdentifier(document: BookDocument): string {
  const { title } = document.metadata;
  const stamp = `${document.metadata.createdAt ?? ''}|${document.metadata.updatedAt ?? ''}`;
  return `urn:bibliotype:${fnv1a(`${title}|${stamp}|${document.schemaVersion}`)}`;
}
