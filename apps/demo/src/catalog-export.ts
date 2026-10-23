/**
 * 编目导出与查看态格式化纯函数
 *
 * 只承接「输入 → 输出」的确定性计算：DC JSON / CNMARC 文本生成、文件名清洗、
 * 责任者 / 标识符 / 时间戳的展示格式化；下载等副作用留在组件层，本文件不触碰 DOM。
 */
import {
  serializeDublinCore,
  toCnmarc,
  toDublinCore,
  type BookMetadata,
  type Contributor,
} from '@bibliotype/core';

/** 标识符 scheme → 展示名 */
const SCHEME_LABELS: Readonly<Record<string, string>> = {
  isbn: 'ISBN',
  issn: 'ISSN',
  doi: 'DOI',
  cnmarc: 'CNMARC',
  other: '标识符',
};

/** 文件名去非法字符（空标题回退 bibliotype） */
export function safeFilename(title: string): string {
  return (title.trim() === '' ? 'bibliotype' : title.trim()).replace(/[\\/:*?"<>|]+/g, '_');
}

/** 元数据 → 都柏林核心 JSON 文本 */
export function toDublinCoreJson(metadata: BookMetadata): string {
  return serializeDublinCore(toDublinCore(metadata));
}

/** 元数据 → CNMARC 字段行文本 */
export function toCnmarcText(metadata: BookMetadata): string {
  return toCnmarc(metadata);
}

/** 责任者展示串：朝代 / 姓名 / 角色以全角空格拼接 */
export function contributorText(contributor: Contributor): string {
  return [contributor.dynasty, contributor.name, contributor.role]
    .filter((part) => part !== undefined && part !== '')
    .join('　');
}

/** 标识符 scheme 展示名（未映射键大写原样） */
export function schemeText(scheme: string): string {
  return SCHEME_LABELS[scheme] ?? scheme.toUpperCase();
}

/** 时间戳展示：数值按本地时间格式化，其余原样字符串化 */
export function formatTimestamp(value: unknown): string {
  if (typeof value === 'number') return new Date(value).toLocaleString();
  return String(value);
}
