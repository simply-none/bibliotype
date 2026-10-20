/**
 * 标注导出 Markdown（纯函数，可测）
 *
 * 把标注集合按「所在章节」分组输出，便于审阅 / 归档。正文转义遵循最小规则
 * （避免 `#` / `*` / `<` 破坏结构），时间由标注自带 `createdAt` 提供，本函数不生成时间。
 */
import type { BookNode } from '@bibliotype/core';
import { resolveAnnotations, type Annotation } from './index.js';

/** 取某节点所在章节标题（向上找最近的 chapter / section，取 title 属性或首段文本） */
function chapterTitleOf(root: BookNode, nodeId: string): string | undefined {
  let target: BookNode | undefined;
  const walk = (node: BookNode): boolean => {
    if (node.id === nodeId) {
      target = node;
      return true;
    }
    for (const child of node.children ?? []) {
      if (walk(child)) return true;
    }
    return false;
  };
  if (!walk(root)) return undefined;

  const chapterTypes = new Set(['chapter', 'section', 'volume']);
  let current: BookNode | undefined = target;
  while (current !== undefined) {
    if (chapterTypes.has(current.type)) {
      const title = (current.attrs?.['title'] as string | undefined) ?? firstText(current);
      if (title !== undefined && title !== '') return title;
    }
    const currentId = current.id;
    if (currentId === undefined) return undefined;
    current = parentOf(root, currentId);
  }
  return undefined;
}

/** 找到某 id 节点的父节点 */
function parentOf(root: BookNode, id: string): BookNode | undefined {
  let found: BookNode | undefined;
  const walk = (node: BookNode): void => {
    for (const child of node.children ?? []) {
      if (child.id === id) {
        found = node;
        return;
      }
      walk(child);
    }
  };
  walk(root);
  return found;
}

/** 取节点首段文本（用于章节无 title 时兜底） */
function firstText(node: BookNode): string | undefined {
  if (node.children === undefined) return undefined;
  for (const child of node.children) {
    if (child.type === 'paragraph') {
      const text = child.children?.map((c) => (c.type === 'text' ? c.text : '')).join('') ?? '';
      if (text !== '') return text;
    }
  }
  return undefined;
}

/** 转义 Markdown 特殊字符 */
function escapeMd(text: string): string {
  return text.replace(/([#*_<>`\\])/g, '\\$1');
}

/** 单条标注的可读摘要 */
function summarize(annotation: Annotation, text: string): string {
  switch (annotation.kind) {
    case 'bookmark':
      return `- 书签：${escapeMd(annotation.body ?? text ?? annotation.anchor.nodeId)}`;
    case 'note':
      return `- 笔记：${escapeMd(annotation.body ?? '')}`;
    case 'comment': {
      const body = annotation.comments?.map((c) => c.body).join(' / ') ?? '';
      return `- 评论：${escapeMd(body)}`;
    }
    case 'highlight':
    default:
      return `- 高亮：${escapeMd(text ?? '')}`;
  }
}

/**
 * 把标注集合导出为 Markdown
 *
 * @param root 文档根（用于解析锚点与定位章节）
 * @param annotations 标注列表（书签 / 笔记 / 评论 / 高亮）
 * @returns 按章节分组的 Markdown 文本；无标注返回空串
 */
export function annotationsToMarkdown(root: BookNode, annotations: readonly Annotation[]): string {
  const { resolved } = resolveAnnotations(root, annotations);
  if (resolved.length === 0) return '';

  const groups = new Map<string, string[]>();
  for (const item of resolved) {
    const title = chapterTitleOf(root, item.annotation.anchor.nodeId) ?? '未分组标注';
    const list = groups.get(title) ?? [];
    list.push(summarize(item.annotation, item.text));
    groups.set(title, list);
  }

  const lines: string[] = ['# 标注导出', ''];
  for (const [title, items] of groups) {
    lines.push(`## ${escapeMd(title)}`);
    lines.push(...items);
    lines.push('');
  }
  return lines.join('\n').trimEnd() + '\n';
}
