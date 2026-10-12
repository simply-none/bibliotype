<script setup lang="ts">
/**
 * 编辑工具条（Demo 层）
 *
 * 接收 BtEditor 作用域插槽透传的 EditorBinding（binding）：
 * 撤销 / 重做｜正文与标题级别｜引用 / 列表｜粗 / 斜 / 下划线 / 高亮｜
 * 专名号 / 书名号 / 圈点 / 异体｜插入双行注 / 眉批 / 校勘记 / 出校符号｜还原样册。
 * 激活态由 binding.version 驱动（每次事务后重算 isMarkActive / isNodeActive）。
 */
import { MARK_TYPES, NODE_TYPES } from '@bibliotype/core';
import type { EditorBinding } from '@bibliotype/vue';
import {
  redoCommand,
  setHeadingLevel,
  setParagraph,
  toggleBulletList,
  toggleMarkOfType,
  toggleQuote,
  undoCommand,
} from '@bibliotype/editor';
import { CLASSICAL_MARK_TYPES } from '@bibliotype/classical';
import {
  insertCollationNote,
  insertCollationSymbol,
  insertDoubleNote,
  insertHeadNote,
  toggleBookTitle,
  toggleCircleEmphasis,
  toggleProperName,
  toggleVariant,
} from '@bibliotype/classical/editor';

const props = defineProps<{ binding: EditorBinding }>();
const emit = defineEmits<{ reset: [] }>();

/** 编辑命令（editor / classical 命令工厂的产物） */
type EditorCommand = ReturnType<typeof setParagraph>;

/** 工具条按钮描述 */
interface ToolbarAction {
  /** 按钮文字 */
  label: string;
  /** 点击执行 */
  run: () => void;
  /** 激活态（缺省不判定） */
  active?: () => boolean;
  /** 禁用态（缺省不禁用） */
  disabled?: () => boolean;
  /** 悬停提示 */
  title?: string;
}

/** 执行命令（未生效时静默） */
function execute(command: EditorCommand): void {
  void props.binding.execute(command);
}

/** 行内标记切换（未注册的标记类型不可用） */
function toggleMark(name: string): void {
  const markType = props.binding.editor.bookSchema.marks[name];
  if (markType !== undefined) {
    execute(toggleMarkOfType(markType));
  }
}

/** 标记激活态 */
function markOn(name: string): boolean {
  return props.binding.isMarkActive(name);
}

/** 节点激活态（可按属性过滤，如 heading 的 level） */
function nodeOn(name: string, attrs?: Record<string, unknown>): boolean {
  return props.binding.isNodeActive(name, attrs);
}

/** 撤销 / 重做（可用性随历史深度联动） */
const historyActions: readonly ToolbarAction[] = [
  {
    label: '撤销',
    run: () => execute(undoCommand),
    disabled: () => !props.binding.canUndo(),
    title: '撤销（Mod-Z）',
  },
  {
    label: '重做',
    run: () => execute(redoCommand),
    disabled: () => !props.binding.canRedo(),
    title: '重做（Shift-Mod-Z）',
  },
];

/** 段落级别与块形态 */
const blockActions: readonly ToolbarAction[] = [
  {
    label: '正文',
    run: () => execute(setParagraph()),
    active: () => nodeOn(NODE_TYPES.PARAGRAPH),
  },
  {
    label: 'H1',
    run: () => execute(setHeadingLevel(1)),
    active: () => nodeOn(NODE_TYPES.HEADING, { level: 1 }),
  },
  {
    label: 'H2',
    run: () => execute(setHeadingLevel(2)),
    active: () => nodeOn(NODE_TYPES.HEADING, { level: 2 }),
  },
  {
    label: 'H3',
    run: () => execute(setHeadingLevel(3)),
    active: () => nodeOn(NODE_TYPES.HEADING, { level: 3 }),
  },
  {
    label: '引用',
    run: () => execute(toggleQuote()),
    active: () => nodeOn(NODE_TYPES.QUOTE),
  },
  {
    label: '列表',
    run: () => execute(toggleBulletList()),
    active: () => nodeOn(NODE_TYPES.LIST),
  },
];

/** 行内标记（核心） */
const inlineActions: readonly ToolbarAction[] = [
  {
    label: 'B',
    run: () => toggleMark(MARK_TYPES.STRONG),
    active: () => markOn(MARK_TYPES.STRONG),
    title: '粗体（Mod-B）',
  },
  {
    label: 'I',
    run: () => toggleMark(MARK_TYPES.EMPHASIS),
    active: () => markOn(MARK_TYPES.EMPHASIS),
    title: '斜体（Mod-I）',
  },
  {
    label: 'U',
    run: () => toggleMark(MARK_TYPES.UNDERLINE),
    active: () => markOn(MARK_TYPES.UNDERLINE),
    title: '下划线（Mod-U）',
  },
  {
    label: '高亮',
    run: () => toggleMark(MARK_TYPES.HIGHLIGHT),
    active: () => markOn(MARK_TYPES.HIGHLIGHT),
    title: '高亮',
  },
];

/** 古籍标记（classical 编辑命令） */
const classicalActions: readonly ToolbarAction[] = [
  {
    label: '专名号',
    run: () => execute(toggleProperName()),
    active: () => markOn(CLASSICAL_MARK_TYPES.PROPER_NAME),
    title: '专名号（人名 / 地名等）',
  },
  {
    label: '书名号',
    run: () => execute(toggleBookTitle()),
    active: () => markOn(CLASSICAL_MARK_TYPES.BOOK_TITLE),
    title: '书名号',
  },
  {
    label: '圈点',
    run: () => execute(toggleCircleEmphasis()),
    active: () => markOn(CLASSICAL_MARK_TYPES.CIRCLE_EMPHASIS),
    title: '圈点（着重点）',
  },
  {
    label: '异体',
    run: () => execute(toggleVariant()),
    active: () => markOn(CLASSICAL_MARK_TYPES.VARIANT),
    title: '异体字标记',
  },
];

/** 块插入与符号（在当前叶块之后插入容器；符号插入在光标处） */
const insertActions: readonly ToolbarAction[] = [
  {
    label: '双行注',
    run: () => execute(insertDoubleNote()),
    title: '在当前段落之后插入双行小注',
  },
  {
    label: '眉批',
    run: () => execute(insertHeadNote()),
    title: '在当前段落之后插入眉批',
  },
  {
    label: '校勘记',
    run: () => execute(insertCollationNote()),
    title: '在当前段落之后插入校勘记',
  },
  {
    label: '出校符号',
    run: () => execute(insertCollationSymbol()),
    title: '在光标处插入出校符号（○）',
  },
];

/** 分组（模板按组渲染，组间以分隔线区分） */
const TOOLBAR_GROUPS: ReadonlyArray<{ key: string; actions: readonly ToolbarAction[] }> = [
  { key: 'history', actions: historyActions },
  { key: 'block', actions: blockActions },
  { key: 'inline', actions: inlineActions },
  { key: 'classical', actions: classicalActions },
  { key: 'insert', actions: insertActions },
];
</script>

<template>
  <div class="editor-toolbar">
    <div v-for="group in TOOLBAR_GROUPS" :key="group.key" class="editor-toolbar__group">
      <button
        v-for="action in group.actions"
        :key="action.label"
        type="button"
        class="editor-toolbar__button"
        :class="{ 'editor-toolbar__button--active': action.active?.() === true }"
        :title="action.title"
        :disabled="action.disabled?.() === true"
        @mousedown.prevent
        @click="action.run()"
      >
        {{ action.label }}
      </button>
    </div>
    <div class="editor-toolbar__group editor-toolbar__group--end">
      <button
        type="button"
        class="editor-toolbar__button"
        title="编辑器内容重置为原始样册"
        @mousedown.prevent
        @click="emit('reset')"
      >
        还原样册
      </button>
    </div>
  </div>
</template>

<style scoped>
.editor-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 12px;
  padding: 8px 10px;
  border: 1px solid var(--demo-border);
  border-radius: 8px;
  background: var(--demo-panel);
  color: var(--demo-text);
}

.editor-toolbar__group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.editor-toolbar__group + .editor-toolbar__group {
  padding-inline-start: 12px;
  border-inline-start: 1px solid var(--demo-border);
}

.editor-toolbar__group--end {
  margin-inline-start: auto;
  padding-inline-start: 0;
  border-inline-start: none;
}

.editor-toolbar__button {
  padding: 4px 10px;
  font-size: 13px;
  color: var(--demo-text);
  background: var(--demo-control);
  border: 1px solid var(--demo-control-border);
  border-radius: 4px;
  cursor: pointer;
}

.editor-toolbar__button:hover:not(:disabled) {
  border-color: var(--demo-accent);
  color: var(--demo-accent);
}

.editor-toolbar__button:disabled {
  opacity: 0.45;
  cursor: default;
}

.editor-toolbar__button--active {
  color: #fff;
  background: var(--demo-accent);
  border-color: var(--demo-accent);
}

.editor-toolbar__button--active:hover:not(:disabled) {
  color: #fff;
}
</style>
