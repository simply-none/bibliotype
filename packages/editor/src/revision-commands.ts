/**
 * 修订命令（C5）
 *
 * - 模式 / 视图 / 操作者：写插件元数据，不产生文档变更；
 * - 接受 / 拒绝：把 PM 文档转成 IR、调用 core 纯函数、再换回 PM 文档，
 *   保证「编辑器」与「导出 / 测试」共用同一套接受拒绝语义。
 */
import { acceptRevisionsInRoot, rejectRevisionsInRoot } from '@bibliotype/core';
import type { RevisionView } from '@bibliotype/core';
import type { Command, EditorState, Transaction } from 'prosemirror-state';
import { irNodeToPm } from './ir-to-pm.js';
import { pmNodeToIr } from './pm-to-ir.js';
import { REVISION_PLUGIN_KEY, revisionStateOf } from './revision-plugin.js';
import type { RevisionPluginMeta } from './revision-plugin.js';

/** 写入插件元数据（无插件时返回 false） */
function dispatchMeta(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  meta: RevisionPluginMeta,
): boolean {
  if (REVISION_PLUGIN_KEY.getState(state) === undefined) {
    return false;
  }
  dispatch?.(state.tr.setMeta(REVISION_PLUGIN_KEY, meta));
  return true;
}

/** 开启 / 关闭修订模式 */
export function setRevisionMode(enabled: boolean): Command {
  return (state, dispatch) => {
    if (revisionStateOf(state).enabled === enabled) {
      return false;
    }
    return dispatchMeta(state, dispatch, { enabled });
  };
}

/** 切换修订模式 */
export function toggleRevisionMode(): Command {
  return (state, dispatch) => {
    const next = !revisionStateOf(state).enabled;
    return dispatchMeta(state, dispatch, { enabled: next });
  };
}

/** 切换修订视图（标记 / 终稿 / 原稿） */
export function setRevisionView(view: RevisionView): Command {
  return (state, dispatch) => {
    if (revisionStateOf(state).view === view) {
      return false;
    }
    return dispatchMeta(state, dispatch, { view });
  };
}

/** 设置当前操作者（写入后续修订的 author） */
export function setRevisionAuthor(author: string): Command {
  return (state, dispatch) => dispatchMeta(state, dispatch, { author });
}

/** 用新的 IR 根节点替换整篇文档 */
function replaceRoot(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, root: ReturnType<typeof pmNodeToIr>): boolean {
  if (dispatch === undefined) {
    return true;
  }
  const pm = irNodeToPm(root, state.schema);
  const tr = state.tr.replaceWith(0, state.doc.content.size, pm);
  dispatch(tr);
  return true;
}

/** 接受指定修订（缺省为全部） */
export function acceptRevision(changeId?: string): Command {
  return (state, dispatch) => {
    const root = pmNodeToIr(state.doc);
    const next = acceptRevisionsInRoot(root, changeId === undefined ? undefined : [changeId]);
    if (next === root) {
      return false;
    }
    return replaceRoot(state, dispatch, next);
  };
}

/** 拒绝指定修订（缺省为全部） */
export function rejectRevision(changeId?: string): Command {
  return (state, dispatch) => {
    const root = pmNodeToIr(state.doc);
    const next = rejectRevisionsInRoot(root, changeId === undefined ? undefined : [changeId]);
    if (next === root) {
      return false;
    }
    return replaceRoot(state, dispatch, next);
  };
}

/** 接受全部修订 */
export const acceptAllRevisions: Command = (state, dispatch) =>
  acceptRevision()(state, dispatch);

/** 拒绝全部修订 */
export const rejectAllRevisions: Command = (state, dispatch) =>
  rejectRevision()(state, dispatch);
