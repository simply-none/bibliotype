# 19 编辑工具条使用说明（功能速查）

> 适用对象：产品 / 测试 / 二次开发者。读完能回答「这个按钮点了会发生什么、要什么前提、为什么没反应」，
> 不必翻 600 行的 `EditorToolbar.vue`。
> 对应实现：`apps/demo/src/components/EditorToolbar.vue`（交互层）+ `packages/editor/src/commands.ts`
> 与 `packages/classical/src/editor-commands.ts`（命令层）。

## 一、说明放在哪一层（改动前先看这里）

| 层 | 写什么 | 位置 | 权威性 |
| --- | --- | --- | --- |
| 命令层 | 命令契约：前置条件、落点、返回 `false` 的原因、`attrs` 结构 | `packages/editor/src/commands.ts`、`packages/classical/src/editor-commands.ts` 的 JSDoc | **权威口径**，改语义必须同步 |
| 交互层 | 按钮怎么用：要不要选中、快捷键、去属性栏补什么、为什么点了没反应 | `EditorToolbar.vue` 每个 `ToolbarAction.usage` | demo 的交互决策，不属于插件包 API |
| 本文档 | 全量速查表 | 本文件 | 索引，细节以代码注释为准 |

`usage` 是**可插拔字段**：传了就由 `ToolbarUsageTip`（Vue 组件）在**鼠标悬浮 / 键盘聚焦**
时弹出说明卡片；没传则该按钮不注册任何悬浮行为（工具条抽成公共组件后由使用方决定是否带说明）。
卡片 `Teleport` 到 body 并用 `position: fixed` 定位——工具条自身 `overflow-x: auto` 会裁掉普通
溢出内容，这也决定了不能把卡片直接放在按钮内部；下方空间不足时自动翻到上方，右侧溢出则右对齐，
滚动 / 缩放时立即收起。本文档是同一份数据的离线速查页，新增按钮时两处同步。

## 二、通用规则（先看这四条，能解释 80% 的疑问）

1. **行内标记有两种选区语义**：选区非空 → 对选区切换；空光标 → 只写 `storedMarks`，
   下一次输入才继承。所以「B / I / U / 高亮 / 注音 / 古籍标记」空光标可点；
   而「删除线 / 行内代码」显式要求必须先选中文字，空光标点击**静默不执行**。
2. **块插入有两种落点**：容器类（注疏 / 表格 / 脚注等）插在「当前叶块之后」，光标随即进入；
   原子类（印章 / 图片 / 出校符号）就地替换选区，不移动光标。
3. **行内容器只支持同段选区**：夹注 / 异体载体 / 避讳载体跨段落选区直接返回 `false`（无反应）。
4. **只读是视图层开关**：只读下所有写按钮置灰、输入与粘贴被拒，但工具条、查找替换仍可展开，
   按钮的悬浮说明也照常可看；程序化事务（自动保存恢复等）不受限。

## 三、速查表

### 3.1 历史

| 按钮 | 前提 | 效果 / 落点 | 命令 | 快捷键 | 限制 |
| --- | --- | --- | --- | --- | --- |
| 撤销 | 有历史 | 回退最近一次事务，选区回到事务前位置 | `undoCommand` | `Mod-Z` | 无历史时置灰 |
| 重做 | 有重做栈 | 重新应用被撤销的事务 | `redoCommand` | `Shift-Mod-Z` / `Mod-Y` | 撤销后一旦继续编辑，重做栈清空 |

### 3.2 段落与块

| 按钮 | 前提 | 效果 / 落点 | 命令 | 快捷键 | 限制 |
| --- | --- | --- | --- | --- | --- |
| 正文 | 光标在文本块内 | 当前块转为 `paragraph`，`id` 与内容保留 | `setParagraph()` | `Mod-Alt-0` | 只改块类型，不清行内标记 |
| H1 | 同上 | 当前块转为一级标题 | `setHeadingLevel(1)` | `Mod-Alt-1` | 命令支持 1~6，工具条只暴露 1~3 |
| H2 | 同上 | 二级标题 | `setHeadingLevel(2)` | `Mod-Alt-2` | 同上 |
| H3 | 同上 | 三级标题 | `setHeadingLevel(3)` | `Mod-Alt-3` | 同上 |
| 引用 | 光标在文本块内 | 包裹为 `quote`；已在引用内则提升退出 | `toggleQuote()` | — | schema 未注册 `quote` 时无反应 |
| 无序 | 光标在文本块内 | 包裹为无序列表 / 已是无序则退出 / 有序则转无序 | `toggleBulletList()` | — | 列表内 `Enter` 拆分列表项 |
| 有序 | 同上 | 包裹为有序列表 / 已在有序则退出 / 无序则转有序 | `toggleOrderedList()` | — | 无起始序号入口（固定从 1） |

> `id` 保留由包内 `setBlockTypeKeepingId` 保证：原生 `setBlockType` 在 prosemirror 1.25 下会把
> `attrs` 整体归默认，表现为「每点一次正文，块的 `id` 被清空」。改这块代码前先读该函数注释。

### 3.3 行内标记

| 按钮 | 前提 | 效果 / 落点 | 命令 | 快捷键 | 限制 |
| --- | --- | --- | --- | --- | --- |
| B | 任意 | 切换 `strong`，空光标作用于后续输入 | `toggleMarkOfType(strong)` | `Mod-B` | — |
| I | 任意 | 切换 `emphasis` | `toggleMarkOfType(emphasis)` | `Mod-I` | — |
| U | 任意 | 切换 `underline` | `toggleMarkOfType(underline)` | `Mod-U` | — |
| 高亮 | 任意 | 切换 `highlight` | `toggleMarkOfType(highlight)` | — | 颜色走样式令牌，不逐处设置 |
| 删除线 | **必须先选中** | 切换 `strikethrough` | `toggleMarkByName(strikethrough, undefined, true)` | — | 空光标不执行 |
| 代码 | **必须先选中** | 切换行内 `code` | `toggleMarkByName(code, undefined, true)` | — | 空光标不执行 |
| 链接 | **必须先选中** | 弹窗输入地址；光标已在链接上则移除 | `setLink(href)` / `unsetLink()` | — | 用浏览器 `prompt`；空光标无待输入链接时不执行 |
| 注音 | 选中或空光标 | 弹窗输入注文，渲染 `<ruby>基字<rt>注文</rt></ruby>` | `toggleMarkByName(ruby, { text })` | — | 改注文走属性栏；`<rt>` 不计入模型字符偏移 |

### 3.4 古籍标记

| 按钮 | 前提 | 效果 / 落点 | 命令 | 属性补录 | 限制 |
| --- | --- | --- | --- | --- | --- |
| 专名号 | 任意 | 标记人名 / 地名等 | `toggleProperName()` | — | 纯语义，外观由样式表决定 |
| 书名号 | 任意 | 书名标记 | `toggleBookTitle()` | — | 输出标记而非「《》」文字 |
| 圈点 | 任意 | 着重点 / 侧圈 | `toggleCircleEmphasis(style?)` | `circle-emphasis.style` | 取值：`circle`（缺省）/ `open-circle` / `dot` / `open-dot` / `double-circle` / `triangle` / `sesame` |
| 异体 | 任意 | 异体字标记 | `toggleVariant()` | — | 标记 ≠ 载体 |
| 注Ref | 任意 | 指向注文的引点 | `toggleNoteRef(noteId?)` | `note-ref.noteId`（**必填**） | 未补 `noteId` 则导出无锚点跳转 |
| 避讳 | 任意 | 避讳字标记 | `toggleTaboo()` | — | 标记 ≠ 载体 |
| 夹注 | 选中同段文字 / 空光标 | 包裹为 `inline-note`；空光标插空容器 | `toggleInlineNote()` | — | **跨段落静默不执行** |
| 异体载体 | 同上 | 包裹为 `variant-char` | `toggleVariantChar()` | — | 同上 |
| 避讳载体 | 同上 | 包裹为 `taboo-char` | `toggleTabooChar()` | — | 同上 |

### 3.5 插入与符号

| 按钮 | 前提 | 效果 / 落点 | 命令 | 属性补录 | 限制 |
| --- | --- | --- | --- | --- | --- |
| 双行注 | 光标在叶块内 | 当前叶块之后插入容器，光标进入 | `insertDoubleNote()` | — | 落点跟随最内层块 |
| 眉批 | 同上 | 插入 `head-note` | `insertHeadNote()` | — | 版心外落位由分页决定 |
| 校勘记 | 同上 | 插入 `collation-note` | `insertCollationNote()` | — | 与「出校符号」配合，需手动配对 |
| 出校符号 | 任意 | 光标处插入 ○ | `insertCollationSymbol()` | `collation-mark.symbol` | 渲染靠 `.bt-collation-mark::after` |
| 跋文 | 光标在叶块内 | 插入 `tail-note` | `insertTailNote()` | — | 节点无位置约束 |
| 牌记 | 同上 | 插入 `imprint` | `insertImprint()` | — | — |
| 题记 | 同上 | 插入 `colophon` | `insertColophon()` | — | — |
| 版框 | 同上 | 插入 `border-frame` | `insertBorderFrame()` | — | 边线样式由样式表控制 |
| 鱼尾 | 同上 | 插入 `fish-tail` | `insertFishTail()` | — | 无内容原子块，不可块内输入；`embedParagraph=false` 是必需的 |
| 印章 | 任意 | 光标处插入，弹窗录印文 | `insertSeal(text?)` | `seal.text` | 印文只在 `attrs`，靠 `.bt-seal::after` 显示；留空用「印章」占位 |
| 图片 | 任意 | 光标处插入，弹窗录地址 | `insertImage({ src, alt })` | `image.src` / `alt` | 留空用 1×1 占位图；外链不随 EPUB 打包 |
| 表格 | 光标在叶块内 | 当前叶块之后插入 3×3 | `insertTable(3, 3)` | 单元格内容 | 简化模型：无跨行 / 跨列 / 表头 |
| 脚注 | 同上 | 插入 `footnote` | `insertBlockOfType(footnote)` | — | 与正文靠「注Ref」手动配对 |
| 尾注 | 同上 | 插入 `endnote` | `insertBlockOfType(endnote)` | — | 导出按块顺序，不自动编号 |
| 边注 | 同上 | 插入 `margin-note` | `insertBlockOfType(margin-note)` | — | 直排 / 横排落位不同 |

### 3.6 右端工具

| 按钮 | 前提 | 效果 / 落点 | 实现 | 限制 |
| --- | --- | --- | --- | --- |
| 查找替换 | — | 展开 `ReplacePanel`，逐处选中并滚动 | `findTextMatches` / `selectRange` / `replaceSelectionWith` / `replaceAll` | 作用于 PM 文档，与阅读态 `SearchPanel` 互不影响 |
| 只读 | — | 切换只读 / 可编辑 | `emit('toggle-readonly')` | 视图层 `editable=false`，程序化事务仍可派发 |
| 还原样册 | 非只读 | 整篇文档重置为内置样册 | `emit('reset')` | 丢弃修改且不保留撤销栈 |

## 四、没有单独入口、但命令已具备的能力

这些命令在包内可用，工具条尚未暴露按钮（做「编辑设置」或属性面板时可以接）：

| 命令 | 作用 | 备注 |
| --- | --- | --- |
| `setHeadingLevel(4..6)` | 四~六级标题 | 工具条只到 H3 |
| `setBlockStyleId(styleId)` / `getBlockStyleId(state)` | 命名样式（`rawAttrs.styleId`） | 只对文本块生效，写入 `data-style-id` |
| `setNodeAttrs(typeName, patch)` | 改最近祖先节点属性 | 属性检视器地基 |
| `setMarkAttrs(markName, patch)` | 改选区内标记属性 | 值传 `null` 复位为 spec 默认 |
| `insertCodeBlock(language?)` | 代码块 | 无工具条入口 |
| `insertStructureBlock(typeName)` | 卷 / 章 / 节等结构容器 | 章后加章不嵌套 |
| `tableAddRow` / `tableAddColumn` / `tableDeleteRow` / `tableDeleteColumn` | 表格行列入删 | 光标须在单元格内，否则返回 `false` |
| `insertAtomicNode(typeName, attrs)` | 任意原子节点 | 内容由 `attrs` 承载 |

## 五、「点了没反应」速查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 点夹注 / 异体载体 / 避讳载体无反应 | 选区跨段落，`insertInlineNodeWrapping` 返回 `false` | 只选同一段内的文字 |
| 点删除线 / 行内代码无反应 | `requireSelection=true`，空光标不执行 | 先选中文字 |
| 点注Ref 后导出无跳转 | `noteId` 未补录（默认 `null`） | 右侧属性栏填 `noteId` |
| 插入印章 / 鱼尾后看不见 | 节点无文本子节点，全靠样式类渲染 | 确认 `book-css.ts` 有对应 `.bt-*` 规则 |
| 点引用 / 列表无反应 | schema 未注册该节点类型 | 检查编辑器 schema 装配 |
| 点正文后块的 `id` 变空 | 用了原生 `setBlockType`（1.25 起 `hasMarkup` 不再短路） | 统一走 `setBlockTypeKeepingId` |
| 表格行 / 列操作无反应 | 光标不在单元格内 | 先把光标放进单元格 |
