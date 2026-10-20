# 23 IR 校验、版本迁移与锚点

> 涉及包：`@bibliotype/core`
> 相关篇目：[01 数据模型](01-document-model.md) · [17 文档导入](17-document-import.md) · [10 存储适配器](10-storage-adapters.md)

本篇是三件相互咬合的底座能力：

1. **锚点（Anchor）**：跨能力的位置契约（阅读位置 / 批注 / 脚注 ref / 交叉引用 / 协同光标）；
2. **校验（validate）**：外部数据进入管线前的结构护栏；
3. **迁移（migrate）**：`schemaVersion` 演进的逐级转换。

三者共同解决「页码会漂移、外部数据不可信、结构会演进」三个长期问题。

---

## 一、锚点

### 1.1 为什么不用页码

页码是**排版产物**：改字号、换版式、切直排、换屏宽都会变。要「记住读到哪」，必须记
**节点 id + 字符偏移**。core 因此提供统一的锚点契约，而不是让每个能力各造一套。

### 1.2 两种锚点

| 类型 | 结构 | 用途 |
| --- | --- | --- |
| `block` | `{ type: 'block', nodeId }` | 书签、章节跳转、图片 / 表格定位 |
| `text` | `{ type: 'text', nodeId, offset, length }` | 高亮、批注、脚注 ref、协同光标 |

坐标轴是**节点纯文本**（`nodePlainText` 递归拼接叶子文本），与渲染后端无关。

```ts
import {
  createTextAnchor,
  serializeAnchor,
  parseAnchor,
  resolveAnchor,
} from '@bibliotype/core';

const anchor = createTextAnchor('p-1', 3, 4);     // 段落 p-1 的第 3 字起 4 个字
serializeAnchor(anchor);                          // 'bt:text:p-1:3:4'（nodeId 经 encodeURIComponent）
parseAnchor('bt:text:p-1:3:4');                   // → 锚点对象

const hit = resolveAnchor(document.root, anchor);
// { anchor（已裁剪）, node, text: '习之，不', clamped: false }
```

### 1.3 失效是常态，不抛错

目标节点被删除时 `resolveAnchor` 返回 `undefined`；文本变短时偏移被裁剪并把
`clamped` 置为 `true`。调用方据此把批注归入「孤儿」并提示重新定位——
**不要在底层抛错**，否则一次删除就能让整本书的批注不可用。

### 1.4 API

| 导出 | 说明 |
| --- | --- |
| `ANCHOR_TYPES` / `ANCHOR_PREFIX` | 类型常量与序列化前缀（`bt`） |
| `createBlockAnchor` / `createTextAnchor` | 构造（负偏移、空 id 抛 `RangeError`） |
| `isAnchor` | 运行时判定 |
| `serializeAnchor` / `parseAnchor` | 字符串往返（非法输入返回 `undefined`） |
| `locateNode` | 深度优先按 id 查节点 |
| `nodePlainText` | 节点纯文本（锚点坐标轴） |
| `clampAnchor` / `resolveAnchor` | 裁剪与解析 |

---

## 二、IR 校验

`isBookDocument` 只回答「能不能当 `BookDocument` 用」；`validateDocument` 回答
「结构是否合法、能否安全进入编辑 / 分页 / 导出管线」。

```ts
import { validateDocument, DOCUMENT_ISSUE_CODES } from '@bibliotype/core';

const result = validateDocument(document, {
  knownNodeTypes: ['double-note', 'collate-note'],   // 插件类型（如 classical）
  knownMarkTypes: ['proper-name'],
  expectedSchemaVersion: '0.1.0',
  requireNodeIds: true,                             // 缺 id 记 warning
});

result.ok;        // 无 error 即 true
result.issues;    // [{ code, severity, path, nodeId?, message }]
```

### 2.1 检查项

| 代码 | 含义 |
| --- | --- |
| `invalid-structure` | 顶层形态问题（缺 `schemaVersion` / `metadata.title` / `root`，root 非 `book`） |
| `unknown-node-type` | 节点类型未注册（可通过 `knownNodeTypes` 放行） |
| `unknown-mark-type` | 标记类型未注册 |
| `text-on-container` | 容器直挂 `text`（应改为「容器 + 文本子节点」） |
| `invalid-text` | `text` 节点缺少字符串 `text` |
| `invalid-children` | `children` 非数组 / 文本节点带子节点 |
| `mark-on-container` | 非文本节点携带 `marks` |
| `duplicate-node-id` | 节点 id 重复（锚点与协同依赖唯一性） |
| `invalid-attr-value` | 属性值不是 `string / number / boolean` |
| `schema-version-mismatch` | 与 `expectedSchemaVersion` 不一致 |

`path` 形如 `root.children[0].children[2].text`，可直接在调试面板高亮定位。

### 2.2 建议接入点

- 导入（`import*` 产物）→ 入库前 `validateDocument`，有 error 就拒绝；
- 存储读取（`StorageAdapter.load`）→ 校验失败可降级为只读并提示；
- 协同远端快照 → 拒绝结构性错误，避免污染本地文档。

---

## 三、版本迁移

```ts
import { migrateDocument, IR_SCHEMA_VERSION } from '@bibliotype/core';

const result = migrateDocument(raw, {
  targetVersion: IR_SCHEMA_VERSION,
  steps: [
    {
      from: '0.0.0',
      to: '0.1.0',
      description: '补齐 language 默认值',
      migrate: (doc) => ({ ...doc, metadata: { ...doc.metadata, language: 'zh-Hans' } }),
    },
  ],
});

result.document;     // 迁移后文档（schemaVersion 已回填）
result.applied;      // 已执行步骤
result.issues;       // 迁移后结构校验问题（validate:false 时为空）
```

约定：

- 每个 step 只负责**相邻两级**，纯函数、不修改入参；
- 迁移链不通抛 `MigrationPathError`（不返回半成品）；
- 缺少 `schemaVersion` 的历史数据按 `LEGACY_SCHEMA_VERSION`（`0.0.0`）处理；
- 内置步骤表 `BUILTIN_MIGRATIONS` 当前为空（`0.1.0` 为基线），历史步骤由调用方注册。

## 四、常见错误

| 现象 | 根因 | 处理 |
| --- | --- | --- |
| 批注全部变成孤儿 | 文档被整体重建（节点 id 变了） | 编辑链路必须保住节点 id；重建时提供 id 映射 |
| `text-on-container` 报错 | 手写 IR 时把文本直接挂在 `paragraph` 上 | 改为 `paragraph > text`；编辑往返会自动规范化 |
| 迁移总说缺步骤 | `schemaVersion` 写成非字符串 / 拼写不一致 | 用 `readSchemaVersion` 打印实际值，再补 step |
| 校验误报插件节点 | 未传 `knownNodeTypes` | 传入插件注册的类型；`unknownTypesAsWarning` 可临时降级 |
