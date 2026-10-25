# @bibliotype/vue

Vue 3 封装：`useReader` / `useReaderBinding` / `useEditorBinding` 组合式 API，
`BtBookView` / `BtPager` / `BtToc` / `BtTocItem` / `BtSidebarResizer` / `BtEditor` / `BtSelectionReplaceMenu` /
`BtTableSizePicker` / `BtAnnotationSidebar` / `BtDocumentStats` / `BtNotePreview` / `BtThemePanel` /
`BtFontFallbackPanel` / `BtAnnotationSuggestions` / `BtGlyphAuditPanel` 组件，以及全局注册插件。

## 安装

```bash
pnpm add @bibliotype/vue vue
```

按需引入组件样式（书页 / 翻页条 / 目录的 scoped 样式产物）：

```ts
import '@bibliotype/vue/style.css';
```

## 快速上手

### 组合式 API

```vue
<script setup lang="ts">
import { useReader, BtBookView, BtPager } from '@bibliotype/vue';

const {
  reader,            // 底层 Reader 实例（命令式 API 原点）
  currentPage,       // Ref<number> 当前页（自 0 起）
  totalPages,        // Ref<number> 总页数
  progress,          // Ref<number> 阅读进度 0~1
  pageNumberText,    // ComputedRef<string> 当前页展示页码
  outline,           // ShallowRef<OutlineItem[]> 目录树
  next, prev, goToPage, goToNode, repaginate,
} = useReader(lunyuDocument);          // BookDocument → 新建并载入 Reader
                                       // 也可传 Reader 实例直接绑定，或省略后 loadDocument
</script>

<template>
  <BtBookView :reader="reader" fit="contain" />
  <BtPager :reader="reader" />
</template>
```

`useReader` 也可传入 `ref` / getter（如 `computed(() => document)`），文档变化时自动重载。

### 编辑器绑定

```ts
import { useEditorBinding } from '@bibliotype/vue';

const { attach, detach } = useEditorBinding(editor);   // editor: BookEditor
attach(element);   // 在容器上挂载 ProseMirror 视图（BtEditor 组件内部同此实现）
detach();          // 卸载视图
```

### 全局插件

```ts
import { createApp } from 'vue';
import { createBibliotype } from '@bibliotype/vue';

const app = createApp(App);
app.use(createBibliotype());   // 全局注册 BtBookView / BtPager / BtToc / BtEditor
```

> 注意：此处的 `createBibliotype` 是 **Vue 插件**；`@bibliotype/core` 的同名函数是核心实例工厂。

## 组件

| 组件 | Props | 说明 |
| --- | --- | --- |
| `BtBookView` | `reader`（必需）、`tokens?`、`fontToken?`、`fit?`（`width` / `contain` / `none`，默认 `contain`，仅 `page` 模式）、`fitScale?`（`page` / `scroll` 模式：外部指定的整页缩放倍率，PDF「适合宽度 / 高度」语义，允许 >1；另受横向安全阀约束（不超过容器可用宽/页宽），激活时预留 scrollbar-gutter 槽位，page 模式纵向溢出由本容器滚动承接、scroll 模式槽位宽 = 页宽 × 倍率；非法 / 未传回退 `fit`）、`mode?`（`page` 单页翻页 / `scroll` 连续滚动多页 / `scroll-flow` 流式阅读，默认 `page`）、`spread?`（`single` / `facing`，仅 `page` 生效；`facing` 翻页步长为 2）、`pageTransition?`（`none` / `slide` / `fade`，默认 `slide`）、`flowChunkBlocks?`、`flowRootMargin?`、`estimateFlowHeight?`、`initialPosition?`；emit `update:position` / `update:page` / `update:fontSize` / `mode-fallback` | 书籍页面渲染：IR → HTML（与导出器同源），注入书册样式表，页框等比缩放（ResizeObserver）。`scroll-flow` 模式按章分块、视口窗口懒挂载、骨架占位、锚点进度持久化（`initialPosition` / `update:position`）；直排 / 仿真 / 对页下自动回落 `page` 并 emit `mode-fallback`。`pageTransition` 控制翻页滑动 / 淡入动效，尊重系统「减少动态效果」 |
| `BtSpreadLayout` | `mode?`（`columns` / `facing`）、`gap?`、`leftLabel?` / `rightLabel?`；插槽 `left` / `right` | 双栏 / 对页纯布局容器：中缝分隔 + 可选标签，窄窗上下堆叠。`BtCompareView` 与 `BtCollationCompare` 共用此容器 |
| `BtCompareView` | `left`（必需 `Reader`）、`right?`（`Reader`，缺省退化对页）、`tokens?`、`fontToken?`、`fontSize?`、`features?`、`namedStyles?`、`labels?`、`syncPages?`、`mode?`、`fit?`、`pageTransition?`、`flowChunkBlocks?`、`initialPosition?`；emit `update:position` / `mode-fallback` | 双文稿对照：单文档 → 左右对页（主题 / 字体 / 功能样式与单页同源）；双文档 → 左右并排、各自独立翻页，`syncPages` 时双向同步（重入守卫 + 越界钳制），两侧位置经 `update:position` 汇总 |
| `BtPager` | `reader`、`step?`（翻页步长，默认 1；对页阅读传 2） | 上一页 / 下一页按钮 + 页码状态 |
| `BtToc` | `reader`、`expandedKeys?`（v-model）、`thumbnails?`、`showThumbnails?`、`searchPlaceholder?`、`emptyText?`、`showExpandControls?`；emit `select(item)` / `update:expandedKeys` | 目录面板：当前章高亮、折叠记忆、目录内搜索、缩略图占位、活动项滚入视野 |
| `BtTocItem` | `item`、`depth?`、`mode?`（`tree` / `row`）、`rowKey?`、`hasChildren?`、`expanded?`、`active?`、`matched?`、`query?`、`thumbnail?`、`showThumbnail?` | 目录项：`tree` 递归 / `row` 扁平行（由 `BtToc` 驱动） |
| `BtSidebarResizer` | `modelValue`（v-model）、`min?` / `max?` / `step?` / `defaultWidth?`、`side?`、`disabled?`；emit `update:modelValue` / `reset` / `dragstart` / `dragend` | 侧栏宽度拖拽条：拖拽 / 双击复位 / 方向键步进 / Home End，`role="separator"` + `aria-valuenow` |
| `BtNotePreview` | `preview`（`NotePreviewState \| null`） | 注文预览浮层（`placeFloating` 定位、`role="tooltip"`） |
| `BtThemePanel` | `tokens`、`baseTokens?`、`presets?`、`keepTokens?`、`title?`；emit `update:tokens` / `apply` / `export` / `import` | 主题预设卡片 + 导入导出 + 校验问题清单 |
| `BtFontFallbackPanel` | `text`、`families`、`probe?`、`maxChars?`、`title?` | 字体回退链逐字调试：命中族、缺字标红 + 码位 |
| `BtAnnotationSuggestions` | `suggestions`、`counts?`、`filter?`（v-model:filter）、`emptyText?`、`disabled?`；emit `accept(ids)` / `reject(ids)` / `commit(ids)` / `locate(item)` / `override(id, patch)` | 句读 / 专名建议审阅面板：类别筛选、逐条接受 / 拒绝、改标点 / 改类别、批量确认与「采纳为标点」 |
| `BtGlyphAuditPanel` | `issues`、`title?`、`maxItems?`（缺省 40）、`emptyText?` | 缺字审计面板：字符、码位、可合成 / 缺字、上下文与 IR 路径 |
| `BtEditor` | `editor`（`BookEditor`）、`tokens?`、`options?`、`fontToken?`、`pagination?`、`paginationMode?`、`pageMainSize?`、`measure?`、`editable?`、`loading?`、`scale?`、`initialPage?` | 编辑画布：挂载 / 卸载 ProseMirror 视图；`pagination` 开启后走自定义可编辑分页内核（真实书页盒 + 行级跨页续排 + 虚拟化；直排 / 多栏自动回退连续画布），片段输入经 `selection-bridge` 落成 `BookEditor` 事务；`loading` 遮罩首轮分页、`initialPage` 定位视口页、`editable=false` 只读 |
| `BtSelectionReplaceMenu` | `binding`（必需，传 BtEditor 插槽 `slotBinding`）、`groups`（`ReplaceTargetGroup[]`）、`readonly?`、`autoShow?` | 选区「替换为」浮动菜单：选中文字后定位弹出，按分组展示目标，点击经 `binding.execute` 执行；横排 / 直排通用，详见 [docs/20](../../docs/20-selection-replace.md) |
| `BtTableSizePicker` | `anchor`（触发器矩形）、`trigger?`、`maxRows?` / `maxCols?`（默认 8）、`rows?` / `cols?`（默认 3）；emit `select({ rows, cols })` / `close` | Word / WPS 式表格尺寸选择器：行 × 列网格悬停高亮、点击即插，另给精确行列输入；Teleport + `placeFloating` 定位，详见 [docs/21](../../docs/21-table-editing.md) |
| `BtAnnotationSidebar` | `model`（按章分组的标注）、`readonly?`；emit `locate` / `remove` / `resolve` / `reply` | 书签 / 高亮 / 笔记 / 评论侧栏：四个 tab 过滤、按章分组，点击定位由宿主执行；正文内高亮装饰不在本组件，详见 [docs/24](../../docs/24-annotation.md) |
| `BtDocumentStats` | `stats`、`compact?`、`selectable?`；emit `select-structure(nodeId)` | 状态栏统计：字数 / 块数 / 阅读时长 / 注释数 + 章节分布（纯 CSS 条形，无图表库），详见 [docs/30](../../docs/30-document-stats.md) |
| `BtBookShelf` | `cards`、`total?`、`facets?`、`activeTags?`、`search?`、`viewMode?`、`sortBy?`、`loading?`、`error?`、`emptyHint?`；emit `search` / `toggle-tag` / `sort` / `update:view` / `open` / `import` / `export` | 书架：网格 / 列表双视图、封面占位、进度条、标签筛选、检索，详见 [docs/06](../../docs/06-vue-integration.md#新增组件p2书架--备份--加密--修订--版本) |
| `BtBackupPanel` | `busy?`、`progress?`、`result?`、`strategy?`；emit `export` / `import` / `update:strategy` | 整库备份：三段式冲突策略 + 逐书进度 + 失败清单 |
| `BtEncryptionPanel` | `enabled?`、`unlocked?`、`notesLocked?`、`busy?`、`error?`、`redact?`；emit `enable` / `unlock` / `disable` / `toggle-notes` / `update:redact` | 开启 / 解锁 / 关闭加密、注记独立密钥、脱敏导出 |
| `BtRevisionSidebar` | `model`、`view?`、`enabled?`、`author?`；emit `set-mode` / `set-view` / `accept` / `reject` / `accept-all` / `reject-all` / `locate` | 修订侧栏：标记 / 终稿 / 原稿三视图、类型色条、单条与全部接受拒绝 |
| `BtVersionHistory` | `model`、`diffRows?`、`summaryText?`、`compareMode?`、`activeVersion?`、`busy?`、`error?`；emit `compare` / `restore` / `create` / `update:compare-mode` | 版本时间轴 + 左右 / 行内对比 + 一键回滚（校验由宿主执行） |

## API 概览

| 导出 | 说明 |
| --- | --- |
| `useReader(source?, options?)` | 创建或绑定 Reader 并转为响应式（`UseReaderReturn`） |
| `useReaderBinding(reader)` | 绑定既有 Reader（`ReaderBinding`） |
| `useEditorBinding(editor)` | 编辑器 DOM 视图绑定（`EditorBinding`，`attach` / `detach`） |
| `useSelectionReplace(binding, opts?)` | 选区「替换为」状态：`{ visible, anchor, close, refresh }`；去抖 120ms，优先用可见 DOM 选区定位 |
| `placeFloating(anchor, menu, viewport, gap?, edge?)` | 浮动菜单定位纯函数（上/下翻转、水平夹紧） |
| `measurePagination(input)` / `measureBlockSizes(input)` | 离屏量尺：块推进尺寸 + 每行字符偏移 + 真实行高 + 逐行行盒尺寸（注音行不等高；单栏横排 DOM 实测，其余回退估算）；`input.extracted` 可复用调用方已抽好的块序列，省一次全树遍历 |
| `buildPagedLayout(input)` / `usePagedLayout(opts)` | 编辑态分页内核：块抽取 → 量尺 → 分页 → 逐页片段（支持 `fromBlockId` 增量实测与 `targetBlockId` 定点实测） |
| `useAnnotations(opts)` | 选区建标注 + `AnnotationStorage` 编排 + 按章侧栏模型（`vue → annotation → core`） |
| `useDocumentStats({ document, revision?, debounceMs? })` | 300ms 防抖的 `countDocumentStats` 组合式 |
| `useTocView({ reader, expandedKeys?, onExpandedKeysChange?, query?, autoScroll? })` | 目录视图模型：活动项 / 折叠 / 搜索过滤 / 滚动入视（`attachContainer`） |
| `useNoteInteraction({ reader, onRequestPage?, highlightMs?, previewDelayMs? })` | 注释事件委托：跳转 / 回跳 / 双向高亮 / 预览 / `Alt+←/→` 上下条 |
| `useThemePresets({ base?, tokens?, onTokensChange?, catalog?, keep? })` | 主题预设应用 / 重置 / 导出 / 导入（问题进 `issues`） |
| `createFontCheckProbe(doc?)` / `splitFontFamilyList(stack)` | `document.fonts.check` → `GlyphProbe` 适配 / 拆分字体回退链 |
| `useAnnotationSuggestions({ document, revision?, apply, terms?, detector? })` | 句读 / 专名建议状态机：`all` / `pending` / `visible` / `counts` / `accept` / `reject` / `commitJudou` / `setOverride` / `reset`；命令由宿主注入（不把 ProseMirror 带进只读场景） |
| `useGlyphAudit({ document, families?, revision?, probe?, idsFor? })` | 缺字审计：`issues` / `summary` / `missingCount` / `idsCount` / `refresh`，探测缺省走 `document.fonts.check` |
| `usePrefersReducedMotion()` | 探测系统「减少动态效果」（`matchMedia` 缺失时回落 `false`，监听 `change`，`onScopeDispose` 清理） |
| `estimateFlowChunkHeight(chunk, metrics)` / `resolveMountWindow({ chunks, heights, offsets, scrollTop, viewportHeight, overscan? })` / `resolveAnchorChunkIndex(chunks, nodeId, options?)` / `adjustScrollOffset(prevHeights, nextHeights, scrollTop, anchorIndex)` | 流式阅读纯函数：高度估算 / 视口挂载窗口 / 锚点分块定位 / 上方高度变化滚动补偿，全部无 DOM 依赖 |
| `useBookLibrary({ store, codec?, now?, pageSize?, ... })` | 书架状态：查询 / 标签筛选 / 排序 / 视图、`openBook` / `exportBook` / `importBook`；`.btbook` 的 ZIP 由宿主经 `codec` 注入 |
| `buildShelfCards` / `buildTagFacets` / `buildRevisionModel` / `buildVersionHistoryModel` / `buildDiffRows` | 书架 / 修订 / 版本视图模型（纯函数，可单测） |
| `BtBookView` / `BtPager` / `BtToc` / `BtTocItem` / `BtSidebarResizer` / `BtEditor` / `BtSelectionReplaceMenu` / `BtTableSizePicker` / `BtAnnotationSidebar` / `BtDocumentStats` / `BtNotePreview` / `BtThemePanel` / `BtFontFallbackPanel` / `BtAnnotationSuggestions` / `BtGlyphAuditPanel` / `BtSpreadLayout` / `BtCompareView` / `BtBookShelf` / `BtBackupPanel` / `BtEncryptionPanel` / `BtRevisionSidebar` / `BtVersionHistory` / `PagedCanvas` | 组件 |
| `createBibliotype()` | Vue 插件（全局注册组件） |

在组件 / `effectScope` 内调用组合式 API 时，scope 销毁会自动解绑事件与视图。

### 古籍仿真直排

`BtBookView` 与 `PagedCanvas` 在布局带 `facsimile`（见 `@bibliotype/layout`）时自动：
开启 `buildBookCss` 的 `pageDecoration`（版框 / 界行图层），并按页注入
`reader.getPageGutterTexts()` 序列化出的版心（书口）。

未带 `facsimile` 的布局（现代横排 / 古籍直排）不传该开关，样式表与行为逐字符不变；
`BtEditor` 的连续画布刻意不开启装饰，避免绝对定位图层干扰点选。

## 相关

- 功能参考：[docs/06-vue-integration.md](../../docs/06-vue-integration.md)
- 阅读器：[`@bibliotype/reader`](../reader/README.md)
- 仓库主页：[bibliotype](../../README.md)
