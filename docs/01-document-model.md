# 01 数据模型（IR）

> 涉及包：`@bibliotype/core`　·　相关：[02 编辑器与插件](02-editor-and-plugins.md)、[11 主题与令牌](11-theme-tokens.md)

bibliotype 以 **IR（中间表示）** 为中枢：编辑器产出它、阅读器消费它、导出器转换它、
协同层把它映射到 Y.Doc。IR 是纯 JSON 数据（纯数据、无运行时对象），可直接序列化存储。

## BookDocument

```ts
interface BookDocument {
  schemaVersion: string;   // IR Schema 版本（结构不兼容变更时递增，用于迁移）
  metadata: BookMetadata;  // 书目元数据
  root: BookNode;          // 正文根节点（type 固定为 'book'）
}
```

```ts
import { createEmptyDocument, isBookDocument, IR_SCHEMA_VERSION } from '@bibliotype/core';

const document = createEmptyDocument({ title: '论语集解' });
isBookDocument(document);   // true（轻量结构检查，非完整字段校验）
IR_SCHEMA_VERSION;          // '0.1.0'
```

## BookNode（节点）

```ts
interface BookNode {
  type: string;          // 语义节点类型（见 NODE_TYPES / 插件扩展）
  id?: string;           // 稳定唯一标识（可选，建议结构节点始终携带）
  attrs?: Record<string, string | number | boolean>;   // 节点属性
  children?: BookNode[]; // 子节点（容器 / 块级）
  text?: string;         // 文本内容（仅文本叶子）
  marks?: BookMark[];    // 行内标记（仅携带文本的节点）
}
```

- **文本叶子**：以 `text` 字段标识，用 `isTextNode(node)` 判定；
- 属性读取：`readAttr<T>(node, key)`（带类型收窄）。

### NODE_TYPES 一览（core）

| 分组 | 类型 |
| --- | --- |
| 结构 | `book`、`cover`、`title-page`、`copyright-page`、`back-cover`、`volume`、`chapter`、`section`、`appendix`、`preface`、`postscript`、`toc` |
| 块级内容 | `paragraph`、`heading`（attrs.level 1~6）、`quote`、`list`、`list-item`、`image`、`caption`、`table`、`table-row`、`table-cell`、`code-block`、`math-block`、`break` |
| 注释 | `footnote`、`endnote`、`margin-note` |
| 行内 | `text`、`math-inline` |

古籍专有节点（`double-note`、`collation-note` 等 13 种）由 [`@bibliotype/classical`](03-classical-layout.md) 扩展注册。

## BookMark（行内标记）

标记不构成树结构，仅附加于文本区间：`emphasis`、`strong`、`underline`、`strikethrough`、
`code`、`link`（attrs.href）、`ruby`（attrs 携带注文）、`highlight`。

```ts
const paragraph: BookNode = {
  type: NODE_TYPES.PARAGRAPH,
  id: 'p-1',
  children: [
    { type: NODE_TYPES.TEXT, text: '子曰：学而时习之' },
    { type: NODE_TYPES.TEXT, text: '，不亦说乎？', marks: [{ type: MARK_TYPES.EMPHASIS }] },
  ],
};
```

## BookMetadata（书目元数据）

| 字段 | 说明 |
| --- | --- |
| `title` | 书名（**必填**） |
| `subtitle` | 副题 / 并列题名 |
| `contributors` | 责任者列表 `{ name, dynasty?, role? }`（如「郑玄 · 汉 · 注」） |
| `edition` | 版本信息 `{ name?, era?, publisher?, kind? }`（底本 / 校本） |
| `volumeCount` | 卷数 |
| `classification` | 分类号（如四部分类） |
| `language` | 语言标记（BCP 47，如 `zh-Hant`） |
| `identifiers` | 标识符列表 `{ scheme: 'isbn' \| ... , value }` |
| `publication` | 出版信息 `{ publisher?, year?, place? }` |
| `createdAt` / `updatedAt` | 时间戳 |
| `extra` | 扩展元数据（插件自定义字段） |

## 稳定 id 约定

`id` 是跨会话、跨管线的锚点，以下场景**依赖其稳定性**：

- **协同**：Y.Doc 映射与批注锚点；
- **阅读跳转**：`reader.goToNode(id)`（目录项、搜索结果及上层应用如 demo 书签面板均基于 id）；
- **分页**：分块后按 id 还原原节点（`findNodeById`）。

建议：卷 / 章 / 节等结构节点、注释容器、需被引用的节点始终携带 `id`；
纯样式性行内文本叶可不带。

## 兼容与迁移

- `schemaVersion` 记录 IR 结构版本（当前 `0.1.0`）；
- 读取旧文档时先做 `isBookDocument` 形态检查，再按版本做字段迁移（迁移函数可组合为纯函数链，
  保持 IR 可 JSON 序列化的约束）。

## 相关

- 编辑器如何读写 IR：[02 编辑器与插件](02-editor-and-plugins.md)
- 阅读器如何分块消费 IR：[04 阅读器与分页](04-reader-and-pagination.md)
- 包参考：[`@bibliotype/core`](../packages/core/README.md)
