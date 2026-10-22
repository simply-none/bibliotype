/**
 * 句读 / 专名建议（K3）
 *
 * 建议由 `classical` 纯函数生成，接受 / 拒绝 / 采纳为标点全部落到编辑器事务
 * （统一走 BookEditor 的 state + dispatch，单事务、可撤销）。库内不写存储，
 * 也不自动改正文。审阅状态由 `useAnnotationSuggestions` 承载。
 */
import { useAnnotationSuggestions } from '@bibliotype/vue';
import {
  applyJudouSuggestions,
  applyProperNameSuggestions,
  commitJudouAsText,
  removeSuggestionMarks,
} from '@bibliotype/classical/editor';
import { type BookEditor } from '@bibliotype/editor';
import type { EditorBinding } from '@bibliotype/vue';
import { type Ref, type ShallowRef } from 'vue';
import type { useToast } from './use-toast.js';

/** 编辑命令执行器类型：统一走 BookEditor 的 state + dispatch（单事务，可撤销） */
export type EditorCommand = ReturnType<typeof removeSuggestionMarks>;

export interface SuggestionsDeps {
  bookEditor: ShallowRef<BookEditor | null>;
  slotBinding: ShallowRef<EditorBinding | null>;
  bookVersion: Ref<number>;
  pushToast: ReturnType<typeof useToast>['push'];
}

/** 建议生成 / 审阅 / 落地编辑器事务 */
export function useSuggestions(deps: SuggestionsDeps) {
  const { bookEditor, slotBinding, bookVersion, pushToast } = deps;

  function runEditorCommand(command: EditorCommand): boolean {
    const editor = bookEditor.value;
    if (editor === null) return false;
    return command(editor.editorState, (tr) => editor.dispatch(tr));
  }

  /**
   * 建议审阅状态：建议由 `classical` 纯函数生成，接受 / 拒绝 / 采纳为标点
   * 全部落到编辑器事务；库内不写存储，也不自动改正文。
   */
  const suggestionApi = useAnnotationSuggestions({
    document: () => bookEditor.value?.getDocument() ?? undefined,
    revision: () => (slotBinding.value?.version.value ?? 0) + bookVersion.value,
    apply: {
      judou: (items) => runEditorCommand(applyJudouSuggestions(items)),
      properName: (items) => runEditorCommand(applyProperNameSuggestions(items)),
      commitJudou: (options) => runEditorCommand(commitJudouAsText(options)),
      remove: (options) => runEditorCommand(removeSuggestionMarks(options)),
    },
  });

  const {
    filter: suggestionFilter,
    accept: acceptSuggestions,
    reject: rejectSuggestions,
    commitJudou: commitSuggestions,
    setOverride: setSuggestionOverride,
  } = suggestionApi;

  /** 接受建议（ids 为空表示当前可见列表） */
  function onAcceptSuggestions(ids: readonly string[]): void {
    const count = acceptSuggestions(ids.length === 0 ? undefined : ids);
    if (count === 0) pushToast('没有可接受的建议', 'info');
  }

  /** 拒绝建议：未接受的本就只在内存里，接受后反悔会移除标记 */
  function onRejectSuggestions(ids: readonly string[]): void {
    const count = rejectSuggestions(ids.length === 0 ? undefined : ids);
    if (count === 0) pushToast('没有可拒绝的建议', 'info');
  }

  /** 采纳为标点：把已接受的句读标记落成真实字符（可撤销） */
  function onCommitSuggestions(ids: readonly string[]): void {
    const count = commitSuggestions(ids.length === 0 ? undefined : ids);
    pushToast(
      count === 0 ? '先接受句读建议，再采纳为标点' : `已把 ${count} 处句读落成标点`,
      count === 0 ? 'info' : 'success',
    );
  }

  return {
    suggestionApi,
    suggestionFilter,
    setSuggestionOverride,
    onAcceptSuggestions,
    onRejectSuggestions,
    onCommitSuggestions,
  };
}
