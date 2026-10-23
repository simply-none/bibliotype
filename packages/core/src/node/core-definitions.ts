/**
 * core 内置节点定义集合
 *
 * 与 NODE_TYPES 一一对应，供 NodeTypeRegistry 预置加载。
 */
import { NODE_TYPES, MARK_TYPES } from '../ir/node-types.js';
import { NAMESPACES, type NodeTypeDefinition } from './node-type.js';

const ns = NAMESPACES.CORE;

/** core 内置的现代书籍节点定义 */
export const CORE_NODE_DEFINITIONS: readonly NodeTypeDefinition[] = [
  {
    type: NODE_TYPES.BOOK,
    namespace: ns,
    kind: 'block',
    isContainer: true,
    description: '书籍根节点',
  },
  {
    type: NODE_TYPES.COVER,
    namespace: ns,
    kind: 'block',
    isContainer: true,
    description: '封面',
  },
  {
    type: NODE_TYPES.TITLE_PAGE,
    namespace: ns,
    kind: 'block',
    isContainer: true,
    description: '书名页 / 扉页',
  },
  {
    type: NODE_TYPES.COPYRIGHT_PAGE,
    namespace: ns,
    kind: 'block',
    isContainer: true,
    description: '版权页',
  },
  {
    type: NODE_TYPES.BACK_COVER,
    namespace: ns,
    kind: 'block',
    isContainer: true,
    description: '封底',
  },
  {
    type: NODE_TYPES.VOLUME,
    namespace: ns,
    kind: 'block',
    isContainer: true,
    description: '卷',
  },
  {
    type: NODE_TYPES.CHAPTER,
    namespace: ns,
    kind: 'block',
    isContainer: true,
    description: '章',
  },
  {
    type: NODE_TYPES.SECTION,
    namespace: ns,
    kind: 'block',
    isContainer: true,
    description: '节',
  },
  {
    type: NODE_TYPES.APPENDIX,
    namespace: ns,
    kind: 'block',
    isContainer: true,
    description: '附录',
  },
  {
    type: NODE_TYPES.PREFACE,
    namespace: ns,
    kind: 'block',
    isContainer: true,
    description: '前言 / 序',
  },
  {
    type: NODE_TYPES.POSTSCRIPT,
    namespace: ns,
    kind: 'block',
    isContainer: true,
    description: '后记 / 跋',
  },
  {
    type: NODE_TYPES.PARAGRAPH,
    namespace: ns,
    kind: 'block',
    isContainer: true,
    description: '正文段落',
  },
  {
    type: NODE_TYPES.HEADING,
    namespace: ns,
    kind: 'block',
    isContainer: true,
    description: '标题',
  },
  {
    type: NODE_TYPES.QUOTE,
    namespace: ns,
    kind: 'block',
    isContainer: true,
    description: '引文块',
  },
  {
    type: NODE_TYPES.FOOTNOTE,
    namespace: ns,
    kind: 'block',
    isContainer: true,
    description: '脚注',
  },
  {
    type: NODE_TYPES.ENDNOTE,
    namespace: ns,
    kind: 'block',
    isContainer: true,
    description: '尾注',
  },
  {
    type: NODE_TYPES.MARGIN_NOTE,
    namespace: ns,
    kind: 'block',
    isContainer: true,
    description: '边注',
  },
  {
    type: NODE_TYPES.IMAGE,
    namespace: ns,
    kind: 'block',
    isContainer: false,
    description: '图片',
  },
  {
    type: NODE_TYPES.TEXT,
    namespace: ns,
    kind: 'text',
    isContainer: false,
    description: '文本叶子',
  },
  {
    type: NODE_TYPES.GLYPH_IMAGE,
    namespace: ns,
    kind: 'inline',
    isContainer: false,
    description: '行内字图（缺字替代图，随文字流排版）',
  },
  {
    type: NODE_TYPES.PAGE_HEADER,
    namespace: ns,
    kind: 'block',
    isContainer: true,
    description: '页眉（book 级显式覆盖）',
  },
  {
    type: NODE_TYPES.PAGE_FOOTER,
    namespace: ns,
    kind: 'block',
    isContainer: true,
    description: '页脚（book 级显式覆盖）',
  },
  {
    type: NODE_TYPES.CONDITION,
    namespace: ns,
    kind: 'block',
    isContainer: true,
    description: '条件内容容器',
  },
];

/** core 内置的标记类型名（供校验与文档使用） */
export const CORE_MARK_TYPE_NAMES: readonly string[] = Object.values(MARK_TYPES);
