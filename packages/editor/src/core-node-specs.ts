/**
 * core 标准节点的 ProseMirror 规格表
 *
 * - 与 IR 的 NODE_TYPES 一一对应（含 text，ProseMirror 要求显式登记并归入 inline group）；
 * - 内容表达式仅使用 group 名（block / inline / list_item / table_row / table_cell），
 *   避免 kebab-case 节点名出现在表达式中（ProseMirror 内容表达式词法限制）；
 * - 公共属性：id（稳定标识）与 rawAttrs（未声明属性兜底，保证 IR 无损往返）。
 */
import { NODE_TYPES } from '@bibliotype/core';
import type { EditorNodeSpecEntry } from './schema-registry.js';

/** 公共属性：稳定 id 与未声明属性兜底（供扩展节点规格复用） */
export const COMMON_NODE_ATTRS = {
  id: { default: null },
  rawAttrs: { default: null },
} as const;

/** 结构节点属性（附标题，reader 目录提取依赖；供扩展规格复用） */
export const STRUCTURE_NODE_ATTRS = {
  ...COMMON_NODE_ATTRS,
  title: { default: null },
} as const;

/** core 标准节点规格 */
export const CORE_EDITOR_NODE_SPECS: readonly EditorNodeSpecEntry[] = [
  /* ---------- 根与结构节点 ---------- */
  { type: NODE_TYPES.BOOK, spec: { content: 'block*', attrs: COMMON_NODE_ATTRS } },
  { type: NODE_TYPES.COVER, spec: { group: 'block', content: 'block*', attrs: COMMON_NODE_ATTRS } },
  { type: NODE_TYPES.TITLE_PAGE, spec: { group: 'block', content: 'block*', attrs: COMMON_NODE_ATTRS } },
  { type: NODE_TYPES.COPYRIGHT_PAGE, spec: { group: 'block', content: 'block*', attrs: COMMON_NODE_ATTRS } },
  { type: NODE_TYPES.BACK_COVER, spec: { group: 'block', content: 'block*', attrs: COMMON_NODE_ATTRS } },
  { type: NODE_TYPES.VOLUME, spec: { group: 'block', content: 'block*', attrs: STRUCTURE_NODE_ATTRS } },
  { type: NODE_TYPES.CHAPTER, spec: { group: 'block', content: 'block*', attrs: STRUCTURE_NODE_ATTRS } },
  { type: NODE_TYPES.SECTION, spec: { group: 'block', content: 'block*', attrs: STRUCTURE_NODE_ATTRS } },
  { type: NODE_TYPES.APPENDIX, spec: { group: 'block', content: 'block*', attrs: STRUCTURE_NODE_ATTRS } },
  { type: NODE_TYPES.PREFACE, spec: { group: 'block', content: 'block*', attrs: STRUCTURE_NODE_ATTRS } },
  { type: NODE_TYPES.POSTSCRIPT, spec: { group: 'block', content: 'block*', attrs: STRUCTURE_NODE_ATTRS } },
  { type: NODE_TYPES.TOC, spec: { group: 'block', content: 'block*', attrs: STRUCTURE_NODE_ATTRS } },

  /* ---------- 块级内容节点 ---------- */
  { type: NODE_TYPES.PARAGRAPH, spec: { group: 'block', content: 'inline*', attrs: COMMON_NODE_ATTRS } },
  {
    type: NODE_TYPES.HEADING,
    spec: {
      group: 'block',
      content: 'inline*',
      attrs: { ...COMMON_NODE_ATTRS, level: { default: 1 } },
    },
  },
  { type: NODE_TYPES.QUOTE, spec: { group: 'block', content: 'block+', attrs: COMMON_NODE_ATTRS } },
  {
    type: NODE_TYPES.LIST,
    spec: {
      group: 'block',
      content: 'list_item+',
      attrs: { ...COMMON_NODE_ATTRS, ordered: { default: false } },
    },
  },
  { type: NODE_TYPES.LIST_ITEM, spec: { group: 'list_item', content: 'block+', attrs: COMMON_NODE_ATTRS } },
  {
    type: NODE_TYPES.IMAGE,
    spec: {
      group: 'block',
      content: '',
      atom: true,
      attrs: { ...COMMON_NODE_ATTRS, src: { default: null }, alt: { default: null } },
    },
  },
  { type: NODE_TYPES.CAPTION, spec: { group: 'block', content: 'inline*', attrs: COMMON_NODE_ATTRS } },
  { type: NODE_TYPES.TABLE, spec: { group: 'block', content: 'table_row+', attrs: COMMON_NODE_ATTRS } },
  { type: NODE_TYPES.TABLE_ROW, spec: { group: 'table_row', content: 'table_cell+', attrs: COMMON_NODE_ATTRS } },
  { type: NODE_TYPES.TABLE_CELL, spec: { group: 'table_cell', content: 'block+', attrs: COMMON_NODE_ATTRS } },
  {
    type: NODE_TYPES.CODE_BLOCK,
    spec: {
      group: 'block',
      content: 'text*',
      marks: '',
      code: true,
      attrs: { ...COMMON_NODE_ATTRS, language: { default: null } },
    },
  },
  {
    type: NODE_TYPES.MATH_BLOCK,
    spec: {
      group: 'block',
      content: '',
      atom: true,
      attrs: { ...COMMON_NODE_ATTRS, tex: { default: null } },
    },
  },
  {
    type: NODE_TYPES.BREAK,
    spec: {
      group: 'block',
      content: '',
      atom: true,
      attrs: { ...COMMON_NODE_ATTRS, variant: { default: null } },
    },
  },

  /* ---------- 注释节点 ---------- */
  { type: NODE_TYPES.FOOTNOTE, spec: { group: 'block', content: 'block+', attrs: COMMON_NODE_ATTRS } },
  { type: NODE_TYPES.ENDNOTE, spec: { group: 'block', content: 'block+', attrs: COMMON_NODE_ATTRS } },
  { type: NODE_TYPES.MARGIN_NOTE, spec: { group: 'block', content: 'block+', attrs: COMMON_NODE_ATTRS } },

  /* ---------- 行内节点 ---------- */
  // text 节点规格由 ProseMirror 特殊处理，仅需归入 inline group
  { type: NODE_TYPES.TEXT, spec: { group: 'inline' } },
  {
    type: NODE_TYPES.MATH_INLINE,
    spec: {
      group: 'inline',
      inline: true,
      content: '',
      atom: true,
      attrs: { ...COMMON_NODE_ATTRS, tex: { default: null } },
    },
  },
];
