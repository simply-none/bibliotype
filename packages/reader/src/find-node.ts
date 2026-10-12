/**
 * 块 id → 节点解析
 *
 * reader.extractBlocks 的块 id 约定：节点有 id 用 id，否则用树路径
 * （如 "/0/1/2"，每层索引基于过滤文本叶子后的元素子节点）。
 * 阅读器渲染（getPageNodes → vue/react 封装）与导出器预分页
 * 都依赖该约定，把「页 → 块 id」还原为「页 → IR 节点」。
 */
import { isTextNode, type BookNode } from '@bibliotype/core';

/** 按块 id 查找节点（节点 id 或 extractBlocks 树路径） */
export function findNodeById(root: BookNode, id: string): BookNode | undefined {
  return id.startsWith('/') ? resolvePath(root, id) : findById(root, id);
}

/** 深度优先按节点 id 查找（文本叶子不参与） */
function findById(node: BookNode, id: string): BookNode | undefined {
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    if (isTextNode(child)) continue;
    const found = findById(child, id);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** 按树路径解析（与 extractBlocks 的路径索引一致：逐层过滤文本叶子） */
function resolvePath(root: BookNode, path: string): BookNode | undefined {
  const segments = path.split('/').filter((segment) => segment !== '');
  let current: BookNode | undefined = root;
  for (const segment of segments) {
    if (current === undefined) return undefined;
    const index = Number(segment);
    if (!Number.isInteger(index) || index < 0) return undefined;
    const children: BookNode[] = elementChildren(current);
    current = children[index];
  }
  return current;
}

/** 元素子节点（剔除文本叶子；显式返回类型以断开展开循环推型） */
function elementChildren(node: BookNode): BookNode[] {
  return (node.children ?? []).filter((child) => !isTextNode(child));
}
