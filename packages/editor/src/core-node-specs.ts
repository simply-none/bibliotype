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

/**
 * 行款规则属性（古籍直排 v2 批 1 登记；段落 / 结构 / 注文类节点通用）
 *
 * - `indent` 低 N 格：直排 = 列首空 N 字位，横排 = 首行缩进 N 字；
 * - `lift` 抬头：`'space'` 空抬 / 挪抬（行内空一字），`'newline'` 平抬（提行顶格）；
 * - `liftLevel` 单 / 双 / 三 / 四抬（提行高出 N 字，仅 `lift: 'newline'` 生效）；
 * - `breakLine` 提行另起（行级另起一列，区别于另起页的分页符）；
 * - `band` 两截本内容归属（上 / 下栏）。
 *
 * 缺省 null：attr-mapper 将 null 规范化为缺省，不参与 IR 序列化输出，
 * 未使用行款的文档逐字节不变；渲染 / 分页侧消费属后续批次（批 2 / 批 4）。
 */
export const LINE_RULE_ATTRS = {
  /** 低 N 格（1~4） */
  indent: { default: null },
  /** 抬头形式（space 空抬·挪抬 / newline 平抬） */
  lift: { default: null },
  /** 抬头层级（1~4：单 / 双 / 三 / 四抬） */
  liftLevel: { default: null },
  /** 提行另起一列 */
  breakLine: { default: null },
  /** 两截本内容归属（upper / lower） */
  band: { default: null },
} as const;

/** 公共属性：稳定 id、行款规则与未声明属性兜底（供扩展节点规格复用） */
export const COMMON_NODE_ATTRS = {
  id: { default: null },
  ...LINE_RULE_ATTRS,
  rawAttrs: { default: null },
} as const;

/** 结构节点属性（附标题，reader 目录提取依赖；供扩展规格复用） */
export const STRUCTURE_NODE_ATTRS = {
  ...COMMON_NODE_ATTRS,
  title: { default: null },
} as const;

/** 可分栏的结构节点属性（chapter / section；columns 缺省 1 为单栏） */
export const SECTION_NODE_ATTRS = {
  ...STRUCTURE_NODE_ATTRS,
  /** 分栏数（1~3；缺省 1） */
  columns: { default: 1 },
} as const;

/** 注释节点属性（脚注 / 尾注 / 边注共用；marker 为显示注码，refId 为正文引用的回跳锚点） */
export const NOTE_NODE_ATTRS = {
  ...COMMON_NODE_ATTRS,
  marker: { default: null },
  refId: { default: null },
} as const;

/**
 * 读取 `<td>` / `<th>` 的跨行跨列与对齐
 *
 * - 跨行跨列按 HTML 原生属性读取，非正 / 非法值归一为 1（默认值会在 PM → IR 时省略）；
 * - 对齐兼容 `data-align`（本库导出约定）、`align`（历史 HTML）与内联 `text-align`；
 * - 仅接受 left / center / right，其余（如 justify）交给样式表处理。
 */
function cellAttrsFromDom(dom: string | HTMLElement): Record<string, unknown> | false {
  if (typeof dom === 'string') {
    return false;
  }
  const readSpan = (name: string): number => {
    const raw = Number.parseInt(dom.getAttribute(name) ?? '', 10);
    return Number.isFinite(raw) && raw > 1 ? raw : 1;
  };
  const rawAlign = dom.getAttribute('data-align') ?? dom.getAttribute('align') ?? '';
  const styleAlign =
    /text-align\s*:\s*(left|center|right)/i.exec(dom.getAttribute('style') ?? '')?.[1] ?? '';
  const align = (rawAlign || styleAlign).toLowerCase();
  return {
    colspan: readSpan('colspan'),
    rowspan: readSpan('rowspan'),
    align: align === 'left' || align === 'center' || align === 'right' ? align : null,
  };
}

/** 读 img 原生像素尺寸属性（缺省 / 非法归一为 null，走 spec 缺省；NaN 进 attrs 会破坏 PM 解析） */
function intAttrFromDom(dom: string | HTMLElement, name: string): number | null {
  if (typeof dom === 'string') return null;
  const raw = Number.parseInt(dom.getAttribute(name) ?? '', 10);
  return Number.isFinite(raw) ? raw : null;
}

/** core 标准节点规格 */
export const CORE_EDITOR_NODE_SPECS: readonly EditorNodeSpecEntry[] = [
  /* ---------- 根与结构节点 ---------- */
  { type: NODE_TYPES.BOOK, spec: { content: 'block*', attrs: COMMON_NODE_ATTRS } },
  { type: NODE_TYPES.COVER, spec: { group: 'block', content: 'block*', attrs: COMMON_NODE_ATTRS } },
  { type: NODE_TYPES.TITLE_PAGE, spec: { group: 'block', content: 'block*', attrs: COMMON_NODE_ATTRS } },
  { type: NODE_TYPES.COPYRIGHT_PAGE, spec: { group: 'block', content: 'block*', attrs: COMMON_NODE_ATTRS } },
  { type: NODE_TYPES.BACK_COVER, spec: { group: 'block', content: 'block*', attrs: COMMON_NODE_ATTRS } },
  { type: NODE_TYPES.VOLUME, spec: { group: 'block', content: 'block*', attrs: STRUCTURE_NODE_ATTRS } },
  { type: NODE_TYPES.CHAPTER, spec: { group: 'block', content: 'block*', attrs: SECTION_NODE_ATTRS } },
  { type: NODE_TYPES.SECTION, spec: { group: 'block', content: 'block*', attrs: SECTION_NODE_ATTRS } },
  { type: NODE_TYPES.APPENDIX, spec: { group: 'block', content: 'block*', attrs: STRUCTURE_NODE_ATTRS } },
  { type: NODE_TYPES.PREFACE, spec: { group: 'block', content: 'block*', attrs: STRUCTURE_NODE_ATTRS } },
  { type: NODE_TYPES.POSTSCRIPT, spec: { group: 'block', content: 'block*', attrs: STRUCTURE_NODE_ATTRS } },
  { type: NODE_TYPES.TOC, spec: { group: 'block', content: 'block*', attrs: STRUCTURE_NODE_ATTRS } },

  /* ---------- 块级内容节点 ---------- */
  {
    type: NODE_TYPES.PARAGRAPH,
    spec: {
      group: 'block',
      content: 'inline*',
      attrs: COMMON_NODE_ATTRS,
      parseDOM: [
        { tag: 'div.bt-paragraph' },
        {
          /* DOCX 导入：mammoth styleMap 输出 `docx-style-<id>`，回收为命名样式 */
          tag: 'p',
          getAttrs: (dom): Record<string, unknown> | false => {
            if (typeof dom === 'string') return false;
            const match = /(?:^|\s)docx-style-([A-Za-z0-9_-]+)/.exec(
              dom.getAttribute('class') ?? '',
            );
            return match === null ? {} : { rawAttrs: { styleId: `ns-docx-${match[1]}` } };
          },
        },
      ],
    },
  },
  {
    type: NODE_TYPES.HEADING,
    spec: {
      group: 'block',
      content: 'inline*',
      attrs: { ...COMMON_NODE_ATTRS, level: { default: 1 } },
      // 首位保留自有类选择器（不回归既有默认行为），再补充标准 h1~h6（level 由标签推断）
      parseDOM: [
        { tag: 'div.bt-heading' },
        { tag: 'h1', getAttrs: () => ({ level: 1 }) },
        { tag: 'h2', getAttrs: () => ({ level: 2 }) },
        { tag: 'h3', getAttrs: () => ({ level: 3 }) },
        { tag: 'h4', getAttrs: () => ({ level: 4 }) },
        { tag: 'h5', getAttrs: () => ({ level: 5 }) },
        { tag: 'h6', getAttrs: () => ({ level: 6 }) },
      ],
    },
  },
  {
    type: NODE_TYPES.QUOTE,
    spec: {
      group: 'block',
      content: 'block+',
      attrs: COMMON_NODE_ATTRS,
      parseDOM: [{ tag: 'div.bt-quote' }, { tag: 'blockquote' }],
    },
  },
  {
    type: NODE_TYPES.LIST,
    spec: {
      group: 'block',
      content: 'list_item+',
      attrs: { ...COMMON_NODE_ATTRS, ordered: { default: false } },
      // ul → 无序；ol → 有序；自有 div.bt-list 置首保留回环
      parseDOM: [
        { tag: 'div.bt-list' },
        { tag: 'ul', getAttrs: () => ({ ordered: false }) },
        { tag: 'ol', getAttrs: () => ({ ordered: true }) },
      ],
    },
  },
  {
    type: NODE_TYPES.LIST_ITEM,
    spec: {
      group: 'list_item',
      content: 'block+',
      attrs: COMMON_NODE_ATTRS,
      parseDOM: [{ tag: 'div.bt-list-item' }, { tag: 'li' }],
    },
  },
  {
    type: NODE_TYPES.IMAGE,
    spec: {
      group: 'block',
      content: '',
      atom: true,
      attrs: {
        ...COMMON_NODE_ATTRS,
        src: { default: null },
        alt: { default: null },
        /* 原生像素尺寸（导入保留）：字图识别的「近方形小图」强信号与插图渲染保真依赖它 */
        width: { default: null },
        height: { default: null },
      },
      parseDOM: [
        { tag: 'div.bt-image' },
        {
          tag: 'img',
          getAttrs: (dom): Record<string, unknown> | false => {
            if (typeof dom === 'string') return false;
            /* 字图（img.bt-glyph-image）让给 glyph-image 的行内规则，
             * 否则本通配先命中，行内字图又被拆成块级 */
            if (dom.classList.contains('bt-glyph-image')) return false;
            return {
              src: dom.getAttribute('src'),
              alt: dom.getAttribute('alt'),
              width: intAttrFromDom(dom, 'width'),
              height: intAttrFromDom(dom, 'height'),
            };
          },
        },
      ],
    },
  },
  { type: NODE_TYPES.CAPTION, spec: { group: 'block', content: 'inline*', attrs: COMMON_NODE_ATTRS } },
  { type: NODE_TYPES.TABLE, spec: { group: 'block', content: 'table_row+', attrs: COMMON_NODE_ATTRS } },
  {
    type: NODE_TYPES.TABLE_ROW,
    spec: {
      group: 'table_row',
      content: 'table_cell+',
      attrs: { ...COMMON_NODE_ATTRS, header: { default: false } },
      parseDOM: [
        { tag: 'div.bt-table-row' },
        {
          tag: 'tr',
          getAttrs: (dom): Record<string, unknown> | false => {
            if (typeof dom === 'string') return false;
            const parent = dom.parentElement;
            const inThead = parent !== null && parent.tagName.toLowerCase() === 'thead';
            const hasTh = dom.querySelector('th') !== null;
            const flagged = dom.getAttribute('data-header') === 'true';
            return { header: inThead || hasTh || flagged };
          },
        },
      ],
    },
  },
  {
    type: NODE_TYPES.TABLE_CELL,
    spec: {
      group: 'table_cell',
      content: 'block+',
      attrs: {
        ...COMMON_NODE_ATTRS,
        /** 横向跨列数（默认 1；来自 HTML colspan，编辑态暂不提供合并命令） */
        colspan: { default: 1 },
        /** 纵向跨行数（默认 1；来自 HTML rowspan） */
        rowspan: { default: 1 },
        /** 单元格对齐（left / center / right；null 表示随样式表） */
        align: { default: null },
      },
      parseDOM: [
        {
          tag: 'td',
          getAttrs: (dom): Record<string, unknown> | false =>
            cellAttrsFromDom(dom),
        },
        {
          tag: 'th',
          getAttrs: (dom): Record<string, unknown> | false =>
            cellAttrsFromDom(dom),
        },
        { tag: 'div.bt-table-cell' },
      ],
    },
  },
  {
    type: NODE_TYPES.CODE_BLOCK,
    spec: {
      group: 'block',
      content: 'text*',
      marks: '',
      code: true,
      attrs: { ...COMMON_NODE_ATTRS, language: { default: null } },
      parseDOM: [
        { tag: 'div.bt-code-block', preserveWhitespace: 'full' },
        { tag: 'pre', preserveWhitespace: 'full' },
      ],
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
      // hr → 分隔线变体
      parseDOM: [{ tag: 'div.bt-break' }, { tag: 'hr', getAttrs: () => ({ variant: 'hr' }) }],
    },
  },

  /* ---------- A6：页眉页脚 / 条件内容 ---------- */
  {
    type: NODE_TYPES.PAGE_HEADER,
    spec: { group: 'block', content: 'block*', attrs: COMMON_NODE_ATTRS },
  },
  {
    type: NODE_TYPES.PAGE_FOOTER,
    spec: { group: 'block', content: 'block*', attrs: COMMON_NODE_ATTRS },
  },
  {
    type: NODE_TYPES.CONDITION,
    spec: {
      group: 'block',
      content: 'block+',
      attrs: { ...COMMON_NODE_ATTRS, when: { default: '' } },
    },
  },

  /* ---------- 注释节点 ---------- */
  // 注码（attrs.marker）是注释块的显示序号：缺省 null 表示未编号，插入命令按文档现状自动分配
  {
    type: NODE_TYPES.FOOTNOTE,
    spec: {
      group: 'block',
      content: 'block+',
      attrs: NOTE_NODE_ATTRS,
      /* 导入归一化产物：<div class="bt-footnote" data-id data-marker data-ref-id> */
      parseDOM: [
        {
          tag: 'div.bt-footnote',
          getAttrs: (dom): Record<string, unknown> | false => {
            if (typeof dom === 'string') return false;
            const id = dom.getAttribute('data-id');
            const refId = dom.getAttribute('data-ref-id');
            const markerText = dom.getAttribute('data-marker');
            const marker =
              markerText !== null && /^\d+$/.test(markerText) ? Number(markerText) : null;
            return { ...(id === null ? {} : { id }), marker, refId };
          },
        },
      ],
    },
  },
  { type: NODE_TYPES.ENDNOTE, spec: { group: 'block', content: 'block+', attrs: NOTE_NODE_ATTRS } },
  { type: NODE_TYPES.MARGIN_NOTE, spec: { group: 'block', content: 'block+', attrs: NOTE_NODE_ATTRS } },

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
  {
    /**
     * 行内字图（缺字替代图，K6）：一个字位的图片，随文字流排版
     *
     * `img` 通配规则仍归块级 image（导入侧行为不变），字图由
     * `normalizeGlyphImages` 归一化产出（type 为 glyph-image 节点），
     * 渲染产物 `img.bt-glyph-image` 经本规则回编辑器无损往返。
     */
    type: NODE_TYPES.GLYPH_IMAGE,
    spec: {
      group: 'inline',
      inline: true,
      content: '',
      atom: true,
      attrs: {
        ...COMMON_NODE_ATTRS,
        src: { default: null },
        alt: { default: null },
        char: { default: null },
      },
      parseDOM: [
        {
          tag: 'img.bt-glyph-image',
          getAttrs: (dom): Record<string, unknown> | false =>
            typeof dom === 'string'
              ? false
              : {
                  src: dom.getAttribute('src'),
                  alt: dom.getAttribute('alt'),
                  char: dom.getAttribute('data-char'),
                },
        },
      ],
      toDOM(node) {
        const char = node.attrs.char;
        return [
          'img',
          {
            class: 'bt-glyph-image',
            src: node.attrs.src ?? '',
            alt: node.attrs.alt ?? '',
            ...(char ? { 'data-char': char } : {}),
          },
        ];
      },
    },
  },
];
