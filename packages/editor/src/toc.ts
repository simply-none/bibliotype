/**
 * 目录（toc）命令：按文档结构生成 / 刷新目录页
 *
 * 产物形态与 `apps/demo` 的目录页、`book-css` 的版式角色一致：
 * `toc` 节点内是「标题行 + 逐条目录段落」，角色写进 `rawAttrs.role`，
 * 序列化后成为 `data-role="toc-title" / "toc-entry" / "toc-subentry"`，
 * 由既有 `role.toc-*` 样式规则（居中 / 层级字号）渲染。
 *
 * 目录条目只收**带 id 的结构节点**：目录的意义是「点得过去」，
 * 无 id 的节点导出时锚点由导出器临时生成，链接会在往返后失效，
 * 故宁可不出条目（但继续向下扫描其子结构）。
 */
import { MARK_TYPES, NODE_TYPES } from '@bibliotype/core';
import { Fragment, type Node as PmNode, type Schema } from 'prosemirror-model';
import type { Command } from 'prosemirror-state';
import { RAW_ATTRS_ATTR } from './attr-mapper.js';

/** 参与目录的结构节点类型（顺序无关，按文档先序收集） */
const TOC_SOURCE_TYPES: ReadonlySet<string> = new Set([
  NODE_TYPES.VOLUME,
  NODE_TYPES.CHAPTER,
  NODE_TYPES.SECTION,
  NODE_TYPES.APPENDIX,
  NODE_TYPES.PREFACE,
  NODE_TYPES.POSTSCRIPT,
]);

/** 目录之前的前置页类型（新目录插在这些页之后，不打断封面 / 扉页 / 版权页） */
const FRONT_MATTER_TYPES: ReadonlySet<string> = new Set([
  NODE_TYPES.COVER,
  NODE_TYPES.TITLE_PAGE,
  NODE_TYPES.COPYRIGHT_PAGE,
]);

/** 目录条目 */
export interface TocEntry {
  /** 目标节点 id（目录链接锚点） */
  id: string;
  /** 标题文本 */
  title: string;
  /** 层级（0 起；跳跃层级按「父级 + 1」收敛） */
  level: number;
  /** 来源节点类型（volume / chapter / section / heading …） */
  type: string;
}

/** 目录生成选项 */
export interface TocOptions {
  /** 目录标题（写进 `toc.attrs.title` 与标题行；空串表示不排标题行，缺省「目录」） */
  title?: string;
  /** 只收不超过该层级的条目（0 起；缺省不限） */
  maxLevel?: number;
  /** 是否收纳 heading 节点（缺省 false：结构节点已有标题，避免重复） */
  includeHeadings?: boolean;
  /** 是否给条目加链接标记（缺省 true） */
  links?: boolean;
  /** 链接前缀（缺省 `#`；跨文档导出可传 `text/sec-1.xhtml#`） */
  hrefPrefix?: string;
}

/** 节点标题：attrs.title 优先，回退到文本内容 */
function titleOf(node: PmNode): string {
  const raw = node.attrs['title'];
  if (typeof raw === 'string' && raw.trim() !== '') return raw.trim();
  return node.textContent.trim();
}

/** 节点 id（非空字符串才算有锚点） */
function idOf(node: PmNode): string | undefined {
  const raw = node.attrs['id'];
  return typeof raw === 'string' && raw !== '' ? raw : undefined;
}

/**
 * 收集目录条目（文档先序）
 *
 * - 只收 `TOC_SOURCE_TYPES`（可选含 heading）且**有 id、有标题**的节点；
 * - 层级按结构嵌套推导，并收敛为「不得比上一条深超过一级」，
 *   避免「卷 → 节」这类跳级在目录里表现出错误的缩进层级；
 * - 不进入注释、引用等普通块：目录不收纳正文内部的标题文本。
 */
export function collectTocEntries(doc: PmNode, options: TocOptions = {}): TocEntry[] {
  const maxLevel = options.maxLevel ?? Number.POSITIVE_INFINITY;
  const includeHeadings = options.includeHeadings === true;
  const entries: TocEntry[] = [];
  let lastLevel = -1;

  const walk = (node: PmNode, level: number): void => {
    node.forEach((child) => {
      const isStructure = TOC_SOURCE_TYPES.has(child.type.name);
      const isHeading = includeHeadings && child.type.name === NODE_TYPES.HEADING;
      if (!isStructure && !isHeading) return;

      if (level <= maxLevel) {
        const id = idOf(child);
        const title = titleOf(child);
        if (id !== undefined && title !== '') {
          const entryLevel = Math.min(level, lastLevel + 1);
          entries.push({ id, title, level: entryLevel, type: child.type.name });
          lastLevel = entryLevel;
        }
      }
      if (isStructure) walk(child, level + 1);
    });
  };

  walk(doc, 0);
  return entries;
}

/** 版式角色 → rawAttrs（序列化器输出 data-role，样式表据此命中） */
function roleAttrs(base: Record<string, unknown>, role: string): Record<string, unknown> {
  return { ...base, [RAW_ATTRS_ATTR]: { role } };
}

/**
 * 由条目构造 `toc` 节点（schema 未注册 toc / paragraph 时返回 null）
 *
 * 条目层级 0 → `toc-entry`，更深 → `toc-subentry`（与 demo 目录页同一口径）。
 */
export function buildTocNode(
  schema: Schema,
  entries: readonly TocEntry[],
  options: TocOptions = {},
): PmNode | null {
  const tocType = schema.nodes[NODE_TYPES.TOC];
  const paragraph = schema.nodes[NODE_TYPES.PARAGRAPH];
  const heading = schema.nodes[NODE_TYPES.HEADING];
  if (tocType === undefined || paragraph === undefined) return null;

  const title = options.title ?? '目录';
  const linkType = schema.marks[MARK_TYPES.LINK];
  const useLinks = options.links !== false && linkType !== undefined;
  const prefix = options.hrefPrefix ?? '#';

  const blocks: PmNode[] = [];
  if (title !== '' && heading !== undefined) {
    blocks.push(heading.create(roleAttrs({ level: 1 }, 'toc-title'), schema.text(title)));
  }
  for (const entry of entries) {
    const marks = useLinks ? [linkType!.create({ href: `${prefix}${entry.id}` })] : undefined;
    const role = entry.level === 0 ? 'toc-entry' : 'toc-subentry';
    blocks.push(paragraph.create(roleAttrs({}, role), schema.text(entry.title, marks)));
  }
  if (blocks.length === 0) return null;

  return tocType.create({ title }, Fragment.fromArray(blocks));
}

/** 首个非前置页块的插入位置（前置页之后、正文之前） */
function frontMatterEnd(doc: PmNode): number {
  let end = 0;
  doc.forEach((child, offset) => {
    if (offset === end && FRONT_MATTER_TYPES.has(child.type.name)) {
      end = offset + child.nodeSize;
    }
  });
  return end;
}

/**
 * 生成 / 刷新目录页
 *
 * - 首次调用：在封面 / 扉页 / 版权页之后插入 `toc` 块（正文之前）；
 * - 已存在目录：**原位替换内容**（保留其 id 与自定义属性），即「刷新目录」；
 * - 文档里没有可收条目（无带 id 的卷 / 章 / 节）或 schema 未注册 toc 时返回 false。
 */
export function insertToc(options: TocOptions = {}): Command {
  return (state, dispatch) => {
    const tocType = state.schema.nodes[NODE_TYPES.TOC];
    if (tocType === undefined) return false;

    const entries = collectTocEntries(state.doc, options);
    if (entries.length === 0) return false;
    const built = buildTocNode(state.schema, entries, options);
    if (built === null) return false;

    let existingPos = -1;
    let existing: PmNode | null = null;
    state.doc.descendants((node, pos) => {
      if (existing !== null) return false;
      if (node.type !== tocType) return true;
      existingPos = pos;
      existing = node;
      return false;
    });

    const tr = state.tr;
    if (existing !== null) {
      const node = existing as PmNode;
      tr.replaceWith(existingPos + 1, existingPos + 1 + node.content.size, built.content);
      if (node.attrs['title'] !== built.attrs['title']) {
        tr.setNodeMarkup(existingPos, undefined, { ...node.attrs, title: built.attrs['title'] });
      }
      dispatch?.(tr);
      return true;
    }

    tr.insert(frontMatterEnd(state.doc), built);
    dispatch?.(tr);
    return true;
  };
}
