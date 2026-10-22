/**
 * 编辑工具条的动作数据契约（Demo 层）
 *
 * 工具条的全部按钮都是这份数据的渲染结果：`ToolbarAction` 描述一个入口（文字、
 * 执行、激活态、禁用态、悬浮说明），`ToolbarRow` 描述一行（功能区）。数据与工厂
 * 函数全部脱离组件，喂一个替身上下文即可单测。
 *
 * `ToolbarActionContext` 只暴露**函数**、不暴露快照值：按钮的 `active` / `disabled`
 * 是闭包，调用时才经上下文读当前 `EditorBinding`，因此激活态仍由 `binding.version`
 * 驱动逐次事务重算（若在工厂调用点读响应式值，会让整行按钮在每次事务时重建 v-for 节点）。
 */
import type { EditorBinding } from '@bibliotype/vue';
import type { ToolbarUsage } from '../toolbar-usage.js';

/** 编辑命令（editor / classical 命令工厂的产物，与 `binding.execute` 形参同源） */
export type EditorCommand = Parameters<EditorBinding['execute']>[0];

/** 工具条按钮描述 */
export interface ToolbarAction {
  /** 稳定键（个别按钮需要特殊交互时用，如表格弹尺寸选择器） */
  key?: string;
  /** 按钮文字 */
  label: string;
  /** 点击执行 */
  run: () => void;
  /** 激活态（缺省不判定） */
  active?: () => boolean;
  /** 禁用态（缺省不禁用） */
  disabled?: () => boolean;
  /** 悬停提示（短：快捷键 + 关键前提） */
  title?: string;
  /**
   * 使用说明（可插拔）
   *
   * 传入即表示「该入口需要向用户解释」，工具条据此渲染「功能说明」面板。
   * 不传则该入口不出现在面板里（面板无任何内容时入口按钮本身也不渲染）。
   * 字段含义见 `toolbar-usage.ts`；语义口径以插件包命令的 JSDoc 为准。
   */
  usage?: ToolbarUsage;
}

/** 工具行的形状（`TOOLBAR_ROWS` 的元素） */
export type ToolbarRow = { key: string; actions: readonly ToolbarAction[] };

/**
 * 动作工厂的依赖契约
 *
 * 全部成员都是函数：工厂模块因此不依赖 Vue、不依赖 ProseMirror 视图，
 * 单测里用替身记录调用即可断言「点了哪个命令、带什么参数」。
 */
export interface ToolbarActionContext {
  /** 执行命令（未生效时静默） */
  execute: (command: EditorCommand) => void;
  /**
   * 会替换选区的原子插入（出校符号 / 印章 / 图片）
   *
   * 非空选区下先确认再执行；真正的文字转换请走选中后弹出的「替换为」菜单。
   */
  executeReplacingSelection: (command: () => EditorCommand) => void;
  /** 行内标记切换（未注册的标记类型不可用） */
  toggleMark: (name: string) => void;
  /** 标记激活态 */
  markOn: (name: string) => boolean;
  /** 节点激活态（可按属性过滤，如 heading 的 level） */
  nodeOn: (name: string, attrs?: Record<string, unknown>) => boolean;
  /** 当前选区是否为空光标 */
  selectionEmpty: () => boolean;
  /** 历史栈是否允许撤销 */
  canUndo: () => boolean;
  /** 历史栈是否允许重做 */
  canRedo: () => boolean;
  /** 弹窗录入文本（取消返回 null，与 `window.prompt` 同语义） */
  promptText: (message: string, defaultValue?: string) => string | null;
  /** 弹窗确认（与 `window.confirm` 同语义） */
  confirmText: (message: string) => boolean;
}
