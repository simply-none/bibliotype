/**
 * ProseMirror 节点树 → IR 节点树
 *
 * 映射规则：
 * - 元素节点：type.name → IR type；attrs 经 attr-mapper 还原（rawAttrs 展开）；
 * - PM 属性 id（字符串）→ IR 顶层 id；
 * - PM 文本节点 → IR 文本叶子（type: text），按 marks 边界生成；
 * - 空文本跳过；空内容节点省略 children 字段。
 */
import { NODE_TYPES, type BookMark, type BookNode } from '@bibliotype/core';
import type { Mark as PmMark, Node as PmNode } from 'prosemirror-model';
import { toIrAttrs } from './attr-mapper.js';

/**
 * 将 ProseMirror 节点（含子树）转换为 IR 节点
 *
 * @param pmNode PM 节点（非纯文本节点，顶层通常为 book 根）
 */
export function pmNodeToIr(pmNode: PmNode): BookNode {
  if (pmNode.isText) {
    throw new RangeError('pmNodeToIr 不接受纯文本节点，文本由父级行内聚合处理。');
  }
  return elementToIr(pmNode);
}

/** 元素节点转换（含子节点递归） */
function elementToIr(node: PmNode): BookNode {
  const result: BookNode = { type: node.type.name };

  const id = node.attrs.id;
  if (typeof id === 'string') {
    result.id = id;
  }

  const attrs = toIrAttrs(node.attrs, node.type.spec.attrs);
  if (attrs !== undefined) {
    result.attrs = attrs;
  }

  const children: BookNode[] = [];
  node.forEach((child) => {
    if (child.isText) {
      const text = child.text ?? '';
      if (text.length === 0) {
        return; // 空文本叶子无信息，跳过
      }
      const textNode: BookNode = { type: NODE_TYPES.TEXT, text };
      const marks = marksToIr(child.marks);
      if (marks !== undefined) {
        textNode.marks = marks;
      }
      children.push(textNode);
    } else {
      children.push(elementToIr(child));
    }
  });

  if (children.length > 0) {
    result.children = children;
  }
  return result;
}

/** PM marks → IR marks（空数组返回 undefined） */
function marksToIr(marks: readonly PmMark[]): BookMark[] | undefined {
  if (marks.length === 0) {
    return undefined;
  }
  return marks.map((mark) => {
    const result: BookMark = { type: mark.type.name };
    const attrs = toIrAttrs(mark.attrs, mark.type.spec.attrs);
    if (attrs !== undefined) {
      result.attrs = attrs;
    }
    return result;
  });
}
