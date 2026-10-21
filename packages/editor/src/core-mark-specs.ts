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
  {
    type: MARK_TYPES.EMPHASIS,
    spec: { attrs: COMMON_MARK_ATTRS, parseDOM: [{ tag: 'span.bt-emphasis' }, { tag: 'em' }, { tag: 'i' }] },
  },
  {
    type: MARK_TYPES.STRONG,
    spec: { attrs: COMMON_MARK_ATTRS, parseDOM: [{ tag: 'span.bt-strong' }, { tag: 'strong' }, { tag: 'b' }] },
  },
  {
    type: MARK_TYPES.UNDERLINE,
    spec: {
      attrs: COMMON_MARK_ATTRS,
      parseDOM: [{ tag: 'span.bt-underline' }, { tag: 'u' }, { tag: 'ins' }],
    },
  },
  {
    type: MARK_TYPES.STRIKETHROUGH,
    spec: {
      attrs: COMMON_MARK_ATTRS,
      parseDOM: [{ tag: 'span.bt-strikethrough' }, { tag: 's' }, { tag: 'del' }, { tag: 'strike' }],
    },
  },
  // 行内代码不可与其他标记叠加（PM 惯例）
  {
    type: MARK_TYPES.CODE,
    spec: { excludes: '_', attrs: COMMON_MARK_ATTRS, parseDOM: [{ tag: 'span.bt-code' }, { tag: 'code' }] },
  },
  {
    type: MARK_TYPES.LINK,
    spec: {
      inclusive: false,
      attrs: { ...COMMON_MARK_ATTRS, href: { default: null } },
      parseDOM: [
        { tag: 'span.bt-link' },
        {
          tag: 'a',
          getAttrs: (dom): Record<string, unknown> | false => {
            if (typeof dom === 'string') return false;
            const href = dom.getAttribute('href');
            return href === null ? false : { href };
          },
        },
      ],
    },
  },
  {
    type: MARK_TYPES.RUBY,
    spec: {
      attrs: { ...COMMON_MARK_ATTRS, text: { default: null } },
    },
  },
  // 注引用：正文上标指向注释块（targetId），refId 为回跳锚点；不向后续输入延续
  {
    type: MARK_TYPES.NOTE_REF,
    spec: {
      inclusive: false,
      attrs: {
        ...COMMON_MARK_ATTRS,
        targetId: { default: null },
        refId: { default: null },
      },
      parseDOM: [
        {
          tag: 'a.bt-mark-noteref',
          /* 优先级高于 link 的通用 `a` 规则，否则脚注引用会被解析成普通链接 */
          priority: 60,
          getAttrs: (dom): Record<string, unknown> | false => {
            if (typeof dom === 'string') return false;
            const href = dom.getAttribute('href') ?? '';
            const targetId = href.startsWith('#') ? href.slice(1) : null;
            return { targetId, refId: dom.getAttribute('id') };
          },
        },
      ],
    },
  },
  { type: MARK_TYPES.HIGHLIGHT, spec: { attrs: COMMON_MARK_ATTRS } },
  /**
   * 索引词：书末索引的采集来源
   *
   * `term` 缺省取选中文本（由 `toggleIndexTerm` 写入）；`sortKey` 供手工指定
   * 拼音 / 笔画序，缺省由采集器回退到 `term`。
   */
  {
    type: MARK_TYPES.INDEX_TERM,
    spec: {
      inclusive: false,
      attrs: {
        ...COMMON_MARK_ATTRS,
        term: { default: null },
        sortKey: { default: null },
      },
      parseDOM: [
        {
          tag: 'span.bt-mark-index-term',
          getAttrs: (dom): Record<string, unknown> | false => {
            if (typeof dom === 'string') return false;
            const term = dom.getAttribute('data-term');
            const sortKey = dom.getAttribute('data-sort-key');
            return {
              ...(term === null ? {} : { term }),
              ...(sortKey === null ? {} : { sortKey }),
            };
          },
        },
      ],
    },
  },
  /**
   * 修订标记（C5）：插入 / 删除 / 格式变更
   *
   * - `inclusive: false`：修订标记不向后续输入延续（否则新输入会被误判为同一笔修订）；
   * - `changeId` 是接受 / 拒绝的定位键，`previous` 仅格式变更使用。
   */
  {
    type: MARK_TYPES.INSERTION,
    spec: {
      inclusive: false,
      attrs: {
        ...COMMON_MARK_ATTRS,
        changeId: { default: null },
        author: { default: null },
        timestamp: { default: null },
        previous: { default: null },
      },
      parseDOM: [
        {
          tag: 'ins.bt-mark-insertion',
          getAttrs: (dom): Record<string, unknown> | false =>
            typeof dom === 'string' ? false : readRevisionAttrs(dom),
        },
      ],
    },
  },
  {
    type: MARK_TYPES.DELETION,
    spec: {
      inclusive: false,
      attrs: {
        ...COMMON_MARK_ATTRS,
        changeId: { default: null },
        author: { default: null },
        timestamp: { default: null },
        previous: { default: null },
      },
      parseDOM: [
        {
          tag: 'del.bt-mark-deletion',
          getAttrs: (dom): Record<string, unknown> | false =>
            typeof dom === 'string' ? false : readRevisionAttrs(dom),
        },
      ],
    },
  },
  {
    type: MARK_TYPES.FORMAT_CHANGE,
    spec: {
      inclusive: false,
      attrs: {
        ...COMMON_MARK_ATTRS,
        changeId: { default: null },
        author: { default: null },
        timestamp: { default: null },
        previous: { default: null },
      },
      parseDOM: [
        {
          tag: 'span.bt-mark-format-change',
          getAttrs: (dom): Record<string, unknown> | false =>
            typeof dom === 'string' ? false : readRevisionAttrs(dom),
        },
      ],
    },
  },
];

/** 从 DOM 读取修订标记属性（缺失返回 null，交由 attrs 默认值处理） */
function readRevisionAttrs(dom: HTMLElement): Record<string, unknown> {
  return {
    changeId: dom.getAttribute('data-change-id'),
    author: dom.getAttribute('data-author'),
    timestamp: dom.getAttribute('data-timestamp'),
    previous: dom.getAttribute('data-previous'),
  };
}
