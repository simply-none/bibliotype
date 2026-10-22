/**
 * 编辑工具条的动作装配（依赖契约实现 + 三行组装）
 *
 * `createToolbarActionContext` 把组件的 `EditorBinding` 包成动作工厂需要的契约：
 * 传入的是 **getter**（`() => props.binding`）而非快照——工具条的 binding  prop 会随
 * 插槽重解析换对象，快照会把按钮绑在旧视图上；工厂内部全部经函数取值，因此激活态
 * 仍由 `binding.version` 驱动逐次事务重算。
 *
 * `createToolbarRows` 决定行的分层与顺序，与组件里的 `TOOLBAR_ROWS` 一一对应。
 */
import type { NamedStyle } from '@bibliotype/core';
import { toggleMarkOfType } from '@bibliotype/editor';
import type { EditorBinding } from '@bibliotype/vue';
import { createBlockActions, createHistoryActions } from './actions-document.js';
import { createInlineActions } from './actions-inline.js';
import { createClassicalActions } from './actions-classical.js';
import { createInsertActions } from './actions-insert.js';
import { createStyleActions } from './actions-style.js';
import type {
  EditorCommand,
  ToolbarActionContext,
  ToolbarRow,
} from './toolbar-action-types.js';

/**
 * 由编辑桥绑定构造动作工厂的依赖契约
 *
 * @param getBinding 当前 `EditorBinding` 的取值器（组件侧传 `() => props.binding`）
 */
export function createToolbarActionContext(
  getBinding: () => EditorBinding,
): ToolbarActionContext {
  /** 执行命令（未生效时静默） */
  function execute(command: EditorCommand): void {
    void getBinding().execute(command);
  }

  return {
    execute,
    /**
     * 会替换选区的原子插入（出校符号 / 印章 / 图片）
     *
     * 旧版这些入口在非空选区下会「静默吃掉选中文字」。这里加保护区：先确认，
     * 再执行；真正的文字转换请走选中后弹出的「替换为」菜单。
     */
    executeReplacingSelection(command: () => EditorCommand): void {
      const selection = getBinding().editor.editorState.selection;
      if (!selection.empty) {
        const ok = window.confirm('该操作会用新节点替换选中的文字，继续？');
        if (!ok) {
          return;
        }
      }
      execute(command());
    },
    /** 行内标记切换（未注册的标记类型不可用） */
    toggleMark(name: string): void {
      const markType = getBinding().editor.bookSchema.marks[name];
      if (markType !== undefined) {
        execute(toggleMarkOfType(markType));
      }
    },
    markOn: (name) => getBinding().isMarkActive(name),
    nodeOn: (name, attrs) => getBinding().isNodeActive(name, attrs),
    selectionEmpty: () => getBinding().editor.editorState.selection.empty,
    canUndo: () => getBinding().canUndo(),
    canRedo: () => getBinding().canRedo(),
    promptText: (message, defaultValue) => window.prompt(message, defaultValue),
    confirmText: (message) => window.confirm(message),
  };
}

/**
 * 三行功能区（参照 Word / Sigil 二级工具条：按使用频率分层，避免单行超长溢出）
 *
 * 第一行：撤销 / 重做 + 块形态 + 行内标记 + 命名样式（高频编辑）；
 * 第二行：古籍标记；第三行：块插入（低频专题）+ 右端实用区（模板里手写，不在数据内）。
 * 组间以分隔线区分，行内按钮去边框（ghost 制式，激活才现底色）。
 */
export function createToolbarRows(
  ctx: ToolbarActionContext,
  namedStyles: readonly NamedStyle[] | undefined,
): readonly ToolbarRow[] {
  return [
    {
      key: 'doc',
      actions: [
        ...createHistoryActions(ctx),
        ...createBlockActions(ctx),
        ...createInlineActions(ctx),
        ...createStyleActions(ctx, namedStyles),
      ],
    },
    { key: 'classical', actions: createClassicalActions(ctx) },
    { key: 'insert', actions: createInsertActions(ctx) },
  ];
}
