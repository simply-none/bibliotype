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
2. **块插入与选区替换是两条路**：工具条「插入空容器（段后）」**不消费选区**，容器类插在
   「当前叶块之后」、光标随即进入；原子类（印章 / 图片 / 出校符号）就地替换选区。**选中文字
   要变成注文 / 容器**，请用选区旁弹出的【替换为】菜单（见第六节），不要点插入行。
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
| 表格 | 光标在叶块内 | 当前叶块之后插入；先弹 Word / WPS 式行 × 列网格 | `insertTable(rows, cols)` | 单元格内容 | 网格默认 8×8，悬停高亮、点击即插；也可输入精确行列。简化模型：无跨行 / 跨列 / 表头；横排 / 直排均可插入 |
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
| 选中文字后没看到【替换为】 | 选区为空 / 只读 / 选中的是原子节点 / 刚被手动关闭 | 重新拖选文字、确认非只读；关闭后需改变选区才会再弹 |
| 点工具条「双行注」只在段后多了空容器 | 该按钮是「插入空容器（段后）」，不消费选区 | 选中文字改用【替换为】→ 双行注 |
| 插入表格后一片空白 | 旧版表格节点被兜底成嵌套 `div`（无表格布局），或分页把表格拆成单元格段落 | 升级后应渲染 `<table><tbody><tr><td>`；若仍空白，检查 schema 是否注册 `table` 与 `.bt-table-cell` 样式是否注入 |
| 直排下表格按钮置灰 / 表格不显示 | 旧限制已移除：表格是复合原子块，直排下同样可插入 | 确认工具条未额外禁用；直排空单元格靠 `min-inline-size` / `min-block-size` 保留面积 |

### 分页编辑态（paged）下的补充说明

上表是**命令契约**层面（连续画布与 paged 一致）。paged 态下 PM 整文档视图被 `v-show` 隐藏、编辑经片段桥
落模，另有三条交互层现象（均已修复，机制见 [14 FAQ 第 10 条](14-faq.md)）：

- **命令生效后会还原光标**：`BtEditor` 把透传给工具条的 `execute / undo / redo` 包了一层，命令落模后按模型
  选区把光标 / 焦点还原回片段。故「引用 / 列表 / 表格 / 边注 / 双行注 / 校勘记」等一次点击即生效且可直接输入，
  不再需要连点多次；前提仍是**先把光标放进片段**（`@mousedown.prevent` 保焦点，不会因点按钮丢选区）。
- **出校符号等就地插入类命令落点对齐光标**：命令前会同步 flush 一次片段选区到模型，避免 rAF 滞后导致「前后几个字符」的随机偏移。
- **点命令不再把视口莫名跳到前后几页**：paged 态跳过对隐藏 PM 视图的 `updateState`，命令事务的 `scrollIntoView`
  不再滚动隐藏视图的外层容器。若命令后光标落在当前渲染窗口之外（如插入的新块顺延到下一页），视口会
  **确定性地跟随光标**滚动到该页 —— 这是预期行为（跟随编辑位置），非随机跳页。
- **眉批 / 跋文插入落位**：命令契约是把容器插在「当前叶块之后」，paged 编辑态按块顺序成行显示；其在版心外
  （页眉 / 书末）的视觉落位属分页渲染的后续特性，当前未实现 —— 属已知限制，非回归。

## 六、选区替换为（浮动菜单）

选中文字后，选区旁自动弹出【替换为】菜单（去抖 120ms）；点击目标即把**选中文字搬进**该容器 / 块类型。
它与工具条「插入空容器（段后）」是两条独立路径：前者消费选区，后者不消费。完整目标表、文本前后
切分与 id 规则见 [20 选区替换为](20-selection-replace.md)。

| 分组 | 目标 |
| --- | --- |
| 块类型 | 正文 / H1 / H2 / H3 / 引用 / 无序 / 有序 |
| 块级容器 | 双行注 / 眉批 / 跋文 / 校勘记 / 牌记 / 题记 / 版框 / 脚注 / 尾注 / 边注 |
| 行内容器 | 夹注 / 异体字 / 避讳字（仅同段） |

- 跨章节选区：块级容器项置灰（命令返回 `false`）；
- 行内容器跨段：置灰并提示「仅同段选区」；
- paged 态：菜单经插槽 `slotBinding.execute` 执行，重排后按模型选区还原光标；
- 手动关闭（`Esc` / 点外部）后，同一选区不再自动弹；改变选区后恢复；
- 空选区时对应命令退化为「段后插入空容器」，与旧插入行为一致。

## 命名样式批量操作（C10）

- 工具条「样式」区按当前命名样式动态生成按钮：套用到**选区内所有文本块**；空光标只作用于当前块。
- 「清除格式」移除选区内的行内 marks（粗体 / 斜体 / 链接 / 注音等）与块上的命名样式，保留块结构、节点 id、对齐 / 角色等块级 attrs。
- 两者均为单事务、可撤销；无可改动内容时返回 `false`，按钮不产生空事务。
- 命名样式的「依据」在设置面板维护；删除样式会自动断开其他样式的依据引用。
