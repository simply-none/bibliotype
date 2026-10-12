# 13 核心运行时（事件总线 · 节点注册 · 核心实例）

> 涉及包：`@bibliotype/core`　·　相关：[01 数据模型](01-document-model.md)、[02 编辑器与插件](02-editor-and-plugins.md)、[11 主题与令牌](11-theme-tokens.md)

core 的运行时由三块拼成：**类型化事件总线**（库与宿主、包与包之间的通信）、
**节点类型注册表**（IR 语义名录，插件扩展的登记处）、**核心实例**（把两者与主题、
插件注册表组装为上下文完备的门面）。三者均无 DOM 依赖，浏览器与 Node 同构。

## 事件总线（EventBus）

```ts
import { createEventBus } from '@bibliotype/core';

const bus = createEventBus();

const off = bus.on('document:load', ({ document }) => {
  console.log('载入：', document.metadata.title);
});

bus.once('plugin:installed', ({ name }) => { /* 仅触发一次 */ });

bus.emit('document:load', { document });   // 触发
off();                                     // 解除订阅
```

| 方法 | 说明 |
| --- | --- |
| `on(type, handler)` | 订阅事件，返回解除订阅函数（`Unsubscribe`） |
| `once(type, handler)` | 订阅一次，触发后自动解除 |
| `off(type, handler)` | 解除某个处理器的订阅 |
| `emit(type, payload)` | 触发事件；对处理器做**快照**后再调用，允许回调内退订 |
| `hasListeners(type)` | 是否存在订阅者 |
| `clear(type?)` | 清空某事件订阅；省略参数清空全部 |

`EventHandler<T>` / `Unsubscribe` 为配套类型；`EventBus<Map>` 是泛型类，
`createEventBus()` 返回预绑定 `BibliotypeEventMap` 的实例。

### 内置事件一览（BibliotypeEventMap）

| 事件 | 载荷 | 当前触发点 |
| --- | --- | --- |
| `document:load` | `{ document }` | `reader.loadDocument`（每次载入 / 替换文档） |
| `page:change` | `{ pageIndex, totalPages }` | reader 翻页 / 重排 |
| `toc:ready` | `{ itemCount }` | `reader.loadDocument` 末尾（目录构建完成） |
| `plugin:installed` | `{ name, version? }` | 插件安装成功（`PluginRegistry.install`） |
| `document:save` | `{ documentId }` | ——（已声明，当前版本未触发） |
| `document:meta-change` | `{ changedKeys }` | ——（已声明，当前版本未触发） |
| `render:complete` | `{ durationMs }` | ——（已声明，当前版本未触发） |
| `collab:remote-update` | `{ update: Uint8Array }` | ——（已声明，当前版本未触发） |

> 表中后 4 个事件为**预留声明**：类型已定义、便于插件先行获得类型推导，但当前版本的
> 存储适配器与协同包都**不会**广播它们，使用方不应依赖其触发。

`reader.loadDocument` 的事件顺序：

```text
document:load → page:change（repaginate 内）→ toc:ready
```

### 插件扩展事件（声明合并）

```ts
declare module '@bibliotype/core' {
  interface BibliotypeEventMap {
    'my-plugin:ready': { count: number };
  }
}

/* 此后 bus.on('my-plugin:ready', …) 具备完整类型推导 */
```

## 节点类型注册（NodeTypeRegistry）

IR 中每个 `type` 都应在注册表登记（core 启动时预置现代书籍节点），插件通过注册表扩展：

```ts
import { createBibliotype } from '@bibliotype/core';

const instance = createBibliotype();

instance.nodeTypes.register({
  type: 'example:callout',
  namespace: 'example',    // 归属命名空间（冲突提示 / 批量注销用）
  kind: 'block',           // 'block' | 'inline' | 'text'
  isContainer: true,       // 是否可包含子节点
  description: '提示块',
});
```

| 成员 | 说明 |
| --- | --- |
| `register(def)` | 注册单个定义（重复注册抛 `NodeTypeConflictError`） |
| `registerAll(defs)` | 批量注册（**原子**：任一冲突全部回滚） |
| `get(type)` / `has(type)` | 查询定义 / 是否已注册 |
| `list()` / `listByNamespace(ns)` | 列出全部 / 按命名空间过滤 |
| `unregister(type)` / `unregisterByNamespace(ns)` | 注销（插件卸载时调用） |

- `NodeTypeDefinition`：`{ type, namespace, kind, isContainer, description? }`，
  `type` 约定小写 kebab-case、全局唯一；
- `NAMESPACES`：内置 `CORE: 'core'` 与 `CLASSICAL: 'classical'`；自定义扩展建议
  使用独立命名空间（冲突错误会提示以前缀区分，如 `classical:jiaozhu`）；
- core 启动预置 `CORE_NODE_DEFINITIONS`（即 [01](01-document-model.md) 的 NODE_TYPES 一览）；
  古籍节点由 classical 插件注册（见 [03](03-classical-layout.md)）。

### 与编辑器规格、序列化输出的三层关系

让一个自定义节点「可编辑 + 可渲染 + 可导出」需三层配合（以 `example:callout` 为例）：

| 层 | 归属 | 职责 |
| --- | --- | --- |
| core 节点注册 | `instance.nodeTypes.register` | IR 语义名录：类型归属与节点族 |
| 编辑器规格注册 | `EditorSchemaRegistry.registerNode`（[02](02-editor-and-plugins.md)） | ProseMirror schema：可编辑性 |
| 序列化输出 | `serializeNode(node, { tagOverrides })`（[05](05-layout-and-html.md)） | HTML 标签映射（缺省按容器启发式兜底） |

```ts
import { createDefaultEditorSchemaRegistry } from '@bibliotype/editor';
import { serializeNode } from '@bibliotype/layout/html';

/* 第 2 层：登记 ProseMirror 规格（type 与 IR 一致） */
const registry = createDefaultEditorSchemaRegistry();
registry.registerNode({
  type: 'example:callout',
  namespace: 'example',
  spec: { content: 'block+', group: 'block', attrs: { tone: { default: 'info' } } },
  /* 缺省 toDOM / parseDOM 由注册表自动补（bt-{type} 类表现） */
});

/* 第 3 层：导出 / 阅读序列化时定制输出标签 */
serializeNode(node, { tagOverrides: { 'example:callout': 'aside' } });
```

## 核心实例（createBibliotype）

```ts
import { createBibliotype, FONT_SIZE_TOKENS } from '@bibliotype/core';

const instance = createBibliotype({
  theme: { [FONT_SIZE_TOKENS.BODY]: '18px' },   // 初始令牌覆盖（基线 DEFAULT_THEME）
});
```

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `events` | `EventBus<BibliotypeEventMap>` | 事件总线 |
| `nodeTypes` | `NodeTypeRegistry` | 节点类型注册表（已预置 core 节点） |
| `theme` | `ThemeAccessor` | 主题令牌读写（[11](11-theme-tokens.md)） |
| `plugins` | `PluginRegistry` | 插件安装 / 卸载 / 查询（[02](02-editor-and-plugins.md)） |
| `context` | `BibliotypeContext` | `{ events, nodeTypes, theme }` 组装体（插件 install 入参） |
| `dispose()` | `void` | 卸载全部插件（倒序执行清理）并清空事件订阅 |

要点：

- **共享总线**：实例的 `events` 可传给 `Reader`（`new Reader({ events: instance.events })`），
  此时阅读过程产生的 `document:load` / `page:change` / `toc:ready` 与该实例的订阅者互通；
  `reader.events` 为同一只读引用（[04](04-reader-and-pagination.md)、[06](06-vue-integration.md)）；
- **插件生命周期**：`install` 成功触发 `plugin:installed`；`uninstall` / `dispose`
  执行插件返回的清理函数；`installAll` 任一失败自动回滚已装项（[02](02-editor-and-plugins.md)）；
- **dispose 之后**：全部插件已卸载、事件订阅已清空，实例不再持有任何外部回调。

> 注意区分同名导出：`@bibliotype/vue` 也导出 `createBibliotype`，但那是 **Vue 插件**
> （`app.use(...)` 全局注册 Bt 组件，见 [06](06-vue-integration.md)）；本节的
> `createBibliotype` 来自 `@bibliotype/core`，是核心运行时实例。

## 相关

- 包参考：[`@bibliotype/core`](../packages/core/README.md)
- IR 与节点类型一览：[01 数据模型](01-document-model.md)
- 插件定义与卸载清理：[02 编辑器与插件](02-editor-and-plugins.md)
- 阅读器事件消费：[04 阅读器与分页](04-reader-and-pagination.md) / [06 Vue 集成](06-vue-integration.md)
- 主题令牌：[11 主题与令牌](11-theme-tokens.md)
