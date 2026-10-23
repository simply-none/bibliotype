/**
 * 功能样式字段元数据（设置面板的表单来源）
 *
 * 目标：新增一个可调参数只改字段表，不改组件 —— `FeatureStyleEditor` 按本表渲染控件。
 * 本文件为门面：合并「现代节点」与「古籍标记」两段字段表，并保留公开 API
 * （`STYLE_FIELDS` / `getStyleFields` / `listSections` / `StyleField` / `StyleControl`）。
 *
 * 约定：
 * - `property` 为**最终写入 CSS 的属性名**（kebab-case），值原样进样式表；
 * - 数值控件由 `unit` 拼接单位（`1.6` + `em` → `1.6em`），值为空表示「不覆盖」；
 * - 「不覆盖」与「取空值」是两件事：清空输入 = 删除该声明（回落到默认样式），
 *   而不是写空串（空串会让整条声明失效甚至被老引擎丢弃）。
 * - 未在本表登记细节的功能，仍可在面板的「自定义声明」里直接写 CSS，
 *   因此不存在「某功能完全无法配置」的情况。
 */
import type { FeatureStyleId } from '@bibliotype/core';
import type { StyleField } from './style-field-helpers.js';
import { CLASSICAL_STYLE_FIELDS } from './style-fields-classical.js';
import { CORE_STYLE_FIELDS } from './style-fields-core.js';

export type { StyleControl, StyleField } from './style-field-helpers.js';

/** 全部已登记的功能字段（现代节点 + 古籍标记，未登记的功能用「自定义声明」兜底） */
export const STYLE_FIELDS: Partial<Record<FeatureStyleId, StyleField[]>> = {
  ...CORE_STYLE_FIELDS,
  ...CLASSICAL_STYLE_FIELDS,
};

/** 取某功能的字段表（无登记返回空数组 → 面板只剩「自定义声明」） */
export function getStyleFields(id: FeatureStyleId): StyleField[] {
  return STYLE_FIELDS[id] ?? [];
}

/** 分组内的小节顺序（保持字段声明顺序，这里只做去重收集） */
export function listSections(fields: readonly StyleField[]): string[] {
  const sections: string[] = [];
  for (const field of fields) {
    const section = field.section ?? '基本';
    if (!sections.includes(section)) sections.push(section);
  }
  return sections;
}
