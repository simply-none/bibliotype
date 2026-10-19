# 06 Vue 集成

> 涉及包：`@bibliotype/vue`　·　相关：[02 编辑器与插件](02-editor-and-plugins.md)、[04 阅读器与分页](04-reader-and-pagination.md)

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
| `pageNodes` | `ComputedRef<readonly BookNode[]>` | 当前页 IR 节点 |
| `pageNumberText` | `ComputedRef<string>` | 当前页展示页码（无页时为空串） |
| `next` / `prev` / `goToPage` / `goToNode` | `() => boolean` | 导航（返回是否生效） |
| `repaginate` | `(overrides?) => void` | 重排 |

`useReaderBinding(reader)` 只绑定不创建，可在任意组件内对同一 Reader 多次调用
（组件 / effectScope 销毁时自动解绑事件）。

## 组件

| 组件 | props | 说明 |
| --- | --- | --- |
| `BtBookView` | `reader: Reader`、`tokens?`、`fontToken?`、`fit?: 'width' \| 'contain' \| 'none'`（默认 `contain`，仅 `page` 模式）、`mode?: 'page' \| 'scroll'`（默认 `page`） | 书页视图：IR → HTML（与导出器同源序列化）、注入书册样式表、页脚页码（封面页自动隐藏）。`page` 一次渲染当前页并按容器等比缩放；`scroll` 连续滚动多页（滚动 ↔ 页态双向同步） |
| `BtPager` | `reader: Reader` | 翻页控件：上一页 / 页码 / 下一页 |
| `BtToc` | `reader: Reader`；emit `select(item)` | 目录树；点击经 `goToNode` 跳页并抛出 `select` |
| `BtTocItem` | `item: OutlineItem`；emit `select` | 单个目录项（层级递归） |
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
- `BtBookView` 注入的书册样式表以 `#bt-book-css` 单例挂载，多实例共享、以最后写入为准。

## 相关

- 包参考：[`@bibliotype/vue`](../packages/vue/README.md)
- 编辑核心与命令：[02 编辑器与插件](02-editor-and-plugins.md)
- 示例应用：[apps/demo](../apps/demo/README.md)
