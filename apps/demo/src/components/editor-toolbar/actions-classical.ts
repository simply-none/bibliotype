/**
 * 古籍标记动作（工具条第二行）
 *
 * 纯工厂：入参只有依赖契约，返回值即按钮数据，可脱离组件单测。
 * 文本（`label` / `title` / `usage`）与 `docs/19-editor-toolbar-usage.md` 速查表同源，改一处需同步另一处。
 */
import { CLASSICAL_MARK_TYPES } from '@bibliotype/classical';
import {
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
import type { ToolbarAction, ToolbarActionContext } from './toolbar-action-types.js';

/**
 * 古籍标记（classical 编辑命令）
 *
 * 前 6 个是行内标记（空光标 = 设置待输入标记）；后 3 个是行内容器（需要选区包裹）。
 * 标记的渲染样式（专名线 / 圈点 / 避讳写法）全部由 `book-css.ts` 的 `.bt-mark-*` 与
 * `.bt-*` 类决定，工具条只负责打标记，不负责外观。
 */
export function createClassicalActions(ctx: ToolbarActionContext): readonly ToolbarAction[] {
  return [
    {
      label: '专名号',
      run: () => ctx.execute(toggleProperName()),
      active: () => ctx.markOn(CLASSICAL_MARK_TYPES.PROPER_NAME),
      title: '专名号（人名 / 地名等）',
      usage: {
        use: '给选中文字加专名号（人名、地名、朝代等）',
        where: '标记覆盖选区；空光标则作用于后续输入',
        limit: '纯语义标记，样式由样式表的专名号令牌决定',
      },
    },
    {
      label: '书名号',
      run: () => ctx.execute(toggleBookTitle()),
      active: () => ctx.markOn(CLASSICAL_MARK_TYPES.BOOK_TITLE),
      title: '书名号',
      usage: {
        use: '给选中文字加书名号标记',
        where: '标记覆盖选区；空光标则作用于后续输入',
        limit: '输出的是标记而非文字「《》」，导出样式与古籍版式一致',
      },
    },
    {
      label: '圈点',
      run: () => ctx.execute(toggleCircleEmphasis()),
      active: () => ctx.markOn(CLASSICAL_MARK_TYPES.CIRCLE_EMPHASIS),
      title: '圈点（着重点）',
      usage: {
        use: '给选中文字加圈点（着重点 / 侧圈）',
        where: '标记覆盖选区；空光标则作用于后续输入',
        attrs:
          'circle-emphasis.style（缺省 circle；可选 open-circle / dot / open-dot / double-circle / triangle / sesame）',
        limit: '直排下圈点位置由样式表按书写方向调整',
      },
    },
    {
      label: '异体',
      run: () => ctx.execute(toggleVariant()),
      active: () => ctx.markOn(CLASSICAL_MARK_TYPES.VARIANT),
      title: '异体字标记',
      usage: {
        use: '标记选中文字为异体字',
        where: '标记覆盖选区；空光标则作用于后续输入',
        limit: '与「异体载体」不同：这是标记（不改变节点结构），载体是行内容器',
      },
    },
    {
      label: '注Ref',
      run: () => ctx.execute(toggleNoteRef()),
      active: () => ctx.markOn(CLASSICAL_MARK_TYPES.NOTE_REF),
      title: '注Ref标记（noteId 在属性栏录入）',
      usage: {
        use: '把选中文字标为指向某条注释的引点',
        where: '标记覆盖选区',
        attrs: 'note-ref.noteId（必填，工具条不弹窗录入）',
        limit: '只打标记不建链接：noteId 未补录时导出无锚点跳转',
      },
    },
    {
      label: '避讳',
      run: () => ctx.execute(toggleTaboo()),
      active: () => ctx.markOn(CLASSICAL_MARK_TYPES.TABOO),
      title: '避讳字标记',
      usage: {
        use: '标记选中文字为避讳字',
        where: '标记覆盖选区；空光标则作用于后续输入',
        limit: '与「避讳载体」不同：标记不改结构，载体是行内容器',
      },
    },
    {
      label: '夹注',
      run: () => ctx.execute(toggleInlineNote()),
      title: '选中文字包裹为夹注（空光标插入容器）',
      usage: {
        use: '选中文字 → 包裹成夹注；空光标 → 插入空夹注容器并进入其中',
        where: '行内容器包裹选区（结果替代原选区）',
        limit: '跨段落选区静默不执行（单个行内片段无法表达跨块内容）',
      },
    },
    {
      label: '异体载体',
      run: () => ctx.execute(toggleVariantChar()),
      title: '选中文字包裹为异体字载体',
      usage: {
        use: '选中文字 → 包裹成异体字载体；空光标 → 插入空载体',
        where: '行内容器包裹选区',
        limit: '跨段落选区静默不执行',
      },
    },
    {
      label: '避讳载体',
      run: () => ctx.execute(toggleTabooChar()),
      title: '选中文字包裹为避讳字载体',
      usage: {
        use: '选中文字 → 包裹成避讳字载体；空光标 → 插入空载体',
        where: '行内容器包裹选区',
        limit: '跨段落选区静默不执行',
      },
    },
  ];
}
