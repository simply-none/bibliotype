/**
 * 编辑工具条动作工厂测试（阶段 4 拆分自 EditorToolbar 的可测部分）
 *
 * 全部经替身上下文驱动，不挂载组件、不建 ProseMirror 视图。覆盖五条口径：
 * 1. 三行的分层与按钮顺序（拆分后不得改动，折叠白名单与 `:key` 都以此为准）；
 * 2. 命名样式项随列表增减，尾部恒为「清除格式」；
 * 3. 弹窗录入（prompt）与选区保护（confirm）的分支：取消即不派发任何命令；
 * 4. `active` / `disabled` 只经上下文查询，参数（如 heading 的 level）逐字传递；
 * 5. 滚轮转横向滚动的 `deltaMode` 折算与事件接管。
 */
import { describe, expect, it, vi } from 'vitest';
import { MARK_TYPES, NODE_TYPES, type NamedStyle } from '@bibliotype/core';
import { mergeCells, redoCommand, splitCell, undoCommand } from '@bibliotype/editor';
import type { EditorBinding } from '@bibliotype/vue';
import {
  createToolbarActionContext,
  createToolbarRows,
} from '../components/editor-toolbar/toolbar-actions.js';
import type {
  EditorCommand,
  ToolbarAction,
  ToolbarActionContext,
  ToolbarRow,
} from '../components/editor-toolbar/toolbar-action-types.js';
import { wheelScrollX } from '../composables/use-toolbar-scroll.js';

/** 替身上下文的调用记录 */
interface Spy {
  executed: EditorCommand[];
  replaced: number;
  toggled: string[];
  markQueries: string[];
  nodeQueries: Array<{ name: string; attrs?: Record<string, unknown> }>;
  prompts: string[];
  confirms: string[];
}

/** 替身上下文的可编程返回值 */
interface FakeOptions {
  marksOn?: readonly string[];
  selectionEmpty?: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
  /** prompt 依序应答（用尽后回 null，等同用户取消） */
  promptAnswers?: (string | null)[];
  confirmAnswer?: boolean;
}

/** 构造记录调用的替身上下文 */
function fakeCtx(options: FakeOptions = {}): { ctx: ToolbarActionContext; spy: Spy } {
  const marksOn = new Set(options.marksOn ?? []);
  const spy: Spy = {
    executed: [],
    replaced: 0,
    toggled: [],
    markQueries: [],
    nodeQueries: [],
    prompts: [],
    confirms: [],
  };
  let promptIndex = 0;
  const ctx: ToolbarActionContext = {
    execute: (command) => {
      spy.executed.push(command);
    },
    executeReplacingSelection: () => {
      spy.replaced += 1;
    },
    toggleMark: (name) => {
      spy.toggled.push(name);
    },
    markOn: (name) => {
      spy.markQueries.push(name);
      return marksOn.has(name);
    },
    nodeOn: (name, attrs) => {
      spy.nodeQueries.push({ name, attrs });
      return true;
    },
    selectionEmpty: () => options.selectionEmpty !== false,
    canUndo: () => options.canUndo !== false,
    canRedo: () => options.canRedo !== false,
    promptText: (message) => {
      spy.prompts.push(message);
      const answer = (options.promptAnswers ?? [])[promptIndex] ?? null;
      promptIndex += 1;
      return answer;
    },
    confirmText: (message) => {
      spy.confirms.push(message);
      return options.confirmAnswer !== false;
    },
  };
  return { ctx, spy };
}

/** 按 label 取某行的动作 */
function actionOf(
  rows: readonly ToolbarRow[],
  rowKey: string,
  label: string,
): ToolbarAction {
  const row = rows.find((item) => item.key === rowKey);
  const action = row?.actions.find((item) => item.label === label);
  if (action === undefined) throw new Error(`未找到动作：${rowKey} / ${label}`);
  return action;
}

const STYLES: readonly NamedStyle[] = [
  { id: 'ns-1', name: '正文加粗', featureId: 'block.paragraph', declarations: {} },
  {
    id: 'ns-2',
    name: '书名行',
    featureId: 'block.paragraph',
    declarations: {},
    basedOn: 'ns-1',
  },
];

describe('createToolbarRows · 行分层与顺序', () => {
  it('三行 key 与第一行的按钮顺序逐字保持', () => {
    const { ctx } = fakeCtx();
    const rows = createToolbarRows(ctx, []);
    expect(rows.map((row) => row.key)).toEqual(['doc', 'classical', 'insert']);
    expect(rows[0]?.actions.map((action) => action.label)).toEqual([
      '撤销',
      '重做',
      '正文',
      'H1',
      'H2',
      'H3',
      '引用',
      '无序',
      '有序',
      'B',
      'I',
      'U',
      '高亮',
      '删除线',
      '代码',
      '链接',
      '注音',
      '清除格式',
    ]);
  });

  it('古籍行 9 项、插入行 18 项，且仅「表格」带稳定 key', () => {
    const { ctx } = fakeCtx();
    const rows = createToolbarRows(ctx, []);
    expect(rows[1]?.actions).toHaveLength(9);
    expect(rows[2]?.actions).toHaveLength(18);
    expect(rows[2]?.actions.filter((action) => action.key === 'table')).toHaveLength(1);
    expect(actionOf(rows, 'insert', '表格').key).toBe('table');
  });

  it('命名样式插在「清除格式」之前并随列表增减', () => {
    const { ctx } = fakeCtx();
    const rows = createToolbarRows(ctx, STYLES);
    const labels = rows[0]?.actions.map((action) => action.label) ?? [];
    expect(labels.slice(-4)).toEqual(['注音', '正文加粗', '书名行', '清除格式']);
    expect(actionOf(rows, 'doc', '正文加粗').title).toBe('套用命名样式「正文加粗」到选区');
  });
});

describe('命令派发与弹窗分支', () => {
  it('撤销 / 重做恒等于插件包的历史命令，可用性随历史栈', () => {
    const { ctx, spy } = fakeCtx({ canUndo: true, canRedo: false });
    const rows = createToolbarRows(ctx, []);
    actionOf(rows, 'doc', '撤销').run();
    actionOf(rows, 'doc', '重做').run();
    expect(spy.executed).toEqual([undoCommand, redoCommand]);
    expect(actionOf(rows, 'doc', '撤销').disabled?.()).toBe(false);
    expect(actionOf(rows, 'doc', '重做').disabled?.()).toBe(true);
  });

  it('B 走行内切换，删除线只派发一个命令且不弹窗', () => {
    const { ctx, spy } = fakeCtx();
    const rows = createToolbarRows(ctx, []);
    actionOf(rows, 'doc', 'B').run();
    actionOf(rows, 'doc', '删除线').run();
    expect(spy.toggled).toEqual([MARK_TYPES.STRONG]);
    expect(spy.executed).toHaveLength(1);
    expect(typeof spy.executed[0]).toBe('function');
    expect(spy.prompts).toEqual([]);
  });

  it('链接：已激活时直接移除，未激活才弹窗，取消不派发', () => {
    const on = fakeCtx({ marksOn: [MARK_TYPES.LINK] });
    const rowsOn = createToolbarRows(on.ctx, []);
    actionOf(rowsOn, 'doc', '链接').run();
    expect(on.spy.executed).toHaveLength(1);
    expect(on.spy.prompts).toEqual([]);

    const cancel = fakeCtx({ promptAnswers: [null] });
    const rowsCancel = createToolbarRows(cancel.ctx, []);
    actionOf(rowsCancel, 'doc', '链接').run();
    expect(cancel.spy.prompts).toEqual(['链接地址（取消则不插入）']);
    expect(cancel.spy.executed).toHaveLength(0);

    const ok = fakeCtx({ promptAnswers: ['https://a.test'] });
    actionOf(createToolbarRows(ok.ctx, []), 'doc', '链接').run();
    expect(ok.spy.executed).toHaveLength(1);
  });

  it('注音：弹窗确认串（含空串）都执行，取消才不执行', () => {
    const empty = fakeCtx({ promptAnswers: [''] });
    actionOf(createToolbarRows(empty.ctx, []), 'doc', '注音').run();
    expect(empty.spy.executed).toHaveLength(1);

    const cancel = fakeCtx({ promptAnswers: [null] });
    actionOf(createToolbarRows(cancel.ctx, []), 'doc', '注音').run();
    expect(cancel.spy.executed).toHaveLength(0);
  });

  it('印章 / 图片 / 出校符号走选区保护路径，取消录入则不触发', () => {
    const { ctx, spy } = fakeCtx({ promptAnswers: [null, null] });
    const rows = createToolbarRows(ctx, []);
    actionOf(rows, 'insert', '出校符号').run();
    expect(spy.replaced).toBe(1);
    actionOf(rows, 'insert', '印章').run();
    actionOf(rows, 'insert', '图片').run();
    expect(spy.replaced).toBe(1);
    expect(spy.prompts).toEqual(['印文（取消则不插入，确定留空用占位）', '图片地址（留空用占位图）']);

    const filled = fakeCtx({ promptAnswers: ['', ''] });
    const filledRows = createToolbarRows(filled.ctx, []);
    actionOf(filledRows, 'insert', '印章').run();
    actionOf(filledRows, 'insert', '图片').run();
    expect(filled.spy.replaced).toBe(2);
  });

  it('表格按钮仍有「立即插 3×3」的兜底 run（分发在组件里按 key 改写）', () => {
    const { ctx, spy } = fakeCtx();
    actionOf(createToolbarRows(ctx, []), 'insert', '表格').run();
    expect(spy.executed).toHaveLength(1);
  });

  it('合并 / 拆分单元格与清除格式的禁用判定取自选区', () => {
    const empty = fakeCtx({ selectionEmpty: true });
    const emptyRows = createToolbarRows(empty.ctx, []);
    expect(actionOf(emptyRows, 'insert', '合并单元格').disabled?.()).toBe(true);
    expect(actionOf(emptyRows, 'doc', '清除格式').disabled?.()).toBe(true);
    expect(actionOf(emptyRows, 'insert', '拆分单元格').disabled).toBeUndefined();
    actionOf(emptyRows, 'insert', '合并单元格').run();
    actionOf(emptyRows, 'insert', '拆分单元格').run();
    expect(empty.spy.executed).toEqual([mergeCells, splitCell]);

    const filled = fakeCtx({ selectionEmpty: false });
    const filledRows = createToolbarRows(filled.ctx, []);
    expect(actionOf(filledRows, 'insert', '合并单元格').disabled?.()).toBe(false);
    expect(actionOf(filledRows, 'doc', '清除格式').disabled?.()).toBe(false);
  });
});

describe('激活态查询', () => {
  it('标题级别按 attrs 过滤，节点名取自 core 常量', () => {
    const { ctx, spy } = fakeCtx();
    const rows = createToolbarRows(ctx, []);
    actionOf(rows, 'doc', 'H2').active?.();
    actionOf(rows, 'doc', '有序').active?.();
    actionOf(rows, 'doc', '正文').active?.();
    expect(spy.nodeQueries).toEqual([
      { name: NODE_TYPES.HEADING, attrs: { level: 2 } },
      { name: NODE_TYPES.LIST, attrs: { ordered: true } },
      { name: NODE_TYPES.PARAGRAPH, attrs: undefined },
    ]);
  });

  it('古籍标记查的是 classical 标记名，且不改结构', () => {
    const { ctx, spy } = fakeCtx({ marksOn: ['book-title'] });
    const rows = createToolbarRows(ctx, []);
    expect(actionOf(rows, 'classical', '书名号').active?.()).toBe(true);
    expect(spy.markQueries).toEqual(['book-title']);
  });
});

describe('createToolbarActionContext', () => {
  it('按 getter 取当前 binding：prop 换对象后命令派发到新视图', () => {
    const first = { executed: 0, execute() { this.executed += 1; return true; } };
    const second = { executed: 0, execute() { this.executed += 1; return true; } };
    let binding = first as unknown as EditorBinding;
    const ctx = createToolbarActionContext(() => binding);
    ctx.execute(() => true);
    binding = second as unknown as EditorBinding;
    ctx.execute(() => true);
    expect(first.executed).toBe(1);
    expect(second.executed).toBe(1);
  });

  it('空光标插入不弹窗；非空选区拒绝确认则不派发命令', () => {
    const execute = vi.fn(() => true);
    const selection = { empty: false };
    const binding = {
      editor: { editorState: { selection } },
      execute,
    } as unknown as EditorBinding;
    const ctx = createToolbarActionContext(() => binding);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);

    selection.empty = true;
    ctx.executeReplacingSelection(() => () => true);
    expect(confirm).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(1);

    execute.mockClear();
    selection.empty = false;
    ctx.executeReplacingSelection(() => () => true);
    expect(confirm).toHaveBeenCalledWith('该操作会用新节点替换选中的文字，继续？');
    expect(execute).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    ctx.executeReplacingSelection(() => () => true);
    expect(execute).toHaveBeenCalledTimes(1);
    confirm.mockRestore();
  });

  it('只切换 schema 已注册的标记，未注册名静默', () => {
    const execute = vi.fn(() => true);
    const binding = {
      editor: { bookSchema: { marks: { [MARK_TYPES.STRONG]: {} } } },
      execute,
    } as unknown as EditorBinding;
    const ctx = createToolbarActionContext(() => binding);
    ctx.toggleMark('no-such-mark');
    expect(execute).not.toHaveBeenCalled();
    ctx.toggleMark(MARK_TYPES.STRONG);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('激活态与历史可用性直接转发给 binding 的同名方法', () => {
    const binding = {
      isMarkActive: vi.fn(() => true),
      isNodeActive: vi.fn(() => false),
      canUndo: vi.fn(() => true),
      canRedo: vi.fn(() => false),
      editor: { editorState: { selection: { empty: true } } },
    } as unknown as EditorBinding;
    const ctx = createToolbarActionContext(() => binding);
    expect(ctx.markOn(MARK_TYPES.LINK)).toBe(true);
    expect(ctx.nodeOn(NODE_TYPES.HEADING, { level: 2 })).toBe(false);
    expect(ctx.canUndo()).toBe(true);
    expect(ctx.canRedo()).toBe(false);
    expect(ctx.selectionEmpty()).toBe(true);
  });

  it('promptText / confirmText 是原生弹窗的直透', () => {
    const binding = { execute: () => true } as unknown as EditorBinding;
    const ctx = createToolbarActionContext(() => binding);
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('https://a.test');
    expect(ctx.promptText('链接地址（取消则不插入）')).toBe('https://a.test');
    expect(prompt).toHaveBeenCalledWith('链接地址（取消则不插入）', undefined);
    prompt.mockRestore();
  });
});

describe('wheelScrollX', () => {
  /** 造一个可横向滚动的容器与滚轮事件 */
  function fakeWheel(deltaY: number, deltaMode: number) {
    const el = { scrollLeft: 0 };
    let prevented = 0;
    const event = {
      deltaY,
      deltaX: 0,
      deltaMode,
      preventDefault: () => {
        prevented += 1;
      },
    } as unknown as WheelEvent;
    return { el, event, preventedOf: () => prevented };
  }

  it('像素模式直接累加 deltaY 并接管事件', () => {
    const { el, event, preventedOf } = fakeWheel(40, WheelEvent.DOM_DELTA_PIXEL);
    wheelScrollX(el as unknown as HTMLElement, event);
    expect(el.scrollLeft).toBe(40);
    expect(preventedOf()).toBe(1);
  });

  it('行模式按每行 16px 折算', () => {
    const { el, event } = fakeWheel(3, WheelEvent.DOM_DELTA_LINE);
    wheelScrollX(el as unknown as HTMLElement, event);
    expect(el.scrollLeft).toBe(48);
  });
});
