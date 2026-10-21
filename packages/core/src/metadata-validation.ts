/**
 * 书目元数据校验（K7）
 *
 * 古籍编目字段一旦写错，导出的 MARC / DC 记录会被下游系统拒收或错挂，
 * 因此校验放在 `core` 而不是各导出器：同一份元数据在任何出口前都可先过一遍。
 *
 * 口径：**返回 issue 清单，不抛错**——导入侧要展示「哪几项需要修」，
 * 而不是遇到第一个坏字段就中断。
 */
import {
  CLASSICAL_DIVISIONS,
  EDITION_TYPES,
  type BookMetadata,
  type ClassicalDivision,
  type EditionType,
} from './ir/metadata.js';

/** 单条元数据问题 */
export interface MetadataIssue {
  /** 字段路径（如 `classicalCategory.division`） */
  field: string;
  /** 中文说明 */
  message: string;
}

/** 标识符类型白名单 */
const IDENTIFIER_SCHEMES: ReadonlySet<string> = new Set([
  'isbn',
  'issn',
  'doi',
  'cnmarc',
  'other',
]);

/** 文本字段长度上限（防止把整段正文塞进元数据） */
const MAX_TEXT_LENGTH = 200;

/** 是否为非空文本 */
function filled(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** 是否为合法的四部枚举值 */
export function isClassicalDivision(value: unknown): value is ClassicalDivision {
  return (
    typeof value === 'string' && CLASSICAL_DIVISIONS.some((item) => item.value === value)
  );
}

/** 是否为合法的版本类型 */
export function isEditionType(value: unknown): value is EditionType {
  return typeof value === 'string' && EDITION_TYPES.some((item) => item.value === value);
}

/**
 * 校验书目元数据
 *
 * @param metadata 待校验元数据
 * @returns 问题清单（按字段顺序）；无问题时为空数组
 */
export function validateMetadata(metadata: BookMetadata): MetadataIssue[] {
  const issues: MetadataIssue[] = [];

  if (!filled(metadata.title)) {
    issues.push({ field: 'title', message: '书名不能为空' });
  } else if (metadata.title.length > MAX_TEXT_LENGTH) {
    issues.push({ field: 'title', message: `书名超过 ${MAX_TEXT_LENGTH} 字` });
  }

  for (const [index, contributor] of (metadata.contributors ?? []).entries()) {
    if (!filled(contributor.name)) {
      issues.push({
        field: `contributors.${index}.name`,
        message: '责任者姓名不能为空',
      });
    }
  }

  if (metadata.volumeCount !== undefined) {
    if (!Number.isInteger(metadata.volumeCount) || metadata.volumeCount <= 0) {
      issues.push({ field: 'volumeCount', message: '卷数必须为正整数' });
    }
  }

  for (const [index, identifier] of (metadata.identifiers ?? []).entries()) {
    if (!IDENTIFIER_SCHEMES.has(identifier.scheme)) {
      issues.push({
        field: `identifiers.${index}.scheme`,
        message: `未知标识符类型「${String(identifier.scheme)}」`,
      });
    }
    if (!filled(identifier.value)) {
      issues.push({
        field: `identifiers.${index}.value`,
        message: '标识符值不能为空',
      });
    }
  }

  if (metadata.classicalCategory !== undefined) {
    const { division, subdivision } = metadata.classicalCategory;
    if (!isClassicalDivision(division)) {
      issues.push({
        field: 'classicalCategory.division',
        message: `四部取值「${String(division)}」非法（应为 jing / shi / zi / ji）`,
      });
    }
    if (subdivision !== undefined && subdivision.length > MAX_TEXT_LENGTH) {
      issues.push({
        field: 'classicalCategory.subdivision',
        message: `二级类名超过 ${MAX_TEXT_LENGTH} 字`,
      });
    }
  }

  if (metadata.editionType !== undefined && !isEditionType(metadata.editionType)) {
    issues.push({
      field: 'editionType',
      message: `版本类型「${String(metadata.editionType)}」非法（应为 block-print / manuscript / movable-type / draft）`,
    });
  }

  for (const field of ['repository', 'callNumber'] as const) {
    const value = metadata[field];
    if (value === undefined) continue;
    if (!filled(value)) {
      issues.push({ field, message: '字段已填写但不能为空白' });
    } else if (value.length > MAX_TEXT_LENGTH) {
      issues.push({ field, message: `超过 ${MAX_TEXT_LENGTH} 字` });
    }
  }

  if (metadata.language !== undefined && !/^[A-Za-z]{2,3}(-[A-Za-z0-9]+)*$/.test(metadata.language)) {
    issues.push({
      field: 'language',
      message: '语言标记不合 BCP 47（如 zh-Hans、en）',
    });
  }

  return issues;
}
