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

/**
 * 标识符规范化（平台入库友好）
 *
 * - ISBN-10 / ISBN-13：剥空白后转 `urn:isbn:<digits>`（京东读书 / 微信读书
 *   书目库按 ISBN 关联，裸数字在某些校验链会被判无效标识符）；
 * - 已是 `urn:` / `http(s):` / `doi:` 等 URI 形态：原样返回；
 * - 其余：原样返回（由校验器按 WARNING 提示）。
 */
export function normalizeIdentifier(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') return trimmed;
  if (/^(?:urn:|https?:|doi:|mailto:)/i.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/[\s-]/g, '');
  if (isIsbn(digits)) return `urn:isbn:${digits}`;
  return trimmed;
}

/** ISBN-10 / ISBN-13 校验（含校验位；宽松接受 X 结尾的 ISBN-10） */
export function isIsbn(value: string): boolean {
  const digits = value.replace(/[\s-]/g, '');
  if (digits.length === 10) {
    if (!/^\d{9}[\dXx]$/.test(digits)) return false;
    let sum = 0;
    for (let i = 0; i < 9; i += 1) sum += (digits.charCodeAt(i) - 48) * (10 - i);
    const last = digits[9]!.toUpperCase() === 'X' ? 10 : digits.charCodeAt(9) - 48;
    sum += last;
    return sum % 11 === 0;
  }
  if (digits.length === 13) {
    if (!/^\d{13}$/.test(digits)) return false;
    let sum = 0;
    for (let i = 0; i < 12; i += 1) sum += (digits.charCodeAt(i) - 48) * (i % 2 === 0 ? 1 : 3);
    const check = (10 - (sum % 10)) % 10;
    return check === digits.charCodeAt(12) - 48;
  }
  return false;
}

/** 生成确定性缺省标识符（urn:bibliotype:<hash>，散列源含书名与时间戳） */
export function buildDefaultIdentifier(document: BookDocument): string {
  const { title } = document.metadata;
  const stamp = `${document.metadata.createdAt ?? ''}|${document.metadata.updatedAt ?? ''}`;
  return `urn:bibliotype:${fnv1a(`${title}|${stamp}|${document.schemaVersion}`)}`;
}
