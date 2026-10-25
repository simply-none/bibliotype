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
  STRUCTURE_NODE_ATTRS,
  type EditorMarkSpecEntry,
  type EditorNodeSpecEntry,
} from '@bibliotype/editor';
import type { DOMOutputSpec, Mark, MarkSpec } from 'prosemirror-model';
import { CLASSICAL_MARK_TYPES } from './mark-types.js';
import { CLASSICAL_NODE_TYPES } from './node-types.js';

const ns = NAMESPACES.CLASSICAL;

/**
 * 标记属性 → data-*
 *
 * 编辑画布的默认 mark DOM 不带属性；句读候选的 `.bt-mark-judou::after` 依赖
 * `data-symbol` 渲染候选符号，因此该标记需要显式 toDOM（与序列化器同口径：
 * rawAttrs 展开、其余键转 kebab 前缀 data-）。
 */
function markDomAttrs(mark: Mark): Record<string, string> {
  const result: Record<string, string> = {};
  const raw = mark.attrs['rawAttrs'];
  if (typeof raw === 'object' && raw !== null) {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (value === null || value === undefined) continue;
      result[`data-${key}`] = String(value);
    }
  }
  for (const [key, value] of Object.entries(mark.attrs)) {
    if (key === 'id' || key === 'rawAttrs') continue;
    if (value === null || value === undefined || value === '') continue;
    result[`data-${key}`] = String(value);
  }
  return result;
}

/** 句读候选标记的 DOM 表现与解析（属性名与 `layout` 序列化一致） */
const JUDOU_MARK_DOM: Pick<MarkSpec, 'toDOM' | 'parseDOM'> = {
  toDOM: (mark: Mark): DOMOutputSpec => [
    'span',
    { class: 'bt-mark-judou', ...markDomAttrs(mark) },
    0,
  ],
  parseDOM: [
    {
      tag: 'span.bt-mark-judou',
      getAttrs: (dom: HTMLElement | string): Record<string, unknown> | false => {
        if (typeof dom === 'string') return false;
        const read = (name: string): string | null => dom.getAttribute(`data-${name}`);
        const confidenceText = read('confidence');
        const confidence =
          confidenceText === null || confidenceText.trim() === ''
            ? null
            : Number(confidenceText);
        return {
          symbol: read('symbol'),
          source: read('source'),
          suggestionId: read('suggestionId'),
          rule: read('rule'),
          confidence: Number.isFinite(confidence) ? confidence : null,
        };
      },
    },
  ],
};

/** 古籍节点规格（13 种，与 CLASSICAL_NODE_DEFINITIONS 一一对应） */
export const CLASSICAL_EDITOR_NODE_SPECS: readonly EditorNodeSpecEntry[] = [
  /* ---------- 注疏（块级容器，围绕正文段落排印） ---------- */
  {
    type: CLASSICAL_NODE_TYPES.DOUBLE_NOTE,
    namespace: ns,
    /* 行内夹注（古籍口径：随文双行连排不换列）——与 inline-note 同形态；
     * 直排列内双行渲染属排版引擎 v2 批 2（列盒渲染器），本规格先立模型 */
    spec: { group: 'inline', inline: true, content: 'inline*', attrs: COMMON_NODE_ATTRS },
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
  {
    type: CLASSICAL_NODE_TYPES.INK_NAIL,
    namespace: ns,
    /* 墨钉：未定字的占位黑块（行内原子，渲染 1em 实心方） */
    spec: { group: 'inline', inline: true, content: '', atom: true, attrs: COMMON_NODE_ATTRS },
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
    type: CLASSICAL_NODE_TYPES.GENERAL_REVIEW,
    namespace: ns,
    /* 卷末总评：与跋语并列的结构部件（title 供目录提取，同结构节点语义） */
    spec: { group: 'block', content: 'block+', attrs: STRUCTURE_NODE_ATTRS },
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

/** 古籍标记规格（7 种，与 CLASSICAL_MARK_TYPES 一一对应） */
export const CLASSICAL_EDITOR_MARK_SPECS: readonly EditorMarkSpecEntry[] = [
  {
    /* 专名号：自动建议写入 source / suggestionId，手工标记不写（保持既有行为） */
    type: CLASSICAL_MARK_TYPES.PROPER_NAME,
    namespace: ns,
    spec: {
      attrs: {
        ...COMMON_MARK_ATTRS,
        source: { default: null },
        suggestionId: { default: null },
        nameKind: { default: null },
        confidence: { default: null },
      },
    },
  },
  { type: CLASSICAL_MARK_TYPES.BOOK_TITLE, namespace: ns, spec: { attrs: COMMON_MARK_ATTRS } },
  {
    type: CLASSICAL_MARK_TYPES.CIRCLE_EMPHASIS,
    namespace: ns,
    spec: { attrs: { ...COMMON_MARK_ATTRS, style: { default: null } } },
  },
  {
    /* 句读候选：symbol 驱动伪元素渲染，source=auto 供「拒绝全部自动标记」识别 */
    type: CLASSICAL_MARK_TYPES.JUDOU,
    namespace: ns,
    spec: {
      attrs: {
        ...COMMON_MARK_ATTRS,
        symbol: { default: null },
        source: { default: null },
        suggestionId: { default: null },
        rule: { default: null },
        confidence: { default: null },
      },
      ...JUDOU_MARK_DOM,
    },
  },
  {
    type: CLASSICAL_MARK_TYPES.NOTE_REF,
    namespace: ns,
    spec: { attrs: { ...COMMON_MARK_ATTRS, noteId: { default: null } } },
  },
  { type: CLASSICAL_MARK_TYPES.VARIANT, namespace: ns, spec: { attrs: COMMON_MARK_ATTRS } },
  { type: CLASSICAL_MARK_TYPES.TABOO, namespace: ns, spec: { attrs: COMMON_MARK_ATTRS } },
];
