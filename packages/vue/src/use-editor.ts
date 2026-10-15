/**
 * useEditorBinding：BookEditor（无视图状态机）→ Vue 响应式的桥
 *
 * - attach / detach 管理 prosemirror-view 的生命周期；
 * - dispatchTransaction 桥接：editor.dispatch → view.updateState → 版本自增；
 * - isMarkActive / isNodeActive / canUndo / canRedo 读取当前选区状态；
 * - 在组件 / effectScope 内调用时，scope 销毁自动 detach（editor 生命周期由调用方管理）。
 */
import {
  getCurrentScope,
  markRaw,
  onScopeDispose,
  ref,
  shallowRef,
  toRaw,
  type Ref,
  type ShallowRef,
} from 'vue';
import type { BookEditor } from '@bibliotype/editor';
import { redoCommand, redoDepth, undoCommand, undoDepth } from '@bibliotype/editor';
import type { Attrs, NodeType } from 'prosemirror-model';
import type { Command, Transaction } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';

/** 绑定编辑器的响应式状态与操作 */
export interface EditorBinding {
  /** 绑定的编辑器实例（命令式 API 的原点） */
  editor: BookEditor;
  /** 编辑视图实例（挂载前为 null） */
  view: ShallowRef<EditorView | null>;
  /** 状态版本计数（事务派发 / 刷新后自增，驱动激活态重算） */
  version: Ref<number>;
  /** 挂载编辑视图到容器（重复挂载会先卸载旧视图） */
  attach: (container: HTMLElement) => void;
  /** 卸载并销毁编辑视图 */
  detach: () => void;
  /** 当前选区是否应用于指定标记 */
  isMarkActive: (markName: string) => boolean;
  /** 当前选区是否位于指定节点内（可按属性过滤） */
  isNodeActive: (nodeName: string, attrs?: Record<string, unknown>) => boolean;
  /** 撤销 / 重做是否可用 */
  canUndo: () => boolean;
  canRedo: () => boolean;
  /** 执行命令（返回是否生效） */
  execute: (command: Command) => boolean;
  /** 撤销 / 重做 */
  undo: () => boolean;
  redo: () => boolean;
  /** 外部 loadDocument 后同步视图与版本（skipViewSync: 仅 version++，跳过 PM 视图重建） */
  refresh: (options?: { skipViewSync?: boolean }) => void;
}

/** useEditorBinding 可选配置 */
export interface EditorBindingOptions {
  /**
   * 视图是否可编辑（缺省恒为 true）
   *
   * 传入闭包（如 `() => props.editable !== false`）以支持运行时切换：
   * 只读时 ProseMirror 拒绝用户输入 / 粘贴 / 拖拽，但程序化事务仍可派发。
   * 切换后需调用 refresh() 让视图重新求值该闭包。
   */
  isEditable?: () => boolean;
}

/** 节点属性浅比较（expected 中声明的键全部相等即匹配） */
function matchesAttrs(nodeAttrs: Attrs, expected?: Record<string, unknown>): boolean {
  if (expected === undefined) {
    return true;
  }
  return Object.entries(expected).every(([key, value]) => nodeAttrs[key] === value);
}

/** 判断标记在选区 / 光标处是否激活（等价 prosemirror 惯例实现） */
function markActive(editor: BookEditor, nodeName: string): boolean {
  const markType = editor.bookSchema.marks[nodeName];
  if (markType === undefined) {
    return false;
  }
  const state = editor.editorState;
  const { from, $from, to, empty } = state.selection;
  if (empty) {
    return markType.isInSet(state.storedMarks ?? $from.marks()) !== undefined;
  }
  return state.doc.rangeHasMark(from, to, markType);
}

/** 判断选区是否位于指定类型节点内（沿祖先链） */
function selectionInNode(editor: BookEditor, nodeType: NodeType): boolean {
  const { $from } = editor.editorState.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type === nodeType) {
      return true;
    }
  }
  return false;
}

/**
 * 绑定既有 BookEditor 实例：EditorView 生命周期 + 事务桥 + 响应式激活态
 */
export function useEditorBinding(
  editor: BookEditor,
  options: EditorBindingOptions = {},
): EditorBinding {
  // props / 插槽等响应式链路可能传入被代理的实例：先还原原始对象（toRaw），
  // 再标记非响应式（markRaw）——保证 binding.editor 与调用方持有的实例同一
  // （slotProps.editor === editor），且 class 实例不被响应式系统深层包装。
  editor = markRaw(toRaw(editor));
  const view = shallowRef<EditorView | null>(null);
  const version = ref(0);
  const isEditable = options.isEditable ?? (() => true);

  /** 事务统一入口：状态机应用 → 视图同步 → 版本自增 */
  const applyTransaction = (transaction: Transaction): void => {
    editor.dispatch(transaction);
    view.value?.updateState(editor.editorState);
    version.value += 1;
  };

  const detach = (): void => {
    view.value?.destroy();
    view.value = null;
  };

  const attach = (container: HTMLElement): void => {
    detach();
    const next = new EditorView(container, {
      state: editor.editorState,
      editable: isEditable,
      dispatchTransaction: (transaction) => applyTransaction(transaction),
    });
    view.value = next;
    version.value += 1;
  };

  const execute = (command: Command): boolean =>
    command(editor.editorState, (transaction) => applyTransaction(transaction));

  const refresh = (options?: { skipViewSync?: boolean }): void => {
    // skipViewSync：paged 态下 PM 视图隐藏且 stale（真相在模型），逐键 updateState
    // 是全量 PM DOM 重建的纯浪费；切回连续画布时由调用方补一次全量 refresh
    if (options?.skipViewSync !== true) {
      view.value?.updateState(editor.editorState);
    }
    version.value += 1;
  };

  if (getCurrentScope() !== undefined) {
    onScopeDispose(detach);
  }

  return {
    editor,
    view,
    version,
    attach,
    detach,
    isMarkActive: (markName) => {
      // 读取版本以建立响应式依赖（状态变化后重算激活态）
      void version.value;
      return markActive(editor, markName);
    },
    isNodeActive: (nodeName, attrs) => {
      void version.value;
      const nodeType = editor.bookSchema.nodes[nodeName];
      if (nodeType === undefined || !selectionInNode(editor, nodeType)) {
        return false;
      }
      const { $from } = editor.editorState.selection;
      for (let depth = $from.depth; depth > 0; depth -= 1) {
        const node = $from.node(depth);
        if (node.type === nodeType && matchesAttrs(node.attrs, attrs)) {
          return true;
        }
      }
      return false;
    },
    canUndo: () => {
      void version.value;
      return undoDepth(editor.editorState) > 0;
    },
    canRedo: () => {
      void version.value;
      return redoDepth(editor.editorState) > 0;
    },
    execute,
    undo: () => execute(undoCommand),
    redo: () => execute(redoCommand),
    refresh,
  };
}
