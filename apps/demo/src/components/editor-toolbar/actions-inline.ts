/**
 * 行内标记动作（工具条第一行的后半段：粗 / 斜 / 下划线 / 高亮 / 删除线 / 代码 / 链接 / 注音）
 *
 * 纯工厂：入参只有依赖契约，返回值即按钮数据，可脱离组件单测。
 * 文本（`label` / `title` / `usage`）与 `docs/19-editor-toolbar-usage.md` 速查表同源，改一处需同步另一处。
 */
import { MARK_TYPES } from '@bibliotype/core';
import { setLink, toggleMarkByName, unsetLink } from '@bibliotype/editor';
import type { ToolbarAction, ToolbarActionContext } from './toolbar-action-types.js';

/**
 * 行内标记（核心）
 *
 * 统一语义：选区非空 → 对选区切换标记；空光标 → 写 storedMarks（只影响接下来输入的文本）。
 * 例外：删除线 / 行内代码显式 `requireSelection=true`，空光标点击不执行。
 */
export function createInlineActions(ctx: ToolbarActionContext): readonly ToolbarAction[] {
  return [
    {
      label: 'B',
      run: () => ctx.toggleMark(MARK_TYPES.STRONG),
      active: () => ctx.markOn(MARK_TYPES.STRONG),
      title: '粗体（Mod-B）',
      usage: {
        use: '切换粗体',
        where: '标记覆盖选区；空光标则作用于后续输入',
        key: 'Mod-B',
      },
    },
    {
      label: 'I',
      run: () => ctx.toggleMark(MARK_TYPES.EMPHASIS),
      active: () => ctx.markOn(MARK_TYPES.EMPHASIS),
      title: '斜体（Mod-I）',
      usage: {
        use: '切换斜体',
        where: '标记覆盖选区；空光标则作用于后续输入',
        key: 'Mod-I',
      },
    },
    {
      label: 'U',
      run: () => ctx.toggleMark(MARK_TYPES.UNDERLINE),
      active: () => ctx.markOn(MARK_TYPES.UNDERLINE),
      title: '下划线（Mod-U）',
      usage: {
        use: '切换下划线',
        where: '标记覆盖选区；空光标则作用于后续输入',
        key: 'Mod-U',
      },
    },
    {
      label: '高亮',
      run: () => ctx.toggleMark(MARK_TYPES.HIGHLIGHT),
      active: () => ctx.markOn(MARK_TYPES.HIGHLIGHT),
      title: '高亮',
      usage: {
        use: '切换高亮底色',
        where: '标记覆盖选区；空光标则作用于后续输入',
        attrs: '高亮颜色由样式表的高亮令牌决定，不在属性栏逐处设置',
      },
    },
    {
      label: '删除线',
      run: () => ctx.execute(toggleMarkByName(MARK_TYPES.STRIKETHROUGH, undefined, true)),
      active: () => ctx.markOn(MARK_TYPES.STRIKETHROUGH),
      title: '删除线（需选中文字）',
      usage: {
        use: '给选中文字加 / 去删除线',
        require: '必须先选中文字',
        where: '标记覆盖选区',
        limit: '空光标点击不执行（requireSelection，避免误清空待输入标记）',
      },
    },
    {
      label: '代码',
      run: () => ctx.execute(toggleMarkByName(MARK_TYPES.CODE, undefined, true)),
      active: () => ctx.markOn(MARK_TYPES.CODE),
      title: '行内代码（需选中文字）',
      usage: {
        use: '把选中文字标记为行内代码（等宽）',
        require: '必须先选中文字',
        where: '标记覆盖选区',
        limit: '空光标点击不执行；块级代码请用代码块节点',
      },
    },
    {
      label: '链接',
      run: () => toggleLink(ctx),
      active: () => ctx.markOn(MARK_TYPES.LINK),
      title: '选中文字后输入地址；已有链接时点击移除',
      usage: {
        use: '选中文字后弹窗输入地址；光标已在链接上时点击即移除链接',
        require: '必须先选中文字（空光标无待输入 link 标记时不执行）',
        where: 'link 标记覆盖选区，href 记在 attrs',
        attrs: 'link.href（插入后可在属性栏改地址）',
        limit: '弹出的是浏览器 prompt，取消则不插入；导出时由序列化器输出 <a>',
      },
    },
    {
      label: '注音',
      run: () => toggleRuby(ctx),
      active: () => ctx.markOn(MARK_TYPES.RUBY),
      title: '选中文字后输入注文（ruby）',
      usage: {
        use: '选中文字后弹窗输入注文，渲染为 <ruby>基字<rt>注文</rt></ruby>；已有注音时点击即移除',
        where: 'ruby 标记覆盖选区（空光标可用，标记待输入）',
        attrs: 'ruby.text（注文内容，改注文走属性栏）',
        limit: '注文计入 DOM 文本但不计入模型字符偏移（见 ruby-annotation 的跳过规则）',
      },
    },
  ];
}

/** 链接：选中文字输 href；已有链接时再次点击移除 */
function toggleLink(ctx: ToolbarActionContext): void {
  if (ctx.markOn(MARK_TYPES.LINK)) {
    ctx.execute(unsetLink());
    return;
  }
  const href = ctx.promptText('链接地址（取消则不插入）');
  if (href) {
    ctx.execute(setLink(href));
  }
}

/** 注音：选中文字输注文；已有注音时再次点击移除标记 */
function toggleRuby(ctx: ToolbarActionContext): void {
  if (ctx.markOn(MARK_TYPES.RUBY)) {
    ctx.execute(toggleMarkByName(MARK_TYPES.RUBY, undefined, true));
    return;
  }
  const text = ctx.promptText('注文内容（取消则不添加）');
  if (text !== null) {
    ctx.execute(toggleMarkByName(MARK_TYPES.RUBY, { text }));
  }
}
