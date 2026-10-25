/**
 * 「替换为」目标注册表（Demo 层）
 *
 * 为什么放在 demo 而不是插件包：注册表同时引用 `@bibliotype/editor`（块类型 /
 * 通用容器）与 `@bibliotype/classical/editor`（古籍容器 / 行内容器），而
 * editor 不能反向依赖 classical（依赖矩阵）。消费层组装是唯一不破坏分层的落点。
 *
 * 每个 item 只提供「命令工厂」，点击时由 `BtSelectionReplaceMenu` 统一走
 * `binding.execute`（paged 态传 slotBinding，重排后能还原光标）。
 */
import type { EditorBinding, ReplaceTargetGroup } from '@bibliotype/vue';
import { NODE_TYPES } from '@bibliotype/core';
import {
  replaceSelectionWithContainer,
  setHeadingLevel,
  setParagraph,
  toggleBulletList,
  toggleOrderedList,
  toggleQuote,
} from '@bibliotype/editor';
import {
  replaceWithBorderFrame,
  replaceWithCollationNote,
  replaceWithColophon,
  replaceWithHeadNote,
  replaceWithImprint,
  replaceWithTailNote,
  toggleInlineNote,
  toggleTabooChar,
  toggleVariantChar,
  wrapDoubleNote,
} from '@bibliotype/classical/editor';

/** 行内容器只支持同段选区（跨段置灰） */
function crossBlockSelection(binding: EditorBinding): boolean {
  const selection = binding.editor.editorState.selection;
  return (
    selection.empty || selection.$from.parent !== selection.$to.parent
  );
}

/** 块级容器要求选区落在同一父容器（同一章节）内 */
function crossParentSelection(binding: EditorBinding): boolean {
  const selection = binding.editor.editorState.selection;
  if (selection.empty) {
    return false;
  }
  const $from = selection.$from;
  const $to = selection.$to;
  if (!$from.parent.isTextblock || !$to.parent.isTextblock) {
    return true;
  }
  return (
    $from.depth !== $to.depth ||
    $from.node($from.depth - 1) !== $to.node($to.depth - 1)
  );
}

/** 「替换为」三组目标：块类型 / 块级容器 / 行内容器 */
export const REPLACE_TARGET_GROUPS: readonly ReplaceTargetGroup[] = [
  {
    key: 'block-type',
    label: '块类型',
    items: [
      {
        key: 'paragraph',
        label: '正文',
        command: () => setParagraph(),
        hint: '整块生效：当前块改为正文',
      },
      {
        key: 'h1',
        label: 'H1',
        command: () => setHeadingLevel(1),
        hint: '整块生效：当前块改为一级标题（排版时另起页）',
      },
      {
        key: 'h2',
        label: 'H2',
        command: () => setHeadingLevel(2),
        hint: '整块生效：当前块改为二级标题（排版时另起页）',
      },
      {
        key: 'h3',
        label: 'H3',
        command: () => setHeadingLevel(3),
        hint: '整块生效：当前块改为三级标题',
      },
      {
        key: 'quote',
        label: '引用',
        command: () => toggleQuote(),
        hint: '整块生效：包裹 / 取消引用',
      },
      {
        key: 'bullet-list',
        label: '无序',
        command: () => toggleBulletList(),
        hint: '整块生效：转为无序列表',
      },
      {
        key: 'ordered-list',
        label: '有序',
        command: () => toggleOrderedList(),
        hint: '整块生效：转为有序列表',
      },
    ],
  },
  {
    key: 'block-container',
    label: '块级容器',
    items: [
      {
        key: 'head-note',
        label: '眉批',
        command: () => replaceWithHeadNote(),
        disabled: crossParentSelection,
        hint: '选中文字进入眉批，前后文自动切分（需同一章节内选择）',
      },
      {
        key: 'tail-note',
        label: '跋文',
        command: () => replaceWithTailNote(),
        disabled: crossParentSelection,
        hint: '选中文字进入跋文（需同一章节内选择）',
      },
      {
        key: 'collation-note',
        label: '校勘记',
        command: () => replaceWithCollationNote(),
        disabled: crossParentSelection,
        hint: '选中文字进入校勘记（需同一章节内选择）',
      },
      {
        key: 'imprint',
        label: '牌记',
        command: () => replaceWithImprint(),
        disabled: crossParentSelection,
        hint: '选中文字进入牌记（需同一章节内选择）',
      },
      {
        key: 'colophon',
        label: '题记',
        command: () => replaceWithColophon(),
        disabled: crossParentSelection,
        hint: '选中文字进入题记（需同一章节内选择）',
      },
      {
        key: 'border-frame',
        label: '版框',
        command: () => replaceWithBorderFrame(),
        disabled: crossParentSelection,
        hint: '选中文字进入版框（需同一章节内选择）',
      },
      {
        key: 'footnote',
        label: '脚注',
        command: () => replaceSelectionWithContainer(NODE_TYPES.FOOTNOTE),
        disabled: crossParentSelection,
        hint: '选中文字进入脚注（需同一章节内选择）',
      },
      {
        key: 'endnote',
        label: '尾注',
        command: () => replaceSelectionWithContainer(NODE_TYPES.ENDNOTE),
        disabled: crossParentSelection,
        hint: '选中文字进入尾注（需同一章节内选择）',
      },
      {
        key: 'margin-note',
        label: '边注',
        command: () => replaceSelectionWithContainer(NODE_TYPES.MARGIN_NOTE),
        disabled: crossParentSelection,
        hint: '选中文字进入边注（需同一章节内选择）',
      },
    ],
  },
  {
    key: 'inline-container',
    label: '行内容器',
    items: [
      {
        key: 'double-note',
        label: '双行夹注',
        command: () => wrapDoubleNote(),
        disabled: crossBlockSelection,
        hint: '选中文字进入双行夹注（行内随文连排，古籍口径），前后文留在同段',
      },
      {
        key: 'inline-note',
        label: '夹注',
        command: () => toggleInlineNote(),
        disabled: crossBlockSelection,
        hint: '仅同段选区：选中文字进入夹注',
      },
      {
        key: 'variant-char',
        label: '异体字',
        command: () => toggleVariantChar(),
        disabled: crossBlockSelection,
        hint: '仅同段选区：选中文字进入异体字载体',
      },
      {
        key: 'taboo-char',
        label: '避讳字',
        command: () => toggleTabooChar(),
        disabled: crossBlockSelection,
        hint: '仅同段选区：选中文字进入避讳字载体',
      },
    ],
  },
];
