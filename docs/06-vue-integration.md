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
| `BtEditor` | `editor: BookEditor` | 编辑画布；默认插槽作用域透传 `EditorBinding` |

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

`BtEditor` 内部即用本组合式函数，并把 `EditorBinding` 通过插槽作用域透传给工具条：

```vue
<BtEditor :editor="editor">
  <template #default="binding">
    <button :disabled="!binding.canUndo()" @click="binding.undo()">撤销</button>
    <button @click="binding.execute(toggleProperName())">专名号</button>
  </template>
</BtEditor>
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
