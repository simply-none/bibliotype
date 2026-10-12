/**
 * 编辑插件与键位（无 DOM）
 *
 * - history：撤销 / 重做历史栈；
 * - keymap：ProseMirror 基础键位（baseKeymap）叠加书稿常用快捷键
 *   （行内标记、段落级别、列表换行、撤销重做）。
 */
import { MARK_TYPES, NODE_TYPES } from '@bibliotype/core';
import { baseKeymap, chainCommands, toggleMark } from 'prosemirror-commands';
import { history } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import type { Schema } from 'prosemirror-model';
import { splitListItem } from 'prosemirror-schema-list';
import type { Command, Plugin } from 'prosemirror-state';
import { redoCommand, setHeadingLevel, setParagraph, undoCommand } from './commands.js';

/**
 * 创建书籍编辑器键位（基础键位 + 书稿常用快捷键）
 *
 * - Mod-b / Mod-i / Mod-u：粗体 / 斜体 / 下划线（标记未注册时省略绑定）；
 * - Mod-z / Shift-Mod-z / Mod-y：撤销 / 重做 / 重做（Windows 习惯）；
 * - Mod-Alt-0..3：正文 / 标题 1~3；
 * - Enter：列表项内换行优先切分列表项，否则回退基础键位。
 */
export function createBookEditorKeymap(schema: Schema): Record<string, Command> {
  const bindings: Record<string, Command> = { ...baseKeymap };

  const strong = schema.marks[MARK_TYPES.STRONG];
  const emphasis = schema.marks[MARK_TYPES.EMPHASIS];
  const underline = schema.marks[MARK_TYPES.UNDERLINE];
  if (strong !== undefined) {
    bindings['Mod-b'] = toggleMark(strong);
  }
  if (emphasis !== undefined) {
    bindings['Mod-i'] = toggleMark(emphasis);
  }
  if (underline !== undefined) {
    bindings['Mod-u'] = toggleMark(underline);
  }

  bindings['Mod-z'] = undoCommand;
  bindings['Shift-Mod-z'] = redoCommand;
  bindings['Mod-y'] = redoCommand;

  bindings['Mod-Alt-0'] = setParagraph();
  bindings['Mod-Alt-1'] = setHeadingLevel(1);
  bindings['Mod-Alt-2'] = setHeadingLevel(2);
  bindings['Mod-Alt-3'] = setHeadingLevel(3);

  const listItem = schema.nodes[NODE_TYPES.LIST_ITEM];
  const baseEnter = bindings['Enter'];
  if (listItem !== undefined && baseEnter !== undefined) {
    bindings['Enter'] = chainCommands(splitListItem(listItem), baseEnter);
  }
  return bindings;
}

/** 创建书籍编辑器插件集（history + keymap） */
export function createBookEditorPlugins(schema: Schema): Plugin[] {
  return [history(), keymap(createBookEditorKeymap(schema))];
}
