/**
 * IR 属性 ⇄ ProseMirror 属性双向映射
 *
 * 约定：
 * - spec 显式声明的属性键直接映射（如 title、level、href）；
 * - 其余键打包进保留属性 rawAttrs（JSON 对象），保证 IR 无损往返；
 * - null / undefined 视为缺省；
 * - 反向转换时跳过等于 spec 默认值的属性（规范化省略）；
 * - 节点 id 是 IR 顶层字段，由转换层单独处理（不在本模块职责内）。
 */
import type { Attrs, AttrValue } from '@bibliotype/core';

/** 保留属性名：承载未显式声明的 IR 属性 */
export const RAW_ATTRS_ATTR = 'rawAttrs';

/**
 * 提取 spec 显式声明的属性名
 *
 * 排除保留名：rawAttrs（兜底容器）与 id（IR 顶层字段，单独处理）。
 */
export function declaredAttrNames(
  specAttrs: Record<string, unknown> | null | undefined,
): string[] {
  return Object.keys(specAttrs ?? {}).filter(
    (name) => name !== RAW_ATTRS_ATTR && name !== 'id',
  );
}

/**
 * IR attrs → PM attrs
 *
 * - 已声明键 → 对应 PM 属性；
 * - 未声明键 → 打包进 rawAttrs；
 * - 值为 null / undefined 的键视为缺省，不输出。
 */
export function toPmAttrs(
  irAttrs: Attrs | undefined,
  specAttrs: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const declared = new Set(declaredAttrNames(specAttrs));
  const result: Record<string, unknown> = {};
  const rest: Attrs = {};

  for (const [key, value] of Object.entries(irAttrs ?? {})) {
    if (value === undefined || value === null) {
      continue;
    }
    if (declared.has(key)) {
      result[key] = value;
    } else {
      rest[key] = value;
    }
  }

  if (Object.keys(rest).length > 0) {
    result[RAW_ATTRS_ATTR] = rest;
  }
  return result;
}

/**
 * PM attrs → IR attrs
 *
 * - rawAttrs 中的键值展开回顶层；
 * - 等于 spec 默认值的属性规范化为省略；
 * - 结果为空时返回 undefined（IR 中"无属性"即缺省）。
 */
export function toIrAttrs(
  pmAttrs: Record<string, unknown>,
  specAttrs: Record<string, unknown> | null | undefined,
): Attrs | undefined {
  const result: Attrs = {};

  const raw = pmAttrs[RAW_ATTRS_ATTR];
  if (typeof raw === 'object' && raw !== null) {
    Object.assign(result, raw as Attrs);
  }

  for (const name of declaredAttrNames(specAttrs)) {
    const value = pmAttrs[name];
    if (value === undefined || value === null) {
      continue;
    }
    const attrSpec = (specAttrs ?? {})[name] as { default?: unknown } | undefined;
    if (attrSpec !== undefined && 'default' in attrSpec && attrSpec.default === value) {
      continue; // 等于默认值：规范化为缺省
    }
    result[name] = value as AttrValue;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}
