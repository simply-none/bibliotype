# @bibliotype/classical

古籍专有节点与标记定义、古籍主题、classical 插件与编辑命令。
以插件形式安装到 core 实例：批量注册 13 种古籍节点并写入古籍主题令牌（卸载时自动还原）。

## 安装

```bash
pnpm add @bibliotype/classical @bibliotype/core
```

需要编辑能力时使用 `./editor` 子入口（主入口不加载 ProseMirror 相关依赖）：

```bash
pnpm add @bibliotype/editor
```

## 快速上手

### 安装插件（节点 + 主题）

```ts
import { createBibliotype } from '@bibliotype/core';
import { createClassicalPlugin } from '@bibliotype/classical';

const instance = createBibliotype();
instance.plugins.install(createClassicalPlugin());

// 安装后：古籍节点已注册、主题切换为古籍风格（可覆盖）
instance.theme.get('writing-mode');        // 'vertical-rl'（直排右起）
instance.theme.get('text-indent-body');    // '0'（古籍无首行缩进）
```

### 编辑扩展（`./editor` 子入口）

```ts
import { BookEditor, createBookEditorPlugins } from '@bibliotype/editor';
import { buildClassicalEditorSchema, registerClassicalEditorSpecs } from '@bibliotype/classical/editor';

/* 一步构建含古籍规格的完整 schema（标准规格 + 古籍节点/标记规格） */
const schema = buildClassicalEditorSchema();
const editor = new BookEditor({ schema, plugins: createBookEditorPlugins(schema) });

/* 或向既有注册表增量注册（返回注销函数） */
// const registry = createDefaultEditorSchemaRegistry();
// const unregister = registerClassicalEditorSpecs(registry);
```

编辑命令：`toggleProperName` · `toggleBookTitle` · `toggleCircleEmphasis` · `toggleVariant` ·
`insertDoubleNote` · `insertHeadNote` · `insertCollationNote` · `insertCollationSymbol`

## 内容模型

### 古籍节点（`CLASSICAL_NODE_TYPES`，13 种）

| 分组 | 节点 |
| --- | --- |
| 注疏体例 | `double-note` 双行小注、`inline-note` 夹注、`head-note` 眉批、`tail-note` 尾批 |
| 校勘与字形 | `collation-note` 校勘记、`collation-mark` 校勘符号、`variant-char` 异体字、`taboo-char` 避讳字 |
| 版式元素 | `imprint` 牌记、`colophon` 卷末题记、`seal` 印章、`border-frame` 版框、`fish-tail` 鱼尾 |

### 古籍标记（`CLASSICAL_MARK_TYPES`，6 种）

`proper-name` 专名号 · `book-title` 书名号 · `circle-emphasis` 圈点 ·
`note-ref` 注文引用锚点 · `variant` 异文标记 · `taboo` 避讳标记

### 古籍主题

`CLASSICAL_THEME_OVERRIDES` 在安装时写入（可用 `createClassicalPlugin({ overrides })` 定制）：

- 正文字体改为楷体系优先（`font-family-classical-body`）；
- 无首行缩进（`text-indent-body: '0'`）；
- 直排右起（`writing-mode: 'vertical-rl'`）与数字合并策略（`text-combine-upright: 'digits'`、`text-combine-limit: '4'`）。

配套布局配置使用 `CLASSICAL_LAYOUT_OPTIONS`（16 开、中文页码）见 [`@bibliotype/layout`](../layout/README.md)。

## API 概览

| 入口 | 导出 |
| --- | --- |
| `@bibliotype/classical` | `CLASSICAL_NODE_TYPES` / `CLASSICAL_MARK_TYPES`、`CLASSICAL_NODE_DEFINITIONS`、`CLASSICAL_THEME_TOKENS` / `CLASSICAL_THEME_OVERRIDES`、`createClassicalPlugin` / `CLASSICAL_PLUGIN_NAME` |
| `@bibliotype/classical/editor` | `CLASSICAL_EDITOR_NODE_SPECS` / `CLASSICAL_EDITOR_MARK_SPECS`、`registerClassicalEditorSpecs` / `buildClassicalEditorSchema`、编辑命令（见上） |

## 相关

- 功能参考：[docs/03-classical-layout.md](../../docs/03-classical-layout.md)
- 编辑器：[`@bibliotype/editor`](../editor/README.md)
- 仓库主页：[bibliotype](../../README.md)
