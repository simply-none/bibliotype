/**
 * 章节文件规划（BookDocument → EPUB spine 拆分）
 *
 * 文件切分策略：
 * - 结构节点（卷/章/节/附录/序/跋/目录）各成一文件（卷容纳其全部子结构）；
 * - 连续的非结构块（散段）聚合为一个匿名文件；
 * - 结构节点无 id 时自动分配锚点（bt-a-N），经序列化器注入并由 nav 跳转。
 */
import { NODE_TYPES, isTextNode, type BookNode } from '@bibliotype/core';
import { resolveNodeTitle } from '@bibliotype/reader';

/** 独立成文件 / 参与导航的结构节点类型 */
export const SECTION_TYPES: ReadonlySet<string> = new Set([
  NODE_TYPES.VOLUME,
  NODE_TYPES.CHAPTER,
  NODE_TYPES.SECTION,
  NODE_TYPES.APPENDIX,
  NODE_TYPES.PREFACE,
  NODE_TYPES.POSTSCRIPT,
  NODE_TYPES.TOC,
]);

/** 结构节点缺省导航标签（无标题时回退） */
const FALLBACK_LABELS: Readonly<Record<string, string>> = {
  [NODE_TYPES.VOLUME]: '卷',
  [NODE_TYPES.CHAPTER]: '章',
  [NODE_TYPES.SECTION]: '节',
  [NODE_TYPES.APPENDIX]: '附录',
  [NODE_TYPES.PREFACE]: '序',
  [NODE_TYPES.POSTSCRIPT]: '跋',
  [NODE_TYPES.TOC]: '目录',
};

/** 章节文件计划 */
export interface SectionPlan {
  /** OEBPS 内相对路径（如 'text/sec-0.xhtml'） */
  file: string;
  /** 该文件承载的顶层节点（结构节点为一个；散块聚合为多个） */
  nodes: readonly BookNode[];
}

/** 文档规划结果 */
export interface DocumentPlan {
  sections: SectionPlan[];
  /** 节点 → 锚点 id（无 id 的结构节点自动分配，序列化时经 anchorIds 注入） */
  anchors: ReadonlyMap<BookNode, string>;
}

/** 规划文档章节文件与锚点 */
export function planDocument(root: BookNode): DocumentPlan {
  const elements = (root.children ?? []).filter((child) => !isTextNode(child));

  const sections: SectionPlan[] = [];
  let pending: BookNode[] = [];

  const flushPending = (): void => {
    if (pending.length === 0) return;
    sections.push({ file: `text/sec-${sections.length}.xhtml`, nodes: pending });
    pending = [];
  };

  for (const child of elements) {
    if (SECTION_TYPES.has(child.type)) {
      flushPending();
      sections.push({ file: `text/sec-${sections.length}.xhtml`, nodes: [child] });
    } else {
      pending.push(child);
    }
  }
  flushPending();

  /* 空书：保证至少一个内容文档（EPUB spine 不能为空） */
  if (sections.length === 0) {
    sections.push({ file: 'text/sec-0.xhtml', nodes: [] });
  }

  /* 锚点分配：结构节点无 id 时自动编号（确定性：按文档序递增） */
  const anchors = new Map<BookNode, string>();
  let counter = 0;
  const visit = (node: BookNode): void => {
    if (
      SECTION_TYPES.has(node.type) &&
      (node.id === undefined || node.id === '') &&
      !anchors.has(node)
    ) {
      counter += 1;
      anchors.set(node, `bt-a-${counter}`);
    }
    for (const child of node.children ?? []) {
      if (!isTextNode(child)) visit(child);
    }
  };
  for (const section of sections) {
    for (const node of section.nodes) visit(node);
  }

  return { sections, anchors };
}

/** 导航条目 */
export interface NavItem {
  label: string;
  href: string;
  children: NavItem[];
}

/** 构建导航条目（结构层级 → 嵌套 NavItem，href 为文件相对路径 + 锚点） */
export function buildNavItems(plan: DocumentPlan): NavItem[] {
  const items: NavItem[] = [];
  for (const section of plan.sections) {
    for (const node of section.nodes) {
      const item = structureItem(node, section.file, plan.anchors);
      if (item !== null) items.push(item);
    }
  }
  return items;
}

/** 结构节点 → 导航项（非结构节点返回 null；标题缺省回退类型名） */
function structureItem(
  node: BookNode,
  file: string,
  anchors: ReadonlyMap<BookNode, string>,
): NavItem | null {
  if (!SECTION_TYPES.has(node.type)) return null;

  const id = anchors.get(node) ?? node.id;
  const href = id !== undefined && id !== '' ? `${file}#${id}` : file;
  const label = resolveNodeTitle(node) || FALLBACK_LABELS[node.type] || node.type;

  const children: NavItem[] = [];
  for (const child of node.children ?? []) {
    if (isTextNode(child)) continue;
    const item = structureItem(child, file, anchors);
    if (item !== null) children.push(item);
  }

  return { label, href, children };
}
