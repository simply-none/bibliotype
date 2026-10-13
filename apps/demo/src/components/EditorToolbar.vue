<script setup lang="ts">
/**
 * 编辑工具条（Demo 层）
 *
 * 接收 BtEditor 作用域插槽透传的 EditorBinding（binding）：
 * 撤销 / 重做｜正文与标题级别｜引用 / 无序 / 有序列表｜粗 / 斜 / 下划线 / 高亮 /
 * 删除线 / 行内代码 / 链接 / 注音｜专名号 / 书名号 / 圈点 / 异体 / 注Ref / 避讳 /
 * 夹注 / 异体载体 / 避讳载体｜插入双行注 / 眉批 / 校勘记 / 出校符号 / 跋文 / 牌记 /
 * 题记 / 版框 / 鱼尾 / 印章 / 图片 / 表格 / 脚注 / 尾注 / 边注｜还原样册。
 * 激活态由 binding.version 驱动（每次事务后重算 isMarkActive / isNodeActive）。
 */
import { computed, ref } from 'vue';
import { MARK_TYPES, NODE_TYPES } from '@bibliotype/core';
import type { EditorBinding } from '@bibliotype/vue';
import {
  insertBlockOfType,
  insertImage,
  insertTable,
  redoCommand,
  setHeadingLevel,
  setLink,
  setParagraph,
  toggleBulletList,
  toggleMarkByName,
  toggleMarkOfType,
  toggleOrderedList,
  toggleQuote,
  undoCommand,
  unsetLink,
} from '@bibliotype/editor';
import { CLASSICAL_MARK_TYPES } from '@bibliotype/classical';
import {
  insertBorderFrame,
  insertCollationNote,
  insertCollationSymbol,
  insertColophon,
  insertDoubleNote,
  insertFishTail,
  insertHeadNote,
  insertImprint,
  insertSeal,
  insertTailNote,
  toggleBookTitle,
  toggleCircleEmphasis,
  toggleInlineNote,
  toggleNoteRef,
  toggleProperName,
  toggleTaboo,
  toggleTabooChar,
  toggleVariant,
  toggleVariantChar,
} from '@bibliotype/classical/editor';
import ReplacePanel from './ReplacePanel.vue';

const props = defineProps<{ binding: EditorBinding; readonly?: boolean }>();
const emit = defineEmits<{ reset: []; 'toggle-readonly': [] }>();

/** 查找替换面板开关（仅编辑态工具条内部状态） */
const searchOpen = ref(false);

/** 只读：禁用全部写操作命令（保留面板展开 / 只读切换自身） */
const isReadonly = computed(() => props.readonly === true);

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
    label: '无序',
    run: () => execute(toggleBulletList()),
    active: () => nodeOn(NODE_TYPES.LIST, { ordered: false }),
    title: '无序列表',
  },
  {
    label: '有序',
    run: () => execute(toggleOrderedList()),
    active: () => nodeOn(NODE_TYPES.LIST, { ordered: true }),
    title: '有序列表',
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
  {
    label: '删除线',
    run: () => execute(toggleMarkByName(MARK_TYPES.STRIKETHROUGH, undefined, true)),
    active: () => markOn(MARK_TYPES.STRIKETHROUGH),
    title: '删除线（需选中文字）',
  },
  {
    label: '代码',
    run: () => execute(toggleMarkByName(MARK_TYPES.CODE, undefined, true)),
    active: () => markOn(MARK_TYPES.CODE),
    title: '行内代码（需选中文字）',
  },
  {
    label: '链接',
    run: () => toggleLink(),
    active: () => markOn(MARK_TYPES.LINK),
    title: '选中文字后输入地址；已有链接时点击移除',
  },
  {
    label: '注音',
    run: () => toggleRuby(),
    active: () => markOn(MARK_TYPES.RUBY),
    title: '选中文字后输入注文（ruby）',
  },
];

/** 链接：选中文字输 href；已有链接时再次点击移除 */
function toggleLink(): void {
  if (markOn(MARK_TYPES.LINK)) {
    execute(unsetLink());
    return;
  }
  const href = window.prompt('链接地址（取消则不插入）');
  if (href) {
    execute(setLink(href));
  }
}

/** 注音：选中文字输注文；已有注音时再次点击移除标记 */
function toggleRuby(): void {
  if (markOn(MARK_TYPES.RUBY)) {
    execute(toggleMarkByName(MARK_TYPES.RUBY, undefined, true));
    return;
  }
  const text = window.prompt('注文内容（取消则不添加）');
  if (text !== null) {
    execute(toggleMarkByName(MARK_TYPES.RUBY, { text }));
  }
}

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
  {
    label: '注Ref',
    run: () => execute(toggleNoteRef()),
    active: () => markOn(CLASSICAL_MARK_TYPES.NOTE_REF),
    title: '注Ref标记（noteId 在属性栏录入）',
  },
  {
    label: '避讳',
    run: () => execute(toggleTaboo()),
    active: () => markOn(CLASSICAL_MARK_TYPES.TABOO),
    title: '避讳字标记',
  },
  {
    label: '夹注',
    run: () => execute(toggleInlineNote()),
    title: '选中文字包裹为夹注（空光标插入容器）',
  },
  {
    label: '异体载体',
    run: () => execute(toggleVariantChar()),
    title: '选中文字包裹为异体字载体',
  },
  {
    label: '避讳载体',
    run: () => execute(toggleTabooChar()),
    title: '选中文字包裹为避讳字载体',
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
  {
    label: '跋文',
    run: () => execute(insertTailNote()),
    title: '在当前段落之后插入跋文',
  },
  {
    label: '牌记',
    run: () => execute(insertImprint()),
    title: '在当前段落之后插入牌记',
  },
  {
    label: '题记',
    run: () => execute(insertColophon()),
    title: '在当前段落之后插入题记',
  },
  {
    label: '版框',
    run: () => execute(insertBorderFrame()),
    title: '在当前段落之后插入版框',
  },
  {
    label: '鱼尾',
    run: () => execute(insertFishTail()),
    title: '在当前段落之后插入鱼尾',
  },
  {
    label: '印章',
    run: () => {
      const text = window.prompt('印文（取消则不插入，确定留空用占位）');
      if (text !== null) {
        execute(insertSeal(text || undefined));
      }
    },
    title: '在光标处插入印章',
  },
  {
    label: '图片',
    run: () => {
      const src = window.prompt('图片地址（留空用占位图）', '');
      if (src !== null) {
        execute(insertImage({ src: src || undefined, alt: '' }));
      }
    },
    title: '在光标处插入图片（src / alt 可在属性栏修改）',
  },
  {
    label: '表格',
    run: () => execute(insertTable(3, 3)),
    title: '在当前段落之后插入 3×3 表格',
  },
  {
    label: '脚注',
    run: () => execute(insertBlockOfType(NODE_TYPES.FOOTNOTE)),
    title: '在当前段落之后插入脚注',
  },
  {
    label: '尾注',
    run: () => execute(insertBlockOfType(NODE_TYPES.ENDNOTE)),
    title: '在当前段落之后插入尾注',
  },
  {
    label: '边注',
    run: () => execute(insertBlockOfType(NODE_TYPES.MARGIN_NOTE)),
    title: '在当前段落之后插入边注',
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
    <div
      v-for="group in TOOLBAR_GROUPS"
      :key="group.key"
      class="editor-toolbar__group"
      :class="{ 'editor-toolbar__group--disabled': isReadonly }"
    >
      <button
        v-for="action in group.actions"
        :key="action.label"
        type="button"
        class="editor-toolbar__button"
        :class="{ 'editor-toolbar__button--active': action.active?.() === true }"
        :title="action.title"
        :disabled="isReadonly || action.disabled?.() === true"
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
        :class="{ 'editor-toolbar__button--active': searchOpen }"
        title="在编辑画布内查找与替换文本"
        @mousedown.prevent
        @click="searchOpen = !searchOpen"
      >
        查找替换
      </button>
      <button
        type="button"
        class="editor-toolbar__button"
        :class="{ 'editor-toolbar__button--active': isReadonly }"
        :title="isReadonly ? '切换为可编辑' : '切换为只读（不可输入）'"
        @mousedown.prevent
        @click="emit('toggle-readonly')"
      >
        {{ isReadonly ? '可编辑' : '只读' }}
      </button>
      <button
        type="button"
        class="editor-toolbar__button"
        title="编辑器内容重置为原始样册"
        :disabled="isReadonly"
        @mousedown.prevent
        @click="emit('reset')"
      >
        还原样册
      </button>
    </div>
  </div>
  <ReplacePanel
    v-if="searchOpen"
    :binding="binding"
    :readonly="isReadonly"
    @close="searchOpen = false"
  />
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

.editor-toolbar__group--disabled {
  opacity: 0.6;
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
