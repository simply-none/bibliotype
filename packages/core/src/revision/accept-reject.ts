/**
 * 修订的接受 / 拒绝与视图投影（纯函数）
 *
 * 语义（以「删除一句」为例）：
 * - `acceptRevisions`：删除标记的文本被移除 → 终稿不再有该句；
 * - `rejectRevisions`：去掉删除标记、文本保留 → 原稿复原；
 * - `projectRevisionView('final' | 'original')` = 接受 / 拒绝**全部**修订，
 *   供导出与阅读侧使用（编辑器内部文档始终保持带标记的原始内容）。
 */
import type { BookDocument } from '../ir/document.js';
import type { BookMark, BookNode } from '../ir/nodes.js';
import { isTextNode } from '../ir/nodes.js';
import {
  REVISION_MARK_TYPES,
  REVISION_VIEWS,
  parsePreviousMarks,
  revisionTypeOf,
} from './revision-marks.js';
import type { RevisionView } from './revision-marks.js';

/** 修订处理模式 */
type RevisionAction = 'accept' | 'reject';

/** 是否命中待处理的修订 id 集合（缺省表示全部） */
function matchesChange(mark: BookMark, changeIds: ReadonlySet<string> | undefined): boolean {
  if (changeIds === undefined) {
    return true;
  }
  const changeId = mark.attrs?.['changeId'];
  return typeof changeId === 'string' && changeIds.has(changeId);
}

/** 处理单个文本节点的标记 */
function transformTextNode(
  node: BookNode,
  action: RevisionAction,
  changeIds: ReadonlySet<string> | undefined,
): BookNode | undefined {
  const marks = node.marks ?? [];
  if (marks.length === 0) {
    return node;
  }
  const revision = marks.find((mark) => revisionTypeOf(mark) !== undefined && matchesChange(mark, changeIds));
  if (revision === undefined) {
    return node;
  }
  const type = revisionTypeOf(revision);
  const rest = marks.filter((mark) => mark !== revision);
  if (action === 'accept') {
    if (type === REVISION_MARK_TYPES.DELETION) {
      // 删除被接受：整段文本不再出现在终稿
      return undefined;
    }
    return rest.length === 0 ? { ...node, marks: undefined } : { ...node, marks: rest };
  }
  // reject
  if (type === REVISION_MARK_TYPES.INSERTION) {
    return undefined;
  }
  if (type === REVISION_MARK_TYPES.FORMAT_CHANGE) {
    // 还原变更前的完整标记快照（current marks 已被这次变更改写，不能叠加）
    const restored = parsePreviousMarks(revision);
    return restored.length === 0
      ? { ...node, marks: undefined }
      : { ...node, marks: restored };
  }
  // 删除被拒绝：去标记，文字复原
  return rest.length === 0 ? { ...node, marks: undefined } : { ...node, marks: rest };
}

/** 是否为修订标记（避免循环依赖 revision-marks 的判定函数） */
function isRevisionMarkType(mark: BookMark): boolean {
  return revisionTypeOf(mark) !== undefined;
}

/** 递归转换节点（返回 undefined 表示该节点被整体移除） */
function transformNode(
  node: BookNode,
  action: RevisionAction,
  changeIds: ReadonlySet<string> | undefined,
): BookNode | undefined {
  if (isTextNode(node)) {
    return transformTextNode(node, action, changeIds);
  }
  const children = node.children ?? [];
  if (children.length === 0) {
    return node;
  }
  const nextChildren: BookNode[] = [];
  let removed = 0;
  let changed = false;
  for (const child of children) {
    const next = transformNode(child, action, changeIds);
    if (next === undefined) {
      removed += 1;
      changed = true;
    } else {
      if (next !== child) {
        changed = true;
      }
      nextChildren.push(next);
    }
  }
  if (!changed) {
    return node;
  }
  // 整块内容都被修订移除：连块一起删（避免留下空段落）
  if (nextChildren.length === 0 && removed === children.length) {
    return undefined;
  }
  return { ...node, children: nextChildren };
}

/** 把 changeIds 归一为集合（空数组视为「无操作」） */
function toChangeSet(changeIds: readonly string[] | undefined): ReadonlySet<string> | undefined {
  if (changeIds === undefined) {
    return undefined;
  }
  return new Set(changeIds);
}

/** 在根节点上接受修订（编辑器命令用，避免整本文档往返） */
export function acceptRevisionsInRoot(
  root: BookNode,
  changeIds?: readonly string[],
): BookNode {
  const ids = toChangeSet(changeIds);
  if (ids !== undefined && ids.size === 0) {
    return root;
  }
  return transformNode(root, 'accept', ids) ?? { ...root, children: [] };
}

/** 在根节点上拒绝修订 */
export function rejectRevisionsInRoot(
  root: BookNode,
  changeIds?: readonly string[],
): BookNode {
  const ids = toChangeSet(changeIds);
  if (ids !== undefined && ids.size === 0) {
    return root;
  }
  return transformNode(root, 'reject', ids) ?? { ...root, children: [] };
}

/** 接受修订（`changeIds` 缺省为全部） */
export function acceptRevisions(
  document: BookDocument,
  changeIds?: readonly string[],
): BookDocument {
  const root = acceptRevisionsInRoot(document.root, changeIds);
  return root === document.root ? document : { ...document, root };
}

/** 拒绝修订（`changeIds` 缺省为全部） */
export function rejectRevisions(
  document: BookDocument,
  changeIds?: readonly string[],
): BookDocument {
  const root = rejectRevisionsInRoot(document.root, changeIds);
  return root === document.root ? document : { ...document, root };
}

/**
 * 按视图投影文档
 *
 * - `marked`：原样返回（引用同一对象，调用方视为只读）；
 * - `final`：接受全部修订；
 * - `original`：拒绝全部修订。
 */
export function projectRevisionView(document: BookDocument, view: RevisionView): BookDocument {
  if (view === REVISION_VIEWS.FINAL) {
    return acceptRevisions(document);
  }
  if (view === REVISION_VIEWS.ORIGINAL) {
    return rejectRevisions(document);
  }
  return document;
}

/** 文档是否含修订（导出侧快速短路） */
export function hasRevisions(document: BookDocument): boolean {
  return containsRevision(document.root);
}

function containsRevision(node: BookNode): boolean {
  if (isTextNode(node)) {
    return (node.marks ?? []).some((mark) => isRevisionMarkType(mark));
  }
  return (node.children ?? []).some((child) => containsRevision(child));
}
