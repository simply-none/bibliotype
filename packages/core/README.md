# @bibliotype/core

bibliotype 的地基：IR 数据模型（节点 / 标记 / 元数据 / 文档）、类型化事件总线、
节点类型与插件注册、主题令牌、存储契约（Port）。

纯数据与纯函数、无框架与 DOM 依赖，浏览器与 Node 同构。

## 安装

```bash
pnpm add @bibliotype/core
```

## 快速上手

### 构建文档（IR）

```ts
import { createEmptyDocument, NODE_TYPES } from '@bibliotype/core';

const document = createEmptyDocument({ title: '论语集解' });   // → BookDocument

document.root.children?.push({
  type: NODE_TYPES.CHAPTER,
  id: 'ch-1',
  children: [
    {
      type: NODE_TYPES.PARAGRAPH,
      id: 'p-1',
      children: [{ type: NODE_TYPES.TEXT, text: '子曰：学而时习之，不亦说乎？' }],
    },
  ],
});
```

节点结构为 `BookNode { type, id?, attrs?, children?, text?, marks? }`：
文本叶子以 `text` 字段标识（`isTextNode` 判定），行内标记挂在 `marks` 上；
结构节点与需被引用的节点建议始终携带稳定 `id`（协同 / 批注 / 交叉引用依赖）。

### 核心实例与插件

```ts
import { createBibliotype, definePlugin } from '@bibliotype/core';

const instance = createBibliotype();   // 预置 core 节点定义与默认主题

instance.plugins.install(
  definePlugin({
    name: '@example/example-plugin',
    install(context) {
      const off = context.events.on('document:load', ({ document }) => {
        console.log('文档已载入：', document.metadata.title);
      });
      return () => off();   // 清理函数：uninstall / dispose 时调用
    },
  }),
);

instance.dispose();   // 卸载全部插件并清空订阅
```

### 主题与事件

```ts
import { createBibliotype, FONT_SIZE_TOKENS } from '@bibliotype/core';

const instance = createBibliotype({ theme: { [FONT_SIZE_TOKENS.BODY]: '18px' } });

instance.theme.get(FONT_SIZE_TOKENS.BODY);   // '18px'
instance.theme.all();                        // 全部令牌（供 layout 生成 CSS）

instance.events.on('page:change', ({ pageIndex, totalPages }) => {
  console.log(`第 ${pageIndex + 1} / ${totalPages} 页`);
});
```

### 事件一览

| 事件 | 载荷 | 触发时机 |
| --- | --- | --- |
| `document:load` | `{ document }` | 文档加载完成 |
| `document:save` | `{ documentId }` | 存储适配器写入完成 |
| `document:meta-change` | `{ changedKeys }` | 元数据变更 |
| `page:change` | `{ pageIndex, totalPages }` | 翻页 / 重新分页 |
| `render:complete` | `{ durationMs }` | 渲染完成 |
| `toc:ready` | `{ itemCount }` | 目录生成完成 |
| `collab:remote-update` | `{ update: Uint8Array }` | 协同远端更新 |
| `plugin:installed` | `{ name, version? }` | 插件安装完成 |

事件名采用 `领域:动作` 约定；插件可通过声明合并扩展 `BibliotypeEventMap` 获得类型推导。

## API 概览

| 分组 | 导出 |
| --- | --- |
| IR 数据模型 | `NODE_TYPES` / `MARK_TYPES`、`BookNode` / `BookMark`、`isTextNode` / `readAttr`、`BookMetadata` 及 `Contributor` / `EditionInfo` / `Identifier` / `PublicationInfo`、`BookDocument` / `createEmptyDocument` / `isBookDocument` / `IR_SCHEMA_VERSION` |
| 事件总线 | `EventBus` / `createEventBus`、`BibliotypeEventMap`、`EventHandler` / `Unsubscribe` |
| 节点注册 | `NodeTypeRegistry` / `NodeTypeConflictError`、`CORE_NODE_DEFINITIONS`、`NAMESPACES`、`NodeKind` / `NodeTypeDefinition` |
| 插件系统 | `BibliotypePlugin` / `definePlugin`、`PluginRegistry` / `PluginConflictError`、`BibliotypeContext` / `ThemeAccessor` |
| 主题令牌 | `FONT_TOKENS` / `FONT_SIZE_TOKENS` / `LAYOUT_TOKENS` / `COLOR_TOKENS`、`DEFAULT_THEME`、`createThemeAccessor` |
| 核心实例 | `createBibliotype`（`BibliotypeInstance` / `CoreInstanceOptions`） |
| 存储契约 | `StorageAdapter`、`StoredDocument`、`DocumentSummary`、`SaveOptions` |

## 相关

- 功能参考：[docs/01-document-model.md](../../docs/01-document-model.md)
- 主题与令牌：[docs/11-theme-tokens.md](../../docs/11-theme-tokens.md)
- 存储适配器：[docs/10-storage-adapters.md](../../docs/10-storage-adapters.md)
- 仓库主页：[bibliotype](../../README.md)
