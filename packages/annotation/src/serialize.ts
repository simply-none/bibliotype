/**
 * 标注集合的序列化 / 反序列化
 *
 * 输出确定性：按 `createdAt` 升序、同时间按 `id` 升序排列，同输入必得同字符串
 * （便于测试断言、变更检测与跨端比对）。
 */
import { isAnchor } from '@bibliotype/core';
import { ANNOTATION_KINDS } from './types.js';
import type { Annotation, AnnotationSet } from './types.js';

/** 标注集合 schema 版本 */
export const ANNOTATION_SCHEMA_VERSION = '1.0.0';

/** 运行时判定是否为标注对象 */
export function isAnnotation(value: unknown): value is Annotation {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<Annotation>;
  if (typeof candidate.id !== 'string' || candidate.id.length === 0) {
    return false;
  }
  if (
    typeof candidate.kind !== 'string' ||
    !Object.values(ANNOTATION_KINDS).includes(candidate.kind as Annotation['kind'])
  ) {
    return false;
  }
  if (!isAnchor(candidate.anchor)) {
    return false;
  }
  if (typeof candidate.createdAt !== 'string' || typeof candidate.updatedAt !== 'string') {
    return false;
  }
  if (candidate.comments !== undefined) {
    if (!Array.isArray(candidate.comments)) {
      return false;
    }
    const invalid = candidate.comments.some(
      (entry) =>
        typeof entry !== 'object' ||
        entry === null ||
        typeof entry.id !== 'string' ||
        typeof entry.body !== 'string' ||
        typeof entry.author !== 'object' ||
        entry.author === null ||
        typeof entry.author.id !== 'string',
    );
    if (invalid) {
      return false;
    }
  }
  return true;
}

/** 收集标注集合中的问题（供导入 / 反序列化前置检查） */
export function validateAnnotations(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return ['标注集合必须是数组。'];
  }
  const problems: string[] = [];
  value.forEach((item, index) => {
    if (!isAnnotation(item)) {
      problems.push(`annotations[${index}] 不是合法标注：需包含 id / kind / anchor / 时间字段。`);
    }
  });
  return problems;
}

/** 稳定排序（不修改入参） */
function sortAnnotations(annotations: readonly Annotation[]): Annotation[] {
  return [...annotations].sort((left, right) => {
    if (left.createdAt === right.createdAt) {
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    }
    return left.createdAt < right.createdAt ? -1 : 1;
  });
}

/** 序列化标注集合为 JSON 字符串（确定性输出） */
export function serializeAnnotationSet(
  annotations: readonly Annotation[],
  options: { schemaVersion?: string } = {},
): string {
  const set: AnnotationSet = {
    schemaVersion: options.schemaVersion ?? ANNOTATION_SCHEMA_VERSION,
    annotations: sortAnnotations(annotations),
  };
  return JSON.stringify(set);
}

/**
 * 反序列化标注集合
 *
 * @throws TypeError JSON 非法或结构不合法（错误信息给出修复指向）
 */
export function deserializeAnnotationSet(json: string): AnnotationSet {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new TypeError('反序列化失败：标注集合不是合法 JSON。');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new TypeError('反序列化失败：标注集合必须是对象。');
  }
  const candidate = parsed as Partial<AnnotationSet>;
  if (!Array.isArray(candidate.annotations)) {
    throw new TypeError('反序列化失败：缺少 annotations 数组。');
  }
  const problems = validateAnnotations(candidate.annotations);
  if (problems.length > 0) {
    throw new TypeError(`反序列化失败：${problems.join(' ')}`);
  }
  return {
    schemaVersion:
      typeof candidate.schemaVersion === 'string'
        ? candidate.schemaVersion
        : ANNOTATION_SCHEMA_VERSION,
    annotations: sortAnnotations(candidate.annotations),
  };
}
