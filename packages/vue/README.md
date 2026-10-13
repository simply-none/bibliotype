# @bibliotype/vue

Vue 3 封装：`useReader` / `useReaderBinding` / `useEditorBinding` 组合式 API，
`BtBookView` / `BtPager` / `BtToc` / `BtEditor` 组件，以及全局注册插件。

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
| `BtEditor` | `editor`（`BookEditor`）、`tokens?`、`options?`、`fontToken?`、`pagination?`、`pageMainSize?`、`measure?`、`blockSizes?`、`editable?`、`scale?` | 编辑画布：挂载 / 卸载 ProseMirror 视图；`pagination` 开启后渲染与预览同源的「分页纸张」（逐页纸面 + 页间缝隙 + 页码） |

## API 概览

| 导出 | 说明 |
| --- | --- |
| `useReader(source?, options?)` | 创建或绑定 Reader 并转为响应式（`UseReaderReturn`） |
| `useReaderBinding(reader)` | 绑定既有 Reader（`ReaderBinding`） |
| `useEditorBinding(editor)` | 编辑器 DOM 视图绑定（`EditorBinding`，`attach` / `detach`） |
| `BtBookView` / `BtPager` / `BtToc` / `BtTocItem` / `BtEditor` | 组件 |
| `createBibliotype()` | Vue 插件（全局注册组件） |

在组件 / `effectScope` 内调用组合式 API 时，scope 销毁会自动解绑事件与视图。

## 相关

- 功能参考：[docs/06-vue-integration.md](../../docs/06-vue-integration.md)
- 阅读器：[`@bibliotype/reader`](../reader/README.md)
- 仓库主页：[bibliotype](../../README.md)
