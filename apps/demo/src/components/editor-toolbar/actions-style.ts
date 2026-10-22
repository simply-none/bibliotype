/**
 * 命名样式与清除格式动作（工具条第一行尾部，随样式列表增减）
 *
 * 纯工厂：入参只有依赖契约与样式列表，返回值即按钮数据，可脱离组件单测。
 */
import { type NamedStyle } from '@bibliotype/core';
import { applyNamedStyle, clearFormat } from '@bibliotype/editor';
import type { ToolbarAction, ToolbarActionContext } from './toolbar-action-types.js';

/** 命名样式批量套用 + 清除格式（样式列表变化时由调用侧重建） */
export function createStyleActions(
  ctx: ToolbarActionContext,
  namedStyles: readonly NamedStyle[] | undefined,
): readonly ToolbarAction[] {
  const actions: ToolbarAction[] = (namedStyles ?? []).map((style) => ({
    label: style.name,
    run: () => ctx.execute(applyNamedStyle(style.id)),
    title: `套用命名样式「${style.name}」到选区`,
    usage: {
      use: `把「${style.name}」套用到选区内所有文本块（空光标只作用于当前块）`,
      where: '写入块的 rawAttrs.styleId，序列化为 data-style-id',
      limit: style.basedOn ? '声明按依据链合并' : '不继承其他命名样式',
    },
  }));
  actions.push({
    label: '清除格式',
    run: () => ctx.execute(clearFormat()),
    disabled: () => ctx.selectionEmpty(),
    title: '清除选区的行内标记与命名样式',
    usage: {
      use: '移除粗体 / 斜体 / 链接 / 注音等标记，并清掉命名样式',
      require: '非空选区',
      where: '就地生效，保留块结构与节点 id',
      limit: '不清除对齐 / 角色等块级 attrs',
    },
  });
  return actions;
}
