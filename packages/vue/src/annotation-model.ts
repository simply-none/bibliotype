/**
 * 标注侧栏视图模型（纯函数，可单测）
 *
 * 把标注集合解析到当前文档，并按「所在章节」分组，供 `BtAnnotationSidebar` 渲染。
 * 不依赖 Vue / DOM / 存储，便于在 node 环境下独立测试。
 */
import type { Anchor, BookNode } from '@bibliotype/core';
import { resolveAnnotations } from '@bibliotype/annotation';
import type { Annotation, AnnotationKind, CommentEntry } from '@bibliotype/annotation';

/** 侧栏中的单条标注 */
export interface SidebarAnnotation {
  /** 标注 id */
  id: string;
  /** 种类 */
  kind: AnnotationKind;
  /** 展示文本（书签标题 / 笔记正文 / 评论首条 / 高亮文本） */
  label: string;
  /** 锚点 */
  anchor: Anchor;
  /** 是否已解决（comment 用） */
  resolved?: boolean;
  /** 评论线程（comment 用） */
  comments?: CommentEntry[];
}

/** 侧栏中的一个章节分组 */
export interface SidebarChapter {
  /** 章节节点 id */
  id: string;
  /** 章节标题 */
  title: string;
  /** 该章节下的标注 */
  items: SidebarAnnotation[];
}

/** 取某节点所在章节标题（向上找最近的 chapter / section / volume） */
function chapterTitleOf(root: BookNode, nodeId: string): { id: string; title: string } | undefined {
  const chapterTypes = new Set(['chapter', 'section', 'volume']);
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

  let current: BookNode | undefined = target;
  while (current !== undefined) {
    if (chapterTypes.has(current.type)) {
      const title =
        (current.attrs?.['title'] as string | undefined) ??
        current.children
          ?.filter((c) => c.type === 'paragraph')
          .map((c) => c.children?.map((t) => (t.type === 'text' ? t.text : '')).join('') ?? '')
          .find((text) => text !== '') ?? '';
      const currentId = current.id;
      if (title !== '' && currentId !== undefined) return { id: currentId, title };
    }
    const ownerId = current.id;
    if (ownerId === undefined) return undefined;
    current = parentOf(root, ownerId);
  }
  return undefined;
}

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

/** 单条标注的展示文本 */
function labelOf(annotation: Annotation, text: string): string {
  switch (annotation.kind) {
    case 'bookmark':
      return annotation.body ?? text ?? annotation.anchor.nodeId;
    case 'note':
      return annotation.body ?? '';
    case 'comment':
      return annotation.comments?.map((c) => c.body).join(' / ') ?? '';
    case 'highlight':
    default:
      return text;
  }
}

/**
 * 构建标注侧栏视图模型
 *
 * @param root 文档根
 * @param annotations 标注列表
 * @returns 按章节分组的侧栏模型（章节顺序按文档出现顺序；无标注返回空数组）
 */
export function buildAnnotationSidebarModel(
  root: BookNode,
  annotations: readonly Annotation[],
): SidebarChapter[] {
  const { resolved } = resolveAnnotations(root, annotations);
  const chapterMap = new Map<string, SidebarChapter>();

  for (const item of resolved) {
    const meta = chapterTitleOf(root, item.annotation.anchor.nodeId) ?? { id: 'untitled', title: '未分组' };
    let chapter = chapterMap.get(meta.id);
    if (chapter === undefined) {
      chapter = { id: meta.id, title: meta.title, items: [] };
      chapterMap.set(meta.id, chapter);
    }
    chapter.items.push({
      id: item.annotation.id,
      kind: item.annotation.kind,
      label: labelOf(item.annotation, item.text),
      anchor: item.annotation.anchor,
      resolved: item.annotation.resolved,
      comments: item.annotation.comments,
    });
  }

  return [...chapterMap.values()];
}
