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
import type { Attrs, Node as PMNode, NodeType } from 'prosemirror-model';
import { TextSelection } from 'prosemirror-state';
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
  /**
   * 跳转到指定节点（编辑态目录导航）：解析 nodeId（id 命中或树路径 /0/1）→ PM 位置，
   * 设选区并滚动进入视图；返回解析到的 PM 位置（未命中返回 null）。
   * 调用方据返回值在分页态另做画布翻页（隐藏 PM 视图不响应 scrollIntoView）。
   */
  goToNode: (nodeId: string) => number | null;
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
  /**
   * 事务派发时是否同步隐藏 / 可见的 PM 视图（缺省恒为 true）
   *
   * paged 态下传入 `() => false`：PM 整文档视图被 v-show 隐藏、真相在模型，命令事务
   * 携带的 `.scrollIntoView()` 会在 `view.updateState` 时滚动这个隐藏视图的外层容器，
   * 表现为「点命令后页面莫名跳到前后几页」。跳过视图同步既省全量 PM DOM 重建，
   * 又杜绝隐藏视图的乱滚；光标还原交由 PagedCanvas 按模型选区确定性承接。
   * 切回连续画布时由调用方补一次全量 refresh。
   */
  syncView?: () => boolean;
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
 * nodeId → PM 文档位置（节点前置位置）
 *
 * 两套口径（与 extractOutline / extractBlocks 的目录 nodeId 一致）：
 * - 真实 id：遍历文档找 `attrs.id === nodeId` 的节点（IR 的 id 经 ir-to-pm 落到声明了
 *   id 的节点规格，结构节点普遍带 id）；
 * - 树路径（如 `/0/1`）：导入的 md / docx / epub 文档常不带 id，目录回退用「连续元素
 *   子节点」路径；PM 树与 IR 树在结构容器层一一对应，按索引下钻即可。
 * 均未命中返回 null。
 */
function resolveNodePos(doc: PMNode, nodeId: string): number | null {
  let found: number | null = null;
  doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.attrs.id === nodeId) {
      found = pos;
      return false;
    }
    return true;
  });
  if (found !== null) return found;

  if (nodeId.startsWith('/')) {
    const indices = nodeId
      .split('/')
      .slice(1)
      .map((seg) => Number(seg));
    if (indices.length > 0 && indices.every((n) => Number.isInteger(n))) {
      let node: PMNode = doc;
      // 当前容器节点的前置位置（doc.pos 固定为 0），逐层下钻时同步推进
      let pos = 0;
      let ok = true;
      for (const idx of indices) {
        if (idx < 0 || idx >= node.childCount) {
          ok = false;
          break;
        }
        // 跳过容器开标签（pos + 1），再累加其之前各同级子节点尺寸
        pos += 1;
        for (let i = 0; i < idx; i += 1) {
          pos += node.child(i).nodeSize;
        }
        node = node.child(idx);
      }
      if (ok) return pos;
    }
  }
  return null;
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

  /** 事务统一入口：状态机应用 → 视图同步（paged 态可跳过）→ 版本自增 */
  const applyTransaction = (transaction: Transaction): void => {
    editor.dispatch(transaction);
    // syncView 返回 false（paged 态）时不触碰隐藏 PM 视图：避免其 scrollIntoView 乱滚外层
    if (options.syncView?.() !== false) {
      view.value?.updateState(editor.editorState);
    }
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

  /**
   * 跳转节点：解析 nodeId → PM 位置，设选区并 scrollIntoView（连续画布态由视图响应滚动；
   * paged 态视图隐藏不滚动，调用方据返回位置另做画布翻页）。未命中返回 null。
   */
  const goToNode = (nodeId: string): number | null => {
    const pos = resolveNodePos(editor.editorState.doc, nodeId);
    if (pos === null) return null;
    const ok = execute((state, dispatch) => {
      if (dispatch === undefined) return false;
      const selection = TextSelection.near(state.doc.resolve(pos), -1);
      dispatch(state.tr.setSelection(selection).scrollIntoView());
      return true;
    });
    return ok ? pos : null;
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
    goToNode,
  };
}
