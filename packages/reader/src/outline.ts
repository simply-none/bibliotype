/**
 * 目录（Outline）提取
 *
 * 从 IR 树中识别结构节点（卷/章/节/标题）并生成层级目录。
 * 仅依赖节点类型常量与 attrs，不依赖注册表，便于独立测试。
 */
import { NODE_TYPES, isTextNode, type BookNode, type NodeId } from '@bibliotype/core';

/** 参与目录的结构节点类型（卷/章/节） */
export const OUTLINE_STRUCTURE_TYPES: ReadonlySet<string> = new Set([
  NODE_TYPES.VOLUME,
  NODE_TYPES.CHAPTER,
  NODE_TYPES.SECTION,
]);

/** 标题节点类型（默认不入目录，避免与结构标题重复） */
export const OUTLINE_HEADING_TYPE = NODE_TYPES.HEADING;

/** 目录项 */
export interface OutlineItem {
  /** 目标节点 id（无 id 时为 undefined，跳转按块定位） */
  nodeId: NodeId | undefined;
  /** 节点类型（volume/chapter/section/heading） */
  type: string;
  /** 标题文本 */
  title: string;
  /** 层级（顶层为 0） */
  level: number;
  /** 子目录项 */
  children: OutlineItem[];
}

/**
 * 解析节点标题
 *
 * 优先级：attrs.title（字符串）→ children 首个文本节点内容。
 */
export function resolveNodeTitle(node: BookNode): string {
  const attrTitle = node.attrs?.title;
  if (typeof attrTitle === 'string' && attrTitle.length > 0) {
    return attrTitle;
  }
  for (const child of node.children ?? []) {
    if (isTextNode(child) && (child.text ?? '').length > 0) {
      return child.text as string;
    }
    // 标题常见于子段落内
    const nested = resolveNodeTitle(child);
    if (nested.length > 0) return nested;
  }
  return '';
}

/** 判断节点是否为空容器（无任何子节点） */
function isEmptyContainer(node: BookNode): boolean {
  return (node.children ?? []).length === 0;
}

/** 目录提取选项 */
export interface ExtractOutlineOptions {
  /** 纳入无标题的空结构节点（默认 false） */
  includeEmpty?: boolean;
  /** 纳入 heading 节点（默认 false，避免与卷/章/节标题重复） */
  includeHeadings?: boolean;
}

/**
 * 递归提取目录
 *
 * @param root 文档根节点（type 为 book）
 * @param options 提取选项（默认为结构节点、跳过空标题）
 */
export function extractOutline(
  root: BookNode,
  options: ExtractOutlineOptions = {},
): OutlineItem[] {
  const includeEmpty = options.includeEmpty ?? false;
  const includeHeadings = options.includeHeadings ?? false;

  const walk = (node: BookNode, level: number): OutlineItem[] => {
    const items: OutlineItem[] = [];
    for (const child of node.children ?? []) {
      const isStructure = OUTLINE_STRUCTURE_TYPES.has(child.type);
      const isHeading = includeHeadings && child.type === OUTLINE_HEADING_TYPE;
      if (!isStructure && !isHeading) continue;

      const title = resolveNodeTitle(child);
      if (title.length === 0 && !includeEmpty) continue;

      items.push({
        nodeId: child.id,
        type: child.type,
        title,
        level,
        children: walk(child, level + 1),
      });
    }
    return items;
  };
  return walk(root, 0);
}

/**
 * 计数目录项（含子级）
 */
export function countOutlineItems(items: readonly OutlineItem[]): number {
  let count = 0;
  for (const item of items) {
    count += 1 + countOutlineItems(item.children);
  }
  return count;
}

/** 判断结构节点是否为空容器（供块提取复用） */
export { isEmptyContainer };
