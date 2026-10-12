/**
 * IR 节点与标记的结构定义
 *
 * 设计原则（对应调研清单 § 六）：
 * 1. 与 ProseMirror Doc 的 JSON 表示同构，可直接复用 y-prosemirror 映射到 Y.XmlFragment；
 * 2. 节点可携带稳定 id（协同、批注、交叉引用依赖）；
 * 3. 属性值允许英文与数字（D3 补充）。
 */
import type { Attrs, NodeId, AttrValue } from './types.js';

/** 行内标记（附加于文本之上，不构成树） */
export interface BookMark {
  /** 标记类型（核心标记见 MARK_TYPES，插件可扩展） */
  type: string;
  /** 标记属性，如 link 的 href、ruby 的注文 */
  attrs?: Attrs;
}

/** IR 节点（树形结构） */
export interface BookNode {
  /** 节点类型（语义标签，见 NODE_TYPES） */
  type: string;
  /**
   * 稳定唯一标识（可选）
   *
   * 结构节点（卷/章/节）与需被引用的节点建议始终携带，
   * 协同编辑与批注锚点依赖其跨会话稳定性。
   */
  id?: NodeId;
  /** 节点属性 */
  attrs?: Attrs;
  /** 子节点（块级/容器节点） */
  children?: BookNode[];
  /** 文本内容（仅叶子文本节点） */
  text?: string;
  /** 行内标记（仅携带文本的节点） */
  marks?: BookMark[];
}

/** 判断节点是否为文本叶子 */
export function isTextNode(node: BookNode): boolean {
  return typeof node.text === 'string';
}

/** 读取属性值（带类型收窄） */
export function readAttr<T extends AttrValue>(
  node: BookNode,
  key: string,
): T | undefined {
  return node.attrs?.[key] as T | undefined;
}
