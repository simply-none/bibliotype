# 06 Vue 集成

> 涉及包：`@bibliotype/vue`　·　相关：[02 编辑器与插件](02-editor-and-plugins.md)、[04 阅读器与分页](04-reader-and-pagination.md)、[10 存储适配器](10-storage-adapters.md)

`@bibliotype/vue` 是阅读状态机与编辑核心的 **Vue 3 封装层**：组合式 API 将
`Reader` / `BookEditor`（均为无 DOM 状态机）桥接为响应式状态，组件负责 DOM 渲染。

## 安装与注册

```ts
import { createApp } from 'vue';
import { createBibliotype } from '@bibliotype/vue';
import '@bibliotype/vue/style.css';   // 组件样式

const app = createApp(App);
app.use(createBibliotype());          // 全局注册 BtBookView / BtPager / BtToc / BtEditor
```

也可按需导入组件：`import { BtBookView } from '@bibliotype/vue'`。

## useReader —— 创建并绑定

```ts
import { useReader } from '@bibliotype/vue';

/* 形态 1：传入文档，新建 Reader 并自动载入 */
const { currentPage, totalPages, pageNodes, next, goToNode } = useReader(document, {
  layout: CLASSICAL_LAYOUT_OPTIONS,
});

/* 形态 2：传入既有 Reader，仅做响应式绑定（不重复载入） */
const binding = useReader(existingReader);

/* 形态 3：省略 source，新建空 Reader，待后续 loadDocument */
const reader = useReader();
reader.loadDocument(document);

/* 形态 4：ref / getter 作为 source —— 监听变化自动重载 */
const docRef = ref(document);
useReader(docRef);
```

`useReader` 返回 `UseReaderReturn = ReaderBinding + loadDocument`。

### ReaderBinding 成员

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `reader` | `Reader` | 命令式 API 原点 |
| `currentPage` / `totalPages` / `progress` | `Ref<number>` | 当前页 / 总页数 / 进度 |
| `layout` | `ShallowRef<LayoutOptions>` | 当前布局（重排后更新引用） |
| `outline` | `ShallowRef<readonly OutlineItem[]>` | 目录树 |
| `activeOutlineItem` / `activeOutlineKey` | `ComputedRef<OutlineItem \| undefined>` / `ComputedRef<string \| undefined>` | 当前页对应目录项及其定位键（无目录 / 封面页前为 `undefined`） |
| `pageNodes` | `ComputedRef<readonly BookNode[]>` | 当前页 IR 节点 |
| `pageNumberText` | `ComputedRef<string>` | 当前页展示页码（无页时为空串） |
| `next` / `prev` / `goToPage` / `goToNode` | `() => boolean` | 导航（返回是否生效） |
| `repaginate` | `(overrides?) => void` | 重排 |

`useReaderBinding(reader)` 只绑定不创建，可在任意组件内对同一 Reader 多次调用
（组件 / effectScope 销毁时自动解绑事件）。

## 组件

| 组件 | props | 说明 |
| --- | --- | --- |
| `BtBookView` | `reader: Reader`、`tokens?`、`fontToken?`、`fit?: 'width' \| 'contain' \| 'none'`（默认 `contain`，仅 `page` 模式）、`mode?: 'page' \| 'scroll'`（默认 `page`）、`ariaLabel?` | 书页视图：IR → HTML（与导出器同源序列化）、注入书册样式表、页脚页码（封面页自动隐藏）。`page` 一次渲染当前页并按容器等比缩放；`scroll` 连续滚动多页（滚动 ↔ 页态双向同步）。`page` 模式下内置**键盘翻页**（←→ ↑↓ PageUp/PageDown 空格 Home/End，带修饰键的组合不拦截）、**触屏滑动**（横排左滑下一 页、直排右滑下一页）、`role="document"` + `tabindex="0"` + `aria-live` 页码播报 |
| `BtPager` | `reader: Reader` | 翻页控件：上一页 / 页码 / 下一页；`role="group"` + `aria-label`、页码区 `aria-live="polite"` |
| `BtToc` | `reader: Reader`、`expandedKeys?`（受控折叠集合，配 `update:expandedKeys`）、`thumbnails?`、`showThumbnails?`、`searchPlaceholder?`、`emptyText?`、`showExpandControls?`；emit `select(item)` / `update:expandedKeys` | 目录面板：当前章高亮 + `aria-current`、折叠记忆、目录内搜索（过滤 + 命中高亮 + 自动展开父级）、可选缩略图（缺省首字占位）、可视区滚动定位；点击经 `goToNode` 跳页 |
| `BtTocItem` | `item: OutlineItem`、`depth?`、`mode?: 'tree' \| 'row'`、`rowKey?`、`hasChildren?`、`expanded?`、`active?`、`matched?`、`query?`、`thumbnail?`、`showThumbnail?`；emit `select` / `toggle` | 单个目录项：`tree` 模式递归（旧行为），`row` 模式由 `BtToc` 驱动的扁平行 |
| `BtEditor` | `editor: BookEditor`、`tokens?`、`options?`、`fontToken?`、`pagination?`、`paginationMode?`、`pageMainSize?`、`measure?`、`editable?`、`loading?`、`scale?`、`initialPage?`；emit `update:visiblePage` | 编辑画布；默认插槽作用域透传 `EditorBinding`。`pagination` 开启后走自定义可编辑分页内核（`PagedCanvas` 真实书页盒 + 行级跨页续排 + 虚拟化，直排 / 多栏自动回退连续画布），可编辑桥经 `selection-bridge` 把片段输入落成 `BookEditor` 事务；`loading` 在首轮分页就绪前以遮罩挡住未分页内容，`initialPage` 首轮分页后定位（阅读页 ↔ 编辑视口页位置记忆），`editable=false` 只读。**`scale`（缺省 1，限幅 0.2~2）对连续与分页两种模式均生效**：分页下作为用户倍率覆盖 `PagedCanvas` 的「按容器宽自适应且限 ≤1」，允许放大到 100% 以上（页宽超出容器走横向滚动）；不传 `scale` 时分页仍按容器宽自适应 |
| `BtSelectionReplaceMenu` | `binding: EditorBinding`（传插槽 `slotBinding`）、`groups: ReplaceTargetGroup[]`、`readonly?`、`autoShow?`（默认 `true`） | 选区「替换为」浮动菜单：选中文字后在选区旁弹出，点击目标经 `binding.execute` 执行；Teleport 到 body + fixed 定位，横排 / 直排通用。详见 [20 选区替换为](20-selection-replace.md) |
| `BtTableSizePicker` | `anchor: FloatingRect`、`trigger?: HTMLElement`、`maxRows?` / `maxCols?`（默认 8）、`rows?` / `cols?`（默认 3）；emit `select({ rows, cols })` / `close` | Word / WPS 式表格尺寸选择器：行 × 列网格悬停高亮、点击即插，另给精确行列输入；Teleport + `placeFloating` 定位。详见 [21 表格编辑](21-table-editing.md) |

### 编辑保存链路

编辑态本身不做持久化——落盘策略由使用方决定。要点（完整实现见
[`apps/demo/src/composables/use-draft-autosave.ts`](../apps/demo/src/composables/use-draft-autosave.ts)）：

| 环节 | 做法 | 原因 |
| --- | --- | --- |
| 变更感知 | `editor.onChange(...)` + `editor.isDirty` | 广播快照是共享 IR（只读），逐键事务零全量转换 |
| 快照 | `editor.getSharedDocument()` | O(变更子树)；`getDocument()` 是 O(全文档)，只用于低频导出 |
| 调度 | 节流合并 + 空闲时段 + 单飞去重 | 整本 `put` 是几十毫秒级主线程任务，不能落在输入帧上 |
| 基准 | 快照与 `markSaved()` 同一同步帧 | 否则 await 期间的新编辑会被误标为「已保存」 |
| 兜底 | 转后台 / `Ctrl`(`Cmd`)+`S` / 卸载前 `flush` | 长句连续输入与关页面场景不丢内容 |

> 详情与实测口径：[02 编辑器与插件](02-editor-and-plugins.md) 快照口径、
> [10 存储适配器](10-storage-adapters.md) 保存策略、[14 常见问题](14-faq.md) 第 6 条。

### 阅读器组合示例

```vue
<script setup lang="ts">
import { useReader, BtBookView, BtPager, BtToc } from '@bibliotype/vue';

const { reader, loadDocument } = useReader();
loadDocument(bookDocument);
</script>

<template>
  <div class="reader-layout">
    <BtToc :reader="reader" @select="(item) => console.log(item.title)" />
    <BtBookView :reader="reader" fit="contain" />
    <BtPager :reader="reader" />
  </div>
</template>
```

想要连续滚动翻页（滚轮 / 触控板即翻页，同时保留按钮与键盘），将 `mode` 设为 `scroll`：

```vue
<template>
  <BtBookView :reader="reader" mode="scroll" />
  <BtPager :reader="reader" />
</template>
```

> `scroll` 采用窗口化虚拟滚动：各分页等高，按页步长精确推算总高与页位，仅序列化 / 挂载视口附近的页（含上下各 2 页缓冲），滚动条仍反映全书总长度，因此大部头书籍不会一次性渲染全部分页。

## useEditorBinding —— 编辑视图生命周期

```ts
import { ref } from 'vue';
import { BookEditor, createBookEditorPlugins, toggleMarkOfType, undoCommand } from '@bibliotype/editor';
import { useEditorBinding } from '@bibliotype/vue';
import { buildClassicalEditorSchema } from '@bibliotype/classical/editor';

const schema = buildClassicalEditorSchema();
const editor = new BookEditor({ schema, plugins: createBookEditorPlugins(schema), document: doc });

const {
  view, version,
  attach, detach, execute, refresh,
  isMarkActive, isNodeActive, canUndo, canRedo, undo, redo,
} = useEditorBinding(editor);

attach(canvasElement);                         // 创建 ProseMirror EditorView
execute(toggleMarkOfType(schema.marks.strong!)); // 命令统一入口（事务桥接）
isMarkActive('strong');                         // 响应式激活态（依赖 version）
refresh();                                      // 外部 loadDocument 后同步视图
```

| 成员 | 说明 |
| --- | --- |
| `view` | `ShallowRef<EditorView \| null>`（挂载前为 null） |
| `version` | 状态版本计数（事务派发后自增，驱动激活态重算） |
| `attach` / `detach` | 挂载 / 销毁编辑视图（重复挂载先卸载旧视图；scope 销毁自动 detach） |
| `isMarkActive` / `isNodeActive` | 选区激活态（`isNodeActive` 可按属性过滤） |
| `canUndo` / `canRedo` / `undo` / `redo` | 撤销 / 重做 |
| `execute` | 执行任意 `Command`（返回是否生效） |
| `useSelectionReplace(binding, { autoShow?, readonly?, showDelay? })` | 选区替换菜单状态：`{ visible, anchor, close, refresh }`；去抖 120ms，优先用可见 DOM 选区定位 |
| `placeFloating(anchor, menu, viewport, gap?, edge?)` | 浮动菜单定位纯函数：上/下翻转、水平夹紧 |

`BtEditor` 内部即用本组合式函数，并把 `EditorBinding` 通过插槽作用域透传给工具条：

```vue
<BtEditor :editor="editor">
  <template #default="binding">
    <button :disabled="!binding.canUndo()" @click="binding.undo()">撤销</button>
    <button @click="binding.execute(toggleProperName())">专名号</button>
  </template>
</BtEditor>
```

配合 `BtSelectionReplaceMenu` 即可获得选中文字后的【替换为】菜单。**`binding` 必须传插槽作用域这一份**
（`BtEditor` 已把 `execute` 包成 paged 感知：先 flush 选区 → 执行 → 重排后还原光标）：

```vue
<template>
  <BtEditor :editor="editor">
    <template #default="binding">
      <EditorToolbar :binding="binding" />
      <BtSelectionReplaceMenu
        :binding="binding"
        :groups="REPLACE_TARGET_GROUPS"
        :readonly="readonly"
      />
    </template>
  </BtEditor>
</template>
```

## 注意

- `useReader` / `useEditorBinding` 在组件或 `effectScope` 内调用时自动清理（解绑事件 / detach 视图）；
  在组件外调用则需自行管理生命周期；
- `useEditorBinding` 会 `markRaw(toRaw(editor))`，保证绑定实例与调用方持有的是同一对象；
- `BtBookView` 注入的书册样式表以 `#bt-book-css` 单例挂载，多实例共享、以最后写入为准；
- `BtBookView` 在 `setup` 时用 `useReaderBinding(props.reader)` **一次性绑定** Reader，
  因此**替换 `reader` prop 需要配合 `:key` 重新挂载**（否则页内容按新 Reader 渲染、
  样式表仍停在旧布局）。切换主题 / 布局重建 Reader 的场景请照此处理，
  见 demo 的 `:key="themeKey + '-' + readerEpoch"`；
- 古籍仿真直排的装饰图层（`pageDecoration`）由 `BtBookView` / `PagedCanvas` 依据
  `layout.facsimile` 自动开启，`BtEditor` 连续画布刻意不开（避免绝对定位图层干扰点选）。

## 相关

- 包参考：[`@bibliotype/vue`](../packages/vue/README.md)
- 编辑核心与命令：[02 编辑器与插件](02-editor-and-plugins.md)
- 示例应用：[apps/demo](../apps/demo/README.md)

## 新增组件（P0）

| 组件 / 组合式 | 用途 | 关键 props / 事件 |
| --- | --- | --- |
| `BtAnnotationSidebar` | 书签 / 高亮 / 笔记 / 评论侧栏 | `model`（按章分组）、`readonly`；emit `locate` / `remove` / `resolve` / `reply` |
| `useAnnotations` | 选区建标注 + 存储编排 + 侧栏模型 | `{ bookId, document, store, getSelectionAnchor, locate, author?, clock? }`；返回 `annotations` / `model` / `create` / `remove` / `resolveComment` / `reply` |
| `BtDocumentStats` | 状态栏统计 | `stats`、`compact`、`selectable`；emit `select-structure` |
| `useDocumentStats` | 300ms 防抖统计 | `{ document, revision?, debounceMs?, options? }` |

`BtBookView` 新增 `fontSize` prop 与 `update:fontSize` 事件：page 模式双指缩放上抛字号（12–32px 夹紧），重排由宿主负责；scroll 模式容器可聚焦，PageUp / PageDown / 空格 / Home / End 滚动一屏。

`BtBookView` 另新增 `spread="single" | "facing"`：facing 下 page 模式并排渲染相邻两页（偶数页在左），缩放按双页宽计算；scroll 模式不受影响。

## 新增组件（P2）：书架 / 备份 / 加密 / 修订 / 版本

五个组件都是**纯展示**：状态与 IO 在组合式函数或宿主，组件只发语义事件。

| 组件 | 用途 | props | 事件 |
| --- | --- | --- | --- |
| `BtBookShelf` | 书架：网格 / 列表双视图、封面占位、进度条、标签筛选、检索 | `cards`、`total?`、`facets?`、`activeTags?`、`search?`、`viewMode?`（`grid` / `list`）、`sortBy?`（`recentRead` / `updated` / `title` / `wordCount`）、`loading?`、`error?`、`emptyHint?` | `search` / `toggle-tag` / `sort` / `update:view` / `open` / `import(bytes)` / `export(id)` |
| `BtBackupPanel` | 整库备份：三段式冲突策略 + 常驻后果说明 + 逐书进度 + 失败清单 | `busy?`、`progress?`（`{ current, total, title }`）、`result?`、`strategy?` | `export` / `import({ bytes, strategy })` / `update:strategy` |
| `BtEncryptionPanel` | 开启 / 解锁 / 关闭正文加密、注记独立密钥、脱敏导出 | `enabled?`、`unlocked?`、`notesLocked?`、`busy?`、`error?`、`redact?` | `enable(password)` / `unlock(password)` / `disable` / `toggle-notes(locked)` / `update:redact` |
| `BtRevisionSidebar` | 修订侧栏：三段视图切换、类型色条、单条 / 全部接受拒绝 | `model`、`view?`、`enabled?`、`author?` | `set-mode` / `set-view` / `accept(changeId)` / `reject(changeId)` / `accept-all` / `reject-all` / `locate(path)` |
| `BtVersionHistory` | 版本时间轴（今日 / 昨日 / 更早）+ 左右 / 行内对比 + 一键回滚 | `model`、`diffRows?`、`summaryText?`、`compareMode?`、`activeVersion?`、`busy?`、`error?` | `compare(version)` / `restore(version)` / `create(label)` / `update:compare-mode` |

配套组合式 / 纯函数模型：

| 导出 | 说明 |
| --- | --- |
| `useBookLibrary({ store, codec?, now?, pageSize?, collectAssets?, loadAnnotations?, saveAnnotations? })` | 书架状态：`cards` / `summaries` / `total` / `facets` / 检索 / 标签 / 排序 / 视图、`refresh` / `openBook` / `exportBook` / `importBook` / `removeBook`；查询走 `BookLibraryStore`，未实现时退化为 `list()` + 纯函数过滤 |
| `buildShelfCards` / `buildTagFacets` / `formatRelativeTime` / `formatWordCount` / `titleGlyph` | 卡片视图模型（进度夹紧、字数缩写、书脊占位字形），纯函数可单测 |
| `buildRevisionModel` / `revisionCountsText` / `excerptText` | 修订侧栏模型（按类型 / 作者分组、摘要截断），入参为 `collectRevisions` 的条目 |
| `buildVersionHistoryModel` / `buildDiffRows` / `diffSummaryText` / `versionGroupOf` | 版本时间轴与差异行模型（`+2 −1 ~3` 计数、行内 / 左右两用的行序） |

```ts
import { useBookLibrary, BtBookShelf } from '@bibliotype/vue';
import { IndexedDbAdapter } from '@bibliotype/adapter-indexeddb';

const lib = useBookLibrary({ store: new IndexedDbAdapter(), codec: zipCodec });
await lib.refresh();
```

```vue
<BtBookShelf
  :cards="lib.cards.value"
  :total="lib.total.value"
  :facets="lib.facets.value"
  :search="lib.search.value"
  :view-mode="lib.viewMode.value"
  @search="lib.setSearch"
  @toggle-tag="lib.toggleTag"
  @sort="lib.setSort"
  @open="lib.openBook"
  @import="lib.importBook"
  @export="lib.exportBook"
/>
```

接线约定：

- `.btbook` 的 ZIP 能力必须由宿主注入（`BookPackCodec`），`@bibliotype/vue` 不引压缩库；
- 回滚按钮只发 `restore` 事件，**校验与写库由宿主调 `restoreSnapshot` 完成**，失败原因经 `error` 就地显示；
- 修订侧栏的 `model` 由 `collectRevisions(document)` 经 `buildRevisionModel` 产出，`locate` 的 `path` 是 IR 节点路径，宿主据此滚动定位。

## 新增组件（P3）：目录增强 / 注释交互 / 主题市场

三项能力的共同约定：**库内不写存储、不下载文件、不引新依赖**——状态经 props / v-model 进出，持久化与文件 IO 由宿主完成。

### 目录增强（D6）

| 导出 | 用途 | 关键参数 / 事件 |
| --- | --- | --- |
| `BtToc` | 目录面板 | 见上表；另支持搜索框（`searchPlaceholder` 传空串可隐藏）与「全部展开 / 收起」 |
| `BtSidebarResizer` | 侧栏宽度拖拽条 | `modelValue`（v-model）、`min` / `max` / `step` / `defaultWidth`、`side?: 'start' \| 'end'`、`disabled?`；emit `update:modelValue` / `reset` / `dragstart` / `dragend` |
| `useTocView({ reader, expandedKeys?, onExpandedKeysChange?, query?, autoScroll? })` | 目录视图模型：活动项、折叠、过滤、滚动入视 | 返回 `rows` / `isEmpty` / `expandedKeys` / `toggle` / `expandAll` / `collapseAll` / `setQuery` / `attachContainer` |
| `buildTocViewItems(outline, options)` / `toggleTocExpanded(...)` / `splitTocTitle(title, query)` | 纯函数内核（扁平行、折叠集合、命中片段） | 可直接单测，不依赖 DOM |

要点：

- 活动项来自 `reader.getOutlineItemAtPage(page)`（复用 `pageByBlockId` 索引），**不做标题字符串匹配**；
- 折叠集合受控时**以宿主为准**：用户手动收起的章节不会因为翻页被自动摊开；搜索时父级强制展开；
- 滚动定位用 `TOC_ROW_KEY_ATTRIBUTE`（`data-toc-key`）查行，`scrollIntoView` 缺失时静默跳过；
- 缩略图由 `thumbnails` 映射传入（图片 / dataURL），缺省渲染首字骨架，不内置截图。

```vue
<BtSidebarResizer v-model="tocWidth" side="start" @reset="resetTocWidth" />
<BtToc :reader="reader" v-model:expanded-keys="expandedKeys" />
```

### 注释交互（D9）

| 导出 | 用途 | 关键参数 |
| --- | --- | --- |
| `useNoteInteraction({ reader, onRequestPage?, highlightMs?, previewDelayMs?, previewHideMs? })` | 事件委托 + 跳转 / 回跳 / 双向高亮 / 预览 / 上下条 | 返回 `preview` / `activeNoteId` / `attach` / `onClick` / `onPointerOver` / `onPointerOut` / `onFocusIn` / `onFocusOut` / `handleKeydown` / `goToNote` / `goToRef` / `stepNote` / `closePreview` |
| `BtNotePreview` | 注文预览浮层（`placeFloating` 定位、`role="tooltip"`） | `preview: NotePreviewState \| null` |
| `NOTE_ACTIVE_CLASS` | 激活态类名（`bt-note-active`，样式在书册 CSS 内） | 测试与自定义高亮时长可复用 |

`BtBookView` 的接线（无需宿主配置）：

- 页容器上委托 `click` / `pointerover` / `pointerout` / `focusin` / `focusout`，**page 与 scroll 两种模式都生效**；
- `Alt + ←/→` 在文档全部注释间循环切换（跨页自动翻页）；`Esc` 关闭预览；
- 高亮：注条与正文注码同时加 `bt-note-active`，2s 后自动褪去；翻页收起预览。

```ts
const note = useNoteInteraction({ reader });
// 自定义容器（非 BtBookView 场景）：
note.attach(rootElement);
```

### 主题与外观（D10）

| 导出 | 用途 | 关键参数 / 事件 |
| --- | --- | --- |
| `BtThemePanel` | 主题预设卡片 + 导入导出 + 问题清单 | `tokens`、`baseTokens?`、`presets?`、`keepTokens?`、`title?`；emit `update:tokens` / `apply` / `export` / `import` |
| `BtFontFallbackPanel` | 字体回退链逐字调试（缺字标红 + 码位） | `text`、`families`、`probe?`、`maxChars?`、`title?` |
| `useThemePresets({ base?, tokens?, onTokensChange?, catalog?, presets?, keep? })` | 预设应用 / 重置 / 导入导出状态 | 返回 `presets` / `activeId` / `issues` / `applyPreset` / `resetTheme` / `exportJson` / `importJson` / `clearIssues` |
| `createFontCheckProbe(doc?)` / `splitFontFamilyList(stack)` | `document.fonts.check` 适配 GlyphProbe / 拆分字体回退链 | 环境不支持时降级为「全部命中」 |

要点：

- `applyPreset` 默认保留排版令牌（`TYPOGRAPHY_THEME_TOKENS`），切换主题不会覆盖用户自定义字号；
- `importJson` 是**全量应用**（含排版令牌），保证「导出 → 导入」视觉一致；非法主题包把中文 issue 写进 `issues`；
- 主题包只含令牌，`StylePreset` 的 layout / features / namedStyles 与之互不覆盖（详见 [11 主题令牌](11-theme-tokens.md)）。

### 句读 / 专名审阅与缺字审计（K3 / K6）

| 导出 | 用途 | 关键参数 / 返回值 |
| --- | --- | --- |
| `useAnnotationSuggestions({ document, revision?, apply, terms?, detector?, autoRefresh? })` | 建议状态机（待处理 / 已接受 / 已拒绝 / 已落地） | `all` / `pending` / `visible` / `counts` / `decisions` / `filter` / `accept` / `reject` / `commitJudou` / `setOverride` / `reset` |
| `BtAnnotationSuggestions` | 审阅面板 | `suggestions` / `counts` / `filter`（v-model）、`disabled`；emit `accept` / `reject` / `commit` / `locate` / `override` |
| `useGlyphAudit({ document, families?, revision?, probe?, idsFor? })` | 缺字审计 | `issues` / `summary` / `missingCount` / `idsCount` / `refresh` |
| `BtGlyphAuditPanel` | 缺字清单 | `issues` / `maxItems`；逐条显示字符、码位、可合成 / 缺字、上下文与 IR 路径 |

要点：

- **命令由宿主注入**：`vue` 只从 `classical/editor` 做 `import type`（构建后擦除，运行时零依赖），
  只读阅读场景不加载 ProseMirror；
  demo 用 `applyJudouSuggestions` / `applyProperNameSuggestions` / `removeSuggestionMarks` /
  `commitJudouAsText` 包装成 `SuggestionApplyHandlers` 传入；
- 接受建议落 `judou` / `proper-name` 标记（`source=auto`），**正文字符不变**；
  「采纳为标点」把已接受的句读标记落成真实字符并移除标记，整批单事务、可一次撤销；
- 全部拒绝后文档逐字节不变（建议只是内存态）；
- `useGlyphAudit` 默认探测走 `document.fonts.check`，环境不支持时降级为全部命中。

```ts
const suggestions = useAnnotationSuggestions({
  document: () => editor.getDocument(),
  revision: editorVersion,
  apply: {
    judou: (items) => editor.command(applyJudouSuggestions(items)),
    properName: (items) => editor.command(applyProperNameSuggestions(items)),
    remove: (options) => editor.command(removeSuggestionMarks(options)),
    commitJudou: (options) => editor.command(commitJudouAsText(options)),
  },
});
```

## 多形态阅读（D5）：`scroll-flow` / 翻页动效 / 双页对照

### `BtBookView` 新增能力

| 维度 | 说明 |
| --- | --- |
| `mode` | 扩展为 `'page' \| 'scroll' \| 'scroll-flow'`；`scroll-flow` 仅横排流式，直排 / 仿真 / `spread='facing'` 下自动回落 `page` 并 emit `mode-fallback` |
| `pageTransition` | `'none' \| 'slide' \| 'fade'`（默认 `slide`）：横排滑动 / 直排方向自适应；尊重系统「减少动态效果」与显式 `none` |
| `initialPosition` | `ReadingPosition \| string`：首帧解析后强制挂载目标分块并滚到锚点（刷新 / 改字号后回到原句） |
| `flowChunkBlocks` / `flowRootMargin` / `estimateFlowHeight` | 流式分块上限 / 挂载预取边距 / 高度估算覆盖 |
| emits | `update:position`（锚点 + 进度，宿主持久化）、`update:page`（页码变化，容器同步用）、`update:fontSize`、`mode-fallback` |

流式分支按 `data-flow-key` 渲染分块：已挂载分块 `v-html` 逐块序列化（`serializeNode` 开启 `anchorIds`），未挂载分块渲染估算高度骨架占位（`aria-hidden`）。滚动以 rAF 节流，按视口位置经 `resolveMountWindow` 计算挂载窗口（`flowRootMargin` 控制预取余量）、取视口首块经 `reader.getPositionForNode` 回写 `update:position`；`ResizeObserver` 实测高度并做滚动补偿。

### `BtSpreadLayout`（双栏 / 对页纯布局容器）

props：`mode`（`columns` / `facing`）、`gap`、`leftLabel` / `rightLabel`；插槽 `left` / `right`。中缝分隔 + 可选标签，窄窗（`<720px`）上下堆叠。`BtCompareView` 与 `BtCollationCompare` 共用此容器，中缝 / 比例 / 响应式规则只有一套实现。

### `BtCompareView`（双文稿对照）

- 仅传 `left`：退化为单文档 `spread='facing'` 对页阅读；
- 传 `right`：左右并排各一份 `BtBookView`（`mode='columns'`），可独立翻页；`syncPages` 开启时**双向页码同步**（重入守卫 + 越界钳制）；
- 两侧位置经 `update:position` 汇总（`side: 'left' \| 'right'`），宿主持久化可分别保存。

### 翻页动效降级规则

- 默认 `slide`：横排新页自右向左滑入 12% + 透明度 0.6→1，约 220ms；直排改为自下而上；
- `fade`：仅透明度；`none` / 系统「减少动态效果」：完全瞬时切换（过渡 `none`）；
- 过渡只加在页框外层，**不改变 `serializeNode` 产物与导出 HTML**。

## H5 移动端（批 A–D）

窄屏（`< 768px`）不是「把桌面压小」，而是换一套骨架：三栏 chrome 收进抽屉，阅读区满屏，
工具条按组折叠。桌面默认值一律不动——H5 规则全部是增量（`@media` / 运行时分支）。

### 断点与触控常量（D1 / D2）

| 导出 | 值 | 用途 |
| --- | --- | --- |
| `BT_BREAKPOINTS` | `{ sm: 640, md: 768, lg: 1024 }` | 分档阈值（单一事实源） |
| `BT_TOUCH_TARGET_MIN` | `44` | 粗指针下的点击区下限（px） |
| `resolveBreakpointName(width)` | `'mobile' \| 'tablet' \| 'desktop'` | 纯函数分档 |
| `useBreakpoint()` | 见下 | 视口 / 指针 / 朝向 |

`useBreakpoint()` 返回 `width` / `height` / `name` / `isMobile` / `isTablet` / `isDesktop` /
`coarsePointer` / `portrait` / `revision`。首帧固定桌面口径（1024×768、细指针、横屏），
`onMounted` 后同步真实视口，之后由 `resize` / `orientationchange` 与媒体查询驱动；
`revision` 在尺寸或朝向真实变化时自增，宿主可 `watch(revision)` 触发重排（D7）。
测试可注入 `host`（`innerWidth` / `innerHeight` / `matchMedia` / `addEventListener` / rAF）。

CSS 侧同源变量：`--bt-bp-sm|md|lg`、`--bt-touch-target: 44px`、
`--bt-safe-top|right|bottom|left: env(safe-area-inset-*, 0px)`。
**两边必须同步改**：`@media (max-width: 767px)` 与 `breakpoint.isMobile` 表达同一件事。

### useScrollLock（D5）

浮层打开时锁 body，避免 iOS 橡皮筋把 fixed 定位顶偏。计数锁是**模块级共享**的：多个浮层
叠加只锁一次、全部关闭才还原（若放实例内，先关的那个会把自己那份「无锁」快照写回去，
直接拆掉后关那本的锁）。快照原 inline 样式，解锁时原样写回并恢复 `scrollY`；
作用域销毁自动解锁。

### BtDrawer（A4 / C1 / D5）

统一抽屉容器，`Teleport` 到 body：遮罩 + 侧滑面板 + 锁滚 + Esc / 遮罩关闭。

| prop | 说明 |
| --- | --- |
| `open` / `update:open` | 受控开关（`v-model:open`） |
| `side` | `'start'`（目录）/ `'end'`（标注等）/ `'bottom'`（sheet） |
| `title` / `ariaLabel` | 标题栏与无障碍名称（缺省回退 `title`） |
| `width` / `height` | 面板尺寸（CSS 长度） |
| `snapHeights` | 底部 sheet 的高度档位（如 `['48vh', '92vh']`），给后出现拖拽把手 |
| `maskClosable` / `edgeSwipe` | 遮罩关闭 / 关闭态边缘手势呼出（默认都开） |

语义钩子：根 `.bt-drawer[data-side][data-open]`、面板 `role="dialog" aria-modal="true"`、
把手 `role="separator" [data-snap]`。`snapHeights` 拖拽中跟手，松手吸附最近档位，
关闭复位到第一档。Esc 与触摸手势分开绑定：打开态只挂键盘，关闭态只挂边缘手势。

### BtBookView（A2 / A3）

- 点按分区：左右各 20% 边缘翻页，中部 emit `tap-center`（宿主据此呼出 / 收起 chrome）；
  有选区、刚完成滑动（350ms 内）、点中链接 / 表单控件时不分区；
- 滑动翻页：横向位移 ≥ 50px（或 ≥ 24px 且时长 < 300ms 的轻扫）才触发，纵向位移更大时
  让位给滚动；直排方向取反；
- 双指缩放：emit `update:fontSize`，区间 12–32px。

### 其他组件增量

| 组件 | H5 增量 |
| --- | --- |
| `BtNotePreview` / `useNoteInteraction` | 触屏点按切换预览、点外部关闭；桌面保持 hover |
| `BtSelectionReplaceMenu` | 触摸选区重算落点，防溢出翻转，滚动 / 失焦关闭 |
| `BtTableSizePicker` | 网格触点补到 44px（视觉尺寸不变） |
| `BtEditor` / `useKeyboardInset` | 监听 `visualViewport`，键盘弹出时补偿底部 padding 并滚动到光标 |
| `BtSidebarResizer` | 触屏隐藏拖宽把手（拖拽会和页面手势互抢） |
| `BtSpreadLayout` | `< 768px` 上下堆叠，中缝转横 |
| `BtBookShelf` | 窄屏 2 列 |

### demo 宿主（A1 / A2 / B2 / C2）

- `App.vue`：`mobileShell`（`< md`）切单列骨架——顶栏压缩为「书名 + 保存状态 + 更多」，
  左栏 `AsidePanels` 进 `BtDrawer`，右栏属性检视器进底部 sheet（两档吸附），
  底栏只留进度 + 翻页器，其余收进「更多」；`railLayout = verticalRail && !mobileShell`，
  H5 不做直排竖列转置。桌面侧栏与抽屉共用同一份 `AsidePanels`，避免模板漂移。
- 版式预设：`mobileLayoutPatch` 以 `createPageSize('h5-mobile', 340, 560)` + `columns: 1`
  压在用户补丁之上（仿真模板跳过 pageSize），375px 视口缩放系数≈1，等效字号 ≥ 14px。
- `EditorToolbar`：`compactToolbar`（`isMobile || coarsePointer`）下每行只直出
  「撤销 / 重做 / B / H1 / 注音」，其余收进行尾「更多」，展开后单行横滚，按钮 44px。
- `ToolbarUsageTip`：粗指针下整体禁用（hover 卡片会「粘住不回」），暴露 `data-touch`。
- `SettingsPanel` / `BookInfoDialog`：`< 768px` 全屏化（去圆角、导航横排 / 字段单列）。
- 生命周期：`pagehide` 落盘、`pageshow` 重排、`blur` 触发自动保存（B6）。

### 可断言钩子一览

happy-dom 没有布局，H5 行为靠语义钩子验证：

| 钩子 | 出处 |
| --- | --- |
| `.bt-drawer[data-side][data-open]` / `[data-snap]` | `BtDrawer` |
| `role="slider"` + `aria-valuenow` / `aria-valuemax` | demo `ProgressBar` |
| `emit('tap-center')` / `emit('update:page')` | `BtBookView` |
| `.editor-toolbar[data-pointer]` / `[data-row][data-folded]` + `aria-expanded` | demo `EditorToolbar` |
| `.usage-tip[data-touch]` | demo `ToolbarUsageTip` |
| `.dialog--mobile` / `[data-mobile]` | demo 设置 / 书籍信息弹窗 |

## P4 导出扩展（E7）：图片 / 长图导出

把分页结果渲染成图片：单页 PNG / JPEG、按章批量截图打 ZIP、多页竖向拼接的分享长图。
全部导出集中在 `@bibliotype/vue`（`src/image-export.ts`），**不引第三方运行时依赖**；
文件下载与存储由宿主完成（与「库内不下载文件」的既有约定一致）。

| 导出 | 用途 | 关键参数 / 返回值 |
| --- | --- | --- |
| `exportChapterImages(reader, options?)` | 按章截图 → ZIP | `image?`（DPR / 格式 / 质量 / 底色）、`capture?`、`retries?`、`chapterLevel?`、`onProgress?`；返回 `chapters` / `pages` / `zip` |
| `exportLongImage(reader, options?)` | 截图 → 竖向拼接 → 图片字节 | 同上 + `longImage?`（`pageGap` / `chapterGap` / `padding` / 章名样式）；返回 `chapters` / `pages` / `layout` / `data` |
| `planChapterImages(reader, { level? })` | 按目录把分页结果分组 | 返回 `ChapterImagePlan[]`（`title` / `startPage` / `endPage`）；首章吞并封面 / 前置页，无目录退化为单章 |
| `layoutLongImage(chapters, options?)` | 长图布局（纯函数） | 页位置 + 分隔带位置；高度 = Σ页高 + 页间距 + 分隔带 + 上下留白 |
| `createDomPageCapture(reader, options?)` | 浏览器端单页截图器 | 离屏 `.bt-reader-page` + SVG `foreignObject`，字体就绪后栅格化 |
| `composeLongImage(layout, images, options?)` | 长图合成（Canvas） | 分隔带绘制章名 |
| `createStoredZip(files)` | STORE（不压缩）ZIP | 固定时间戳，同一输入产物逐字节一致 |
| `canvasToBytes` / `waitForFonts` / `resolvePageImageOptions` / `resolvePagePixelSize` / `chapterFolderName` / `pageFileName` / `sanitizeImagePathSegment` | 编码 / 字体 / 选项 / 命名工具 | 均可在 Node / happy-dom 直接调用 |

要点：

- **截图口径与 `BtBookView` 同源**：离屏页框套 `buildBookCss({ containerSelector: '.bt-reader-page' })` +
  `buildPageStyle` / `buildRootStyle`，页眉页脚、页底注区、版心多栏随页渲染——长图里也带页眉页脚；
- **零运行时依赖**：页框克隆进 SVG `foreignObject` 后经 `Image` + Canvas 栅格化；跨域外链图会污染画布，
  IR 约定正文图片内联为 data URI，命中时按截图失败重试；
- 截图前等待 `document.fonts.ready`，字体未就绪不会截出回退字形；
- 按章 ZIP 文件名为 `01-章名/001.png`（页序全书连续、章名经文件系统安全清洗）；PNG / JPEG 本身已压缩，
  ZIP 走 STORE，省 CPU 且产物可复现；
- 长图高度公式：`Σ页高 + 同章页间距 × (页数 − 章数) + 分隔带 × (章数 − 1) + 2 × padding`，
  分隔带可绘制章名，`chapterGap: 0` 关闭；
- 整书页数很多时高度会撞浏览器画布上限（Chrome ≈ 32767px），此时改用按章 ZIP；
- 失败统一为 `BibliotypeError`：单页重试（`retries`，缺省 1）用尽抛 `IMAGE_EXPORT_FAILED`
  （`details.pageIndex` / `attempts`，`cause` 保留根因）；无 DOM / Canvas 环境抛 `IMAGE_EXPORT_UNSUPPORTED`。

```ts
import { exportChapterImages, exportLongImage } from '@bibliotype/vue';

// 按章 ZIP（进度 + 重试）
const { zip, chapters } = await exportChapterImages(reader, {
  image: { dpr: 3, format: 'png' },
  retries: 2,
  onProgress: ({ phase, done, total }) => console.log(phase, `${done}/${total}`),
});
host.save(zip, '全书分章.zip'); // 文件 IO 由宿主完成

// 分享长图（含页眉页脚 + 分章分隔）
const { data, layout } = await exportLongImage(reader, {
  image: { dpr: 2, format: 'jpeg', quality: 0.9 },
  longImage: { pageGap: 16, chapterGap: 48, padding: 12 },
});
console.log(layout.height);
```

测试口径：happy-dom 无 Canvas 2D，DOM 截图与长图合成只覆盖环境安全门（`IMAGE_EXPORT_UNSUPPORTED`）；
截图编排经 `PageCapture` 端口注入假实现，覆盖 ZIP 条目 / 页序 / 进度 / 重试 / 回收；
长图布局是纯函数，直接断言总高与分隔带位置（见 `packages/vue/src/__tests__/image-export.test.ts`）。
