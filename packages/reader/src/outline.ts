/**
 * 目录（Outline）提取
 *
 * 从 IR 树中识别结构节点（卷/章/节/标题）并生成层级目录。
 * 默认只认卷/章/节；整本无结构节点时回退用标题建目（见 extractOutline）。
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
  /**
   * 目标节点 id
   *
   * 节点无 id 时回退为**树路径 id**（如 `/3/1`），口径与 `extractBlocks` /
   * `indexNodeAnchors` 完全一致（导入的 Markdown / DOCX / EPUB 文档不带 id），
   * 使这类书籍的目录项同样可点击跳页。 */
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

/** heading 的标题级别（h1~h6 → 1~6；缺省为 1，与 schema 默认值一致） */
function headingLevel(node: BookNode): number {
  const raw = node.attrs?.level;
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value)) return 1;
  return Math.min(Math.max(Math.trunc(value), 1), 6);
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

  const walk = (
    node: BookNode,
    level: number,
    withHeadings: boolean,
    path: string,
  ): OutlineItem[] => {
    const items: OutlineItem[] = [];
    // 与 extractBlocks 同步：只对元素子节点计数（文本子节点不占路径位）
    const elementChildren = (node.children ?? []).filter((child) => !isTextNode(child));
    for (const [index, child] of elementChildren.entries()) {
      const childPath = `${path}/${index}`;
      const isStructure = OUTLINE_STRUCTURE_TYPES.has(child.type);
      const isHeading = withHeadings && child.type === OUTLINE_HEADING_TYPE;
      if (!isStructure && !isHeading) continue;

      const title = resolveNodeTitle(child);
      if (title.length === 0 && !includeEmpty) continue;

      items.push({
        nodeId: child.id ?? childPath,
        type: child.type,
        title,
        level,
        children: walk(child, level + 1, withHeadings, childPath),
      });
    }
    return items;
  };

  const items = walk(root, 0, includeHeadings, '');
  /*
   * 无结构容器时回退用标题建目：导入的 Markdown / DOCX / EPUB（以及只靠标题分节的
   * 自著书）根下往往只有 heading + paragraph，按默认口径提取会**整本无目录**，
   * 目录面板因此整块空白。结构节点存在时不混入标题（避免与卷 / 章 / 节标题重复）。
   */
  if (items.length === 0 && !includeHeadings) return walkHeadings(root, includeEmpty);
  return items;
}

/**
 * 用标题级别重建目录树（回退分支）
 *
 * 只把标题按 h1~h6 串成父子关系：h2 挂到最近的 h1 之下，跳级挂到最近更高级的标题之下，
 * 同级出现则先出栈再并列。早期实现一律平铺为 `level: 0`，导致「只靠标题分节」的书
 * （Markdown / DOCX / 无目录 EPUB）目录完全看不出章节隶属关系。
 *
 * @param root 文档根节点
 * @param includeEmpty 是否纳入无标题的标题节点
 */
function walkHeadings(root: BookNode, includeEmpty: boolean): OutlineItem[] {
  const roots: OutlineItem[] = [];
  const stack: { item: OutlineItem; level: number }[] = [];

  const collect = (node: BookNode, path: string): void => {
    const elementChildren = (node.children ?? []).filter((child) => !isTextNode(child));
    for (const [index, child] of elementChildren.entries()) {
      const childPath = `${path}/${index}`;
      if (child.type === OUTLINE_HEADING_TYPE) {
        const title = resolveNodeTitle(child);
        if (title.length > 0 || includeEmpty) {
          const level = headingLevel(child);
          while (stack.length > 0 && (stack[stack.length - 1]?.level ?? 0) >= level) stack.pop();
          const parent = stack[stack.length - 1];
          const item: OutlineItem = {
            nodeId: child.id ?? childPath,
            type: child.type,
            title,
            level: parent === undefined ? 0 : parent.item.level + 1,
            children: [],
          };
          if (parent === undefined) roots.push(item);
          else parent.item.children.push(item);
          stack.push({ item, level });
        }
      }
      collect(child, childPath);
    }
  };

  collect(root, '');
  return roots;
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
