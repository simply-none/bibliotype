/**
 * IR 节点树 → ProseMirror 节点树
 *
 * 映射规则：
 * - 元素节点按 type 查找 schema 节点类型；未注册类型抛出明确错误；
 * - 文本叶子（isTextNode）聚合为 PM 文本节点，空文本跳过（规范化）；
 * - 块容器内的行内内容聚合为段落：IR 为宽松树（如双行注直接挂 text），
 *   PM 为严格树（块容器只接受块节点），不规范化会导致光标无法落入容器
 *   （点击定位回退到容器之外）；
 * - node.id → PM 属性 id（仅当 spec 声明了 id）；
 * - 其余 attrs 经 attr-mapper 映射（未声明键进 rawAttrs）。
 */
import { isTextNode, NODE_TYPES, type BookMark, type BookNode } from '@bibliotype/core';
import type { Mark, Node as PmNode, NodeType, Schema } from 'prosemirror-model';
import { toPmAttrs } from './attr-mapper.js';

/**
 * 将 IR 节点（含子树）转换为 ProseMirror 节点
 *
 * @param node IR 节点（非文本叶子，顶层通常为 book 根）
 * @param schema 编辑器 schema
 */
export function irNodeToPm(node: BookNode, schema: Schema): PmNode {
  if (isTextNode(node)) {
    throw new RangeError('irNodeToPm 不接受文本叶子节点，文本由父级行内聚合处理。');
  }
  return elementToPm(node, schema);
}

/** 元素节点转换（含子节点递归；块容器内的行内内容聚合为段落） */
function elementToPm(node: BookNode, schema: Schema): PmNode {
  const type = schema.nodes[node.type];
  if (type === undefined) {
    throw new RangeError(`schema 中未定义节点类型 "${node.type}"，请先注册对应规格。`);
  }

  const children: PmNode[] = [];
  /* 块容器内暂存的行内内容：连续行内子节点聚合为一个段落 */
  let pendingInline: PmNode[] = [];
  const flushInline = (): void => {
    if (pendingInline.length === 0) {
      return;
    }
    /* 换用新数组：Fragment 会引用传入内容数组，暂存数组不能继续复用 */
    const inline = pendingInline;
    pendingInline = [];
    const paragraph = schema.nodes[NODE_TYPES.PARAGRAPH];
    if (paragraph !== undefined) {
      children.push(paragraph.create(null, inline));
    } else {
      children.push(...inline);
    }
  };

  for (const child of node.children ?? []) {
    const pmChild = childToPm(child, schema);
    if (pmChild === null) {
      continue;
    }
    if (type.inlineContent || pmChild.isBlock) {
      flushInline();
      children.push(pmChild);
    } else {
      pendingInline.push(pmChild);
    }
  }
  flushInline();

  return type.create(nodeAttrsToPm(node, type), children.length > 0 ? children : undefined);
}

/** 子节点转换：文本叶子 → PM 文本（空文本跳过），其余递归 */
function childToPm(node: BookNode, schema: Schema): PmNode | null {
  if (isTextNode(node)) {
    const text = node.text ?? '';
    if (text.length === 0) {
      return null;
    }
    return schema.text(text, marksToPm(node.marks, schema));
  }
  return elementToPm(node, schema);
}

/** IR marks → PM marks（未注册标记类型抛出明确错误） */
function marksToPm(marks: readonly BookMark[] | undefined, schema: Schema): readonly Mark[] {
  return (marks ?? []).map((mark) => {
    const markType = schema.marks[mark.type];
    if (markType === undefined) {
      throw new RangeError(`schema 中未定义标记类型 "${mark.type}"，请先注册对应规格。`);
    }
    return markType.create(toPmAttrs(mark.attrs, markType.spec.attrs));
  });
}

/** 节点属性转换：IR attrs + 顶层 id → PM attrs */
function nodeAttrsToPm(node: BookNode, type: NodeType): Record<string, unknown> {
  const attrs = toPmAttrs(node.attrs, type.spec.attrs);
  const specAttrs = type.spec.attrs;
  if (node.id !== undefined && specAttrs != null && 'id' in specAttrs) {
    attrs.id = node.id;
  }
  return attrs;
}
