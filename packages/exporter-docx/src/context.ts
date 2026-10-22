/**
 * 导出上下文
 *
 * 一次导出 = 一份上下文：收集问题、索引注释、记录已被引用的注释 id。
 * 所有转换函数（inline / blocks / images）都只经由此对象读写状态，
 * 不持有模块级可变状态，导出可重入。
 */
import type { BookNode, NoteEntry } from '@bibliotype/core';
import type { DocxProblem, DocxProblemCode, ResolvedDocxOptions } from './types.js';

/** 导出上下文 */
export interface ExportContext {
  /** 归一化选项 */
  readonly options: ResolvedDocxOptions;
  /** 已收集的问题（与 onProblem 同步产出） */
  readonly problems: DocxProblem[];
  /** 注释 id → 注释条目（注引用的 targetId 在此查） */
  readonly notesById: ReadonlyMap<string, NoteEntry>;
  /** 注释节点 → 注释条目（判断未被引用时用） */
  readonly noteByNode: ReadonlyMap<BookNode, NoteEntry>;
  /** 已被注引用指向的注释 id（预扫描结果） */
  readonly referencedNotes: ReadonlySet<string>;
  /** 记录一条问题 */
  report(code: DocxProblemCode, message: string, nodeId?: string): void;
  /** 记录一条问题（同 key 只记一次，避免同一类降级刷屏） */
  reportOnce(key: string, code: DocxProblemCode, message: string, nodeId?: string): void;
}

/** 创建导出上下文 */
export function createExportContext(
  options: ResolvedDocxOptions,
  notes: readonly NoteEntry[],
  referencedNotes: ReadonlySet<string>,
): ExportContext {
  const problems: DocxProblem[] = [];
  const seen = new Set<string>();

  const push = (problem: DocxProblem): void => {
    problems.push(problem);
    options.onProblem?.(problem);
  };

  const notesById = new Map<string, NoteEntry>();
  const noteByNode = new Map<BookNode, NoteEntry>();
  for (const entry of notes) {
    notesById.set(entry.id, entry);
    if (entry.node.id !== undefined && entry.node.id !== entry.id) {
      notesById.set(entry.node.id, entry);
    }
    noteByNode.set(entry.node, entry);
  }

  const report = (code: DocxProblemCode, message: string, nodeId?: string): void => {
    push(nodeId === undefined ? { code, message } : { code, message, nodeId });
  };

  const reportOnce = (
    key: string,
    code: DocxProblemCode,
    message: string,
    nodeId?: string,
  ): void => {
    if (seen.has(key)) return;
    seen.add(key);
    report(code, message, nodeId);
  };

  return {
    options,
    problems,
    notesById,
    noteByNode,
    referencedNotes,
    report,
    reportOnce,
  };
}

/**
 * 预扫描注引用（`noteref` 标记的 `targetId`）
 *
 * 先扫描再渲染，是为了让「注文块在正文之后」时也能判断它是否被引用；
 * 若边渲染边记录，位于注文块之后的引用会被误判为孤儿。
 */
export function collectReferencedNoteIds(root: BookNode): Set<string> {
  const ids = new Set<string>();
  const walk = (node: BookNode): void => {
    for (const mark of node.marks ?? []) {
      if (mark.type !== 'noteref') continue;
      const targetId = mark.attrs?.['targetId'];
      if (typeof targetId === 'string' && targetId !== '') ids.add(targetId);
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(root);
  return ids;
}
