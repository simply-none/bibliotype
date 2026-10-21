# @bibliotype/vue

Vue 3 封装：`useReader` / `useReaderBinding` / `useEditorBinding` 组合式 API，
`BtBookView` / `BtPager` / `BtToc` / `BtEditor` / `BtSelectionReplaceMenu` / `BtTableSizePicker` /
`BtAnnotationSidebar` / `BtDocumentStats` 组件，以及全局注册插件。

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
| `BtBookView` | `reader`（必需）、`tokens?`、`fontToken?`、`fit?`（`width` / `contain` / `none`，默认 `contain`，仅 `page` 模式）、`mode?`（`page` 单页翻页 / `scroll` 连续滚动多页，默认 `page`） | 书籍页面渲染：IR → HTML（与导出器同源），注入书册样式表，页框等比缩放（ResizeObserver）；封面页自动隐藏页码。`scroll` 模式把所有分页纵向拼接为可滚动容器（窗口化虚拟滚动：仅渲染视口附近页，滚动条仍反映全书总长），滚动时按可见页回写 `Reader` 页态，外部翻页（`BtPager` / 键盘 / 目录）则滚动定位到对应页 |
| `BtPager` | `reader` | 上一页 / 下一页按钮 + 页码状态 |
| `BtToc` | `reader`；emit `select(item)` | 目录树（点击节点跳页并上报） |
| `BtTocItem` | `item`、`depth?` | 递归目录项（供自定义目录结构复用） |
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
| `useBookLibrary({ store, codec?, now?, pageSize?, ... })` | 书架状态：查询 / 标签筛选 / 排序 / 视图、`openBook` / `exportBook` / `importBook`；`.btbook` 的 ZIP 由宿主经 `codec` 注入 |
| `buildShelfCards` / `buildTagFacets` / `buildRevisionModel` / `buildVersionHistoryModel` / `buildDiffRows` | 书架 / 修订 / 版本视图模型（纯函数，可单测） |
| `BtBookView` / `BtPager` / `BtToc` / `BtTocItem` / `BtEditor` / `BtSelectionReplaceMenu` / `BtTableSizePicker` / `BtAnnotationSidebar` / `BtDocumentStats` / `BtBookShelf` / `BtBackupPanel` / `BtEncryptionPanel` / `BtRevisionSidebar` / `BtVersionHistory` / `PagedCanvas` | 组件 |
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
