/**
 * 站点分节规划
 *
 * 规则（简单、可预期、不猜意图）：
 * - 结构节点（卷/章/节/附录/序/跋/目录/封面等）中，**有非结构子节点**的节点各成一页；
 * - 只有结构子节点、自身无内容的容器（常见于「卷」）不单独成页，直接向下递归；
 * - 直接挂在根下的零散内容块合并为一页「正文」，避免丢内容；
 * - 页路径按出现顺序编号（`section-1.html`），输出因此完全确定。
 */
import { NODE_TYPES, nodePlainText } from '@bibliotype/core';
import type { BookDocument, BookNode } from '@bibliotype/core';
import type { SiteSection } from './types.js';

/** 参与分页的结构节点类型 */
export const SITE_STRUCTURE_TYPES: ReadonlySet<string> = new Set([
  NODE_TYPES.COVER,
  NODE_TYPES.TITLE_PAGE,
  NODE_TYPES.COPYRIGHT_PAGE,
  NODE_TYPES.BACK_COVER,
  NODE_TYPES.VOLUME,
  NODE_TYPES.CHAPTER,
  NODE_TYPES.SECTION,
  NODE_TYPES.APPENDIX,
  NODE_TYPES.PREFACE,
  NODE_TYPES.POSTSCRIPT,
  NODE_TYPES.TOC,
]);

/** 规划结果中的一节 */
export interface PlannedSection {
  /** 目录项 */
  section: SiteSection;
  /** 源节点（用于序列化正文） */
  node: BookNode;
}

/** 分节规划结果 */
export interface SectionPlan {
  /** 节序列 */
  sections: PlannedSection[];
  /** 告警 */
  warnings: string[];
}

/** 是否结构节点 */
export function isStructureNode(node: BookNode): boolean {
  return SITE_STRUCTURE_TYPES.has(node.type);
}

/** 解析节标题：attrs.title → 首个 heading 文本 → 节点纯文本前 24 字 → 兜底 */
export function resolveSectionTitle(node: BookNode, fallback: string): string {
  const attrTitle = node.attrs?.title;
  if (typeof attrTitle === 'string' && attrTitle.trim()) {
    return attrTitle.trim();
  }
  const heading = (node.children ?? []).find((child) => child.type === NODE_TYPES.HEADING);
  if (heading) {
    const text = nodePlainText(heading).trim();
    if (text) {
      return text;
    }
  }
  const own = nodePlainText(node).trim();
  if (own) {
    return own.length > 24 ? `${own.slice(0, 24)}…` : own;
  }
  return fallback;
}

/**
 * 规划站点分节
 *
 * @param document IR 文档
 */
export function planSections(document: BookDocument): SectionPlan {
  const warnings: string[] = [];
  const sections: PlannedSection[] = [];
  const usedIds = new Set<string>();
  let counter = 0;

  const makeId = (node: BookNode | undefined): string => {
    const base = node?.id ?? `section-${counter}`;
    let candidate = base;
    let suffix = 2;
    while (usedIds.has(candidate)) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(candidate);
    return candidate;
  };

  const emit = (node: BookNode, level: number, fallbackTitle: string): void => {
    counter += 1;
    const id = makeId(node);
    sections.push({
      section: {
        id,
        path: `section-${counter}.html`,
        title: resolveSectionTitle(node, fallbackTitle),
        level,
        type: node.type,
      },
      node,
    });
  };

  const walk = (nodes: readonly BookNode[], level: number): BookNode[] => {
    const loose: BookNode[] = [];
    nodes.forEach((node) => {
      if (!isStructureNode(node)) {
        loose.push(node);
        return;
      }
      const children = node.children ?? [];
      const content = children.filter((child) => !isStructureNode(child));
      const nested = children.filter((child) => isStructureNode(child));
      if (content.length > 0) {
        emit(node, level, `第 ${counter + 1} 节`);
      }
      if (nested.length > 0) {
        walk(nested, content.length > 0 ? level + 1 : level);
      }
      if (content.length === 0 && nested.length === 0) {
        // 空结构节点（占位章）：仍成页，便于作者后续补写
        emit(node, level, '（空）');
      }
    });
    return loose;
  };

  const looseRoot = walk(document.root.children ?? [], 0);
  if (looseRoot.length > 0) {
    emit({ type: NODE_TYPES.BOOK, children: looseRoot }, 0, '正文');
  }

  if (sections.length === 0) {
    warnings.push('文档没有可导出的内容：请先补充章节或段落。');
  }
  return { sections, warnings };
}
