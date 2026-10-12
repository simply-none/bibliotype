/**
 * 古籍节点注册定义集合
 *
 * 供 classical 插件在安装时批量注册到 NodeTypeRegistry。
 * 命名空间统一为 classical（对应 D8）。
 */
import { NAMESPACES, type NodeTypeDefinition } from '@bibliotype/core';
import { CLASSICAL_NODE_TYPES } from './node-types.js';

const ns = NAMESPACES.CLASSICAL;

/** 古籍节点定义（kind: block 为独立块，inline 为行内元素） */
export const CLASSICAL_NODE_DEFINITIONS: readonly NodeTypeDefinition[] = [
  {
    type: CLASSICAL_NODE_TYPES.DOUBLE_NOTE,
    namespace: ns,
    kind: 'block',
    isContainer: true,
    description: '双行小注（正文一行夹两行小字）',
  },
  {
    type: CLASSICAL_NODE_TYPES.INLINE_NOTE,
    namespace: ns,
    kind: 'inline',
    isContainer: true,
    description: '夹注（行内注文）',
  },
  {
    type: CLASSICAL_NODE_TYPES.HEAD_NOTE,
    namespace: ns,
    kind: 'block',
    isContainer: true,
    description: '眉批（版心上方批语）',
  },
  {
    type: CLASSICAL_NODE_TYPES.TAIL_NOTE,
    namespace: ns,
    kind: 'block',
    isContainer: true,
    description: '尾批（段末/篇末批语）',
  },
  {
    type: CLASSICAL_NODE_TYPES.COLLATION_NOTE,
    namespace: ns,
    kind: 'block',
    isContainer: true,
    description: '校勘记（底本/校本异文）',
  },
  {
    type: CLASSICAL_NODE_TYPES.COLLATION_MARK,
    namespace: ns,
    kind: 'inline',
    isContainer: false,
    description: '校勘符号（○□△等）',
  },
  {
    type: CLASSICAL_NODE_TYPES.VARIANT_CHAR,
    namespace: ns,
    kind: 'inline',
    isContainer: true,
    description: '异体字载体（保留原字形）',
  },
  {
    type: CLASSICAL_NODE_TYPES.TABOO_CHAR,
    namespace: ns,
    kind: 'inline',
    isContainer: true,
    description: '避讳字载体（缺笔字形）',
  },
  {
    type: CLASSICAL_NODE_TYPES.IMPRINT,
    namespace: ns,
    kind: 'block',
    isContainer: true,
    description: '牌记 / 刊记',
  },
  {
    type: CLASSICAL_NODE_TYPES.COLOPHON,
    namespace: ns,
    kind: 'block',
    isContainer: true,
    description: '卷末题记 / 跋语',
  },
  {
    type: CLASSICAL_NODE_TYPES.SEAL,
    namespace: ns,
    kind: 'inline',
    isContainer: false,
    description: '印章',
  },
  {
    type: CLASSICAL_NODE_TYPES.BORDER_FRAME,
    namespace: ns,
    kind: 'block',
    isContainer: true,
    description: '版框（乌丝栏/朱丝栏）',
  },
  {
    type: CLASSICAL_NODE_TYPES.FISH_TAIL,
    namespace: ns,
    kind: 'block',
    isContainer: false,
    description: '鱼尾（版心装饰）',
  },
];
