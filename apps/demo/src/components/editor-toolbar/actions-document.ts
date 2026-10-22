/**
 * 撤销 / 重做与块形态动作（工具条第一行的前半段）
 *
 * 纯工厂：入参只有依赖契约，返回值即按钮数据，可脱离组件单测。
 * 文本（`label` / `title` / `usage`）与 `docs/19-editor-toolbar-usage.md` 速查表同源，改一处需同步另一处。
 */
import { NODE_TYPES } from '@bibliotype/core';
import {
  redoCommand,
  setHeadingLevel,
  setParagraph,
  toggleBulletList,
  toggleOrderedList,
  toggleQuote,
  undoCommand,
} from '@bibliotype/editor';
import type { ToolbarAction, ToolbarActionContext } from './toolbar-action-types.js';

/**
 * 撤销 / 重做（可用性随历史深度联动）
 *
 * 快捷键由插件包 keymap 统一绑定（`createBookEditorKeymap`），工具条只是入口；
 * 两个命令都带 `addToHistory` 默认值，因此自身也会进入历史栈。
 */
export function createHistoryActions(ctx: ToolbarActionContext): readonly ToolbarAction[] {
  return [
    {
      label: '撤销',
      run: () => ctx.execute(undoCommand),
      disabled: () => !ctx.canUndo(),
      title: '撤销（Mod-Z）',
      usage: {
        use: '回退最近一次编辑事务（命令与键入一视同仁）',
        where: '就地生效，选区回到事务前位置',
        key: 'Mod-Z',
        limit: '无历史时按钮置灰（canUndo 为 false）',
      },
    },
    {
      label: '重做',
      run: () => ctx.execute(redoCommand),
      disabled: () => !ctx.canRedo(),
      title: '重做（Shift-Mod-Z）',
      usage: {
        use: '重新应用被撤销的事务',
        where: '就地生效',
        key: 'Shift-Mod-Z / Mod-Y',
        limit: '撤销后一旦继续编辑，重做栈即被清空',
      },
    },
  ];
}

/**
 * 段落级别与块形态
 *
 * 这三类（标题 / 引用 / 列表）都是「块级改写」，作用于光标所在块；跨块选区会逐块处理。
 * 块的 `id` 由 `setBlockTypeKeepingId` 显式保留（原生 setBlockType 会清空，见包层注释）。
 */
export function createBlockActions(ctx: ToolbarActionContext): readonly ToolbarAction[] {
  return [
    {
      label: '正文',
      run: () => ctx.execute(setParagraph()),
      active: () => ctx.nodeOn(NODE_TYPES.PARAGRAPH),
      usage: {
        use: '把当前文本块转为正文段落（如标题 → 正文）',
        where: '块类型替换，块 id 与内容保留',
        key: 'Mod-Alt-0',
        limit: '只改块类型，不清除行内标记（粗体等仍在）',
      },
    },
    {
      label: 'H1',
      run: () => ctx.execute(setHeadingLevel(1)),
      active: () => ctx.nodeOn(NODE_TYPES.HEADING, { level: 1 }),
      usage: {
        use: '把当前块转为一级标题',
        where: '块类型替换，块 id 与内容保留',
        key: 'Mod-Alt-1',
        limit: '命令支持 1~6 级，工具条只暴露 1~3',
      },
    },
    {
      label: 'H2',
      run: () => ctx.execute(setHeadingLevel(2)),
      active: () => ctx.nodeOn(NODE_TYPES.HEADING, { level: 2 }),
      usage: {
        use: '把当前块转为二级标题',
        where: '块类型替换，块 id 与内容保留',
        key: 'Mod-Alt-2',
        limit: '命令支持 1~6 级，工具条只暴露 1~3',
      },
    },
    {
      label: 'H3',
      run: () => ctx.execute(setHeadingLevel(3)),
      active: () => ctx.nodeOn(NODE_TYPES.HEADING, { level: 3 }),
      usage: {
        use: '把当前块转为三级标题',
        where: '块类型替换，块 id 与内容保留',
        key: 'Mod-Alt-3',
        limit: '命令支持 1~6 级，工具条只暴露 1~3',
      },
    },
    {
      label: '引用',
      run: () => ctx.execute(toggleQuote()),
      active: () => ctx.nodeOn(NODE_TYPES.QUOTE),
      usage: {
        use: '包裹为引用块；已在引用内时点击即退出',
        where: '块级包裹 / 提升，光标留在原文本处',
        limit: 'schema 未注册 quote 时静默不执行',
      },
    },
    {
      label: '无序',
      run: () => ctx.execute(toggleBulletList()),
      active: () => ctx.nodeOn(NODE_TYPES.LIST, { ordered: false }),
      title: '无序列表',
      usage: {
        use: '列表外包裹为无序列表；已在无序列表内点击即退出；在有序列表内点击改为无序',
        where: '块级包裹 / 提升 / 改 ordered 属性',
        limit: '列表内按 Enter 会拆分列表项（插件包 keymap）',
      },
    },
    {
      label: '有序',
      run: () => ctx.execute(toggleOrderedList()),
      active: () => ctx.nodeOn(NODE_TYPES.LIST, { ordered: true }),
      title: '有序列表',
      usage: {
        use: '列表外包裹为有序列表；已在有序列表内点击即退出；在无序列表内点击改为有序',
        where: '块级包裹 / 提升 / 改 ordered 属性',
        limit: '起始序号固定从 1 开始（无 start 属性入口）',
      },
    },
  ];
}
