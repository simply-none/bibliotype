/**
 * 古籍节点与标记的 ProseMirror 规格（对应 D8）
 *
 * 依赖方向 classical → editor（单向）：
 * 本模块向 @bibliotype/editor 的 EditorSchemaRegistry 提供古籍专有规格，
 * 由使用方（或 editor-registration 的便捷函数）注册后生效。
 *
 * 公共属性复用 editor 的 COMMON_NODE_ATTRS / COMMON_MARK_ATTRS，
 * 保证 id 与未知属性（rawAttrs）在 IR ⇄ PM 往返中无损。
 */
import { NAMESPACES } from '@bibliotype/core';
import {
  COMMON_MARK_ATTRS,
  COMMON_NODE_ATTRS,
  type EditorMarkSpecEntry,
  type EditorNodeSpecEntry,
} from '@bibliotype/editor';
import { CLASSICAL_MARK_TYPES } from './mark-types.js';
import { CLASSICAL_NODE_TYPES } from './node-types.js';

const ns = NAMESPACES.CLASSICAL;

/** 古籍节点规格（13 种，与 CLASSICAL_NODE_DEFINITIONS 一一对应） */
export const CLASSICAL_EDITOR_NODE_SPECS: readonly EditorNodeSpecEntry[] = [
  /* ---------- 注疏（块级容器，围绕正文段落排印） ---------- */
  {
    type: CLASSICAL_NODE_TYPES.DOUBLE_NOTE,
    namespace: ns,
    spec: { group: 'block', content: 'block+', attrs: COMMON_NODE_ATTRS },
  },
  {
    type: CLASSICAL_NODE_TYPES.INLINE_NOTE,
    namespace: ns,
    spec: { group: 'inline', inline: true, content: 'inline*', attrs: COMMON_NODE_ATTRS },
  },
  {
    type: CLASSICAL_NODE_TYPES.HEAD_NOTE,
    namespace: ns,
    spec: { group: 'block', content: 'block+', attrs: COMMON_NODE_ATTRS },
  },
  {
    type: CLASSICAL_NODE_TYPES.TAIL_NOTE,
    namespace: ns,
    spec: { group: 'block', content: 'block+', attrs: COMMON_NODE_ATTRS },
  },

  /* ---------- 校勘 ---------- */
  {
    type: CLASSICAL_NODE_TYPES.COLLATION_NOTE,
    namespace: ns,
    spec: {
      group: 'block',
      content: 'block+',
      attrs: {
        ...COMMON_NODE_ATTRS,
        /** 校勘记编号（独立序列，`insertCollationNote` 自动取号） */
        marker: { default: null },
        /** 所在对照配对（与 `collation-mark.pairId` 同值） */
        pairId: { default: null },
      },
    },
  },
  {
    type: CLASSICAL_NODE_TYPES.COLLATION_MARK,
    namespace: ns,
    spec: {
      group: 'inline',
      inline: true,
      content: '',
      atom: true,
      attrs: {
        ...COMMON_NODE_ATTRS,
        symbol: { default: null },
        /** 对照配对 id（同一配对的底本 / 校本互指） */
        pairId: { default: null },
        /** 底本 / 校本角色（`base` / `variant`） */
        role: { default: null },
      },
    },
  },

  /* ---------- 字形（异体 / 避讳） ---------- */
  {
    type: CLASSICAL_NODE_TYPES.VARIANT_CHAR,
    namespace: ns,
    spec: { group: 'inline', inline: true, content: 'inline*', attrs: COMMON_NODE_ATTRS },
  },
  {
    type: CLASSICAL_NODE_TYPES.TABOO_CHAR,
    namespace: ns,
    spec: { group: 'inline', inline: true, content: 'inline*', attrs: COMMON_NODE_ATTRS },
  },

  /* ---------- 版本形态（牌记 / 题记 / 版框 / 鱼尾） ---------- */
  {
    type: CLASSICAL_NODE_TYPES.IMPRINT,
    namespace: ns,
    spec: { group: 'block', content: 'block+', attrs: COMMON_NODE_ATTRS },
  },
  {
    type: CLASSICAL_NODE_TYPES.COLOPHON,
    namespace: ns,
    spec: { group: 'block', content: 'block+', attrs: COMMON_NODE_ATTRS },
  },
  {
    type: CLASSICAL_NODE_TYPES.SEAL,
    namespace: ns,
    spec: {
      group: 'inline',
      inline: true,
      content: '',
      atom: true,
      attrs: {
        ...COMMON_NODE_ATTRS,
        text: { default: null },
        /** 朱文 / 白文（缺省朱文） */
        style: { default: null },
        /** 方印回文 / 竖排（缺省方印） */
        layout: { default: null },
        /** 边框粗细（缺省 thick） */
        border: { default: null },
      },
    },
  },
  {
    type: CLASSICAL_NODE_TYPES.BORDER_FRAME,
    namespace: ns,
    spec: { group: 'block', content: 'block+', attrs: COMMON_NODE_ATTRS },
  },
  {
    type: CLASSICAL_NODE_TYPES.FISH_TAIL,
    namespace: ns,
    spec: { group: 'block', content: '', atom: true, attrs: COMMON_NODE_ATTRS },
  },
];

/** 古籍标记规格（6 种，与 CLASSICAL_MARK_TYPES 一一对应） */
export const CLASSICAL_EDITOR_MARK_SPECS: readonly EditorMarkSpecEntry[] = [
  { type: CLASSICAL_MARK_TYPES.PROPER_NAME, namespace: ns, spec: { attrs: COMMON_MARK_ATTRS } },
  { type: CLASSICAL_MARK_TYPES.BOOK_TITLE, namespace: ns, spec: { attrs: COMMON_MARK_ATTRS } },
  {
    type: CLASSICAL_MARK_TYPES.CIRCLE_EMPHASIS,
    namespace: ns,
    spec: { attrs: { ...COMMON_MARK_ATTRS, style: { default: null } } },
  },
  {
    type: CLASSICAL_MARK_TYPES.NOTE_REF,
    namespace: ns,
    spec: { attrs: { ...COMMON_MARK_ATTRS, noteId: { default: null } } },
  },
  { type: CLASSICAL_MARK_TYPES.VARIANT, namespace: ns, spec: { attrs: COMMON_MARK_ATTRS } },
  { type: CLASSICAL_MARK_TYPES.TABOO, namespace: ns, spec: { attrs: COMMON_MARK_ATTRS } },
];
