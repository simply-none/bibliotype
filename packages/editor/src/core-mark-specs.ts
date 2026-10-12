/**
 * core 标准标记的 ProseMirror 规格表
 *
 * - 与 IR 的 MARK_TYPES 一一对应；
 * - 公共兜底属性 rawAttrs（未声明属性无损往返）；
 * - link 携带 href；ruby 携带注文 text（对应 IR 的 attrs 约定）。
 */
import { MARK_TYPES } from '@bibliotype/core';
import type { EditorMarkSpecEntry } from './schema-registry.js';

/** 公共兜底属性（供扩展标记规格复用） */
export const COMMON_MARK_ATTRS = {
  rawAttrs: { default: null },
} as const;

/** core 标准标记规格 */
export const CORE_EDITOR_MARK_SPECS: readonly EditorMarkSpecEntry[] = [
  { type: MARK_TYPES.EMPHASIS, spec: { attrs: COMMON_MARK_ATTRS } },
  { type: MARK_TYPES.STRONG, spec: { attrs: COMMON_MARK_ATTRS } },
  { type: MARK_TYPES.UNDERLINE, spec: { attrs: COMMON_MARK_ATTRS } },
  { type: MARK_TYPES.STRIKETHROUGH, spec: { attrs: COMMON_MARK_ATTRS } },
  // 行内代码不可与其他标记叠加（PM 惯例）
  { type: MARK_TYPES.CODE, spec: { excludes: '_', attrs: COMMON_MARK_ATTRS } },
  {
    type: MARK_TYPES.LINK,
    spec: {
      inclusive: false,
      attrs: { ...COMMON_MARK_ATTRS, href: { default: null } },
    },
  },
  {
    type: MARK_TYPES.RUBY,
    spec: {
      attrs: { ...COMMON_MARK_ATTRS, text: { default: null } },
    },
  },
  { type: MARK_TYPES.HIGHLIGHT, spec: { attrs: COMMON_MARK_ATTRS } },
];
