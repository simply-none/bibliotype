# @bibliotype/editor

基于 ProseMirror 的书籍编辑器核心：编辑规格注册（D8）、IR ⇄ ProseMirror 双向转换、
无视图编辑状态机。DOM 视图（prosemirror-view）与框架绑定由 `@bibliotype/vue` 等封装层负责。

## 安装

```bash
pnpm add @bibliotype/editor @bibliotype/core
```

`prosemirror-model / state / commands / history / keymap / schema-list` 为直接依赖，随包自动安装。

## 快速上手

```ts
import {
  BookEditor,
  createDefaultEditorSchemaRegistry,
  createBookEditorPlugins,
  undoCommand,
} from '@bibliotype/editor';
import { createEmptyDocument } from '@bibliotype/core';

/* 1. 构建 schema（标准注册表：core 节点 + core 标记）并创建编辑器 */
const schema = createDefaultEditorSchemaRegistry().buildSchema();
const editor = new BookEditor({
  schema,
  plugins: createBookEditorPlugins(schema),      // history + 键位
  document: createEmptyDocument({ title: '论语集解' }),
});

/* 2. 订阅文档变更（每次事务后回调最新快照：共享 IR，视为只读） */
const off = editor.onChange((document) => {
  console.log('文档已变更：', document.metadata.title);
});

/* 3. 派发命令（ProseMirror Command：state, dispatch => boolean） */
undoCommand(editor.editorState, (tr) => editor.dispatch(tr));

/* 4. 导出结果（保留载入时的 metadata 与 schemaVersion） */
const document = editor.getDocument();
off();
```

> 保存链路性能：`onChange` 的快照与 `getSharedDocument()` 同源（PM→IR 结构共享），
> 逐键事务下是 O(变更子树) 而非 O(全文档) 转换；确认落盘成功后调用 `markSaved()`
> 刷新脏基准。整本序列化 / 写库请做节流或放到空闲时段（见
> [docs/10 存储适配器](../../docs/10-storage-adapters.md)）。

## API 概览

### 编辑器门面 `BookEditor`

| 成员 | 说明 |
| --- | --- |
| `constructor(options?)` | `schema` / `registry` / `document` / `plugins`；缺省用标准注册表与空文档 |
| `editorState` | 当前 ProseMirror `EditorState`（视图层消费） |
| `bookSchema` | 编辑器 `Schema` |
| `loadDocument(document)` | 重载文档（重建编辑状态并广播变更） |
| `getDocument()` | 导出 `BookDocument`（metadata 与 schemaVersion 随载入值保留） |
| `createTransaction()` | 基于当前状态创建事务 |
| `dispatch(transaction)` | 应用事务；文档变化时广播变更 |
| `onChange(handler)` | 订阅变更，返回取消订阅函数；回调参数是**共享 IR 快照（视为只读）** |
| `getDocument()` | 全量导出（O(全文档)）；仅用于落盘 / 导出等低频路径 |
| `getSharedDocument()` | 增量导出（未变子树复用同一引用，O(变更子树)）；高频快照管线用 |
| `isDirty` / `markSaved()` | 脏标记：相对上次 `markSaved` 是否有未保存变更 |

### 规格与 schema（D8）

- `EditorSchemaRegistry`：编辑规格注册表（节点 / 标记规格、命名空间隔离、冲突报错）；
- `createDefaultEditorSchemaRegistry()` / `buildEditorSchema(specs)`：标准注册表与 schema 构建；
- `CORE_EDITOR_NODE_SPECS` / `CORE_EDITOR_MARK_SPECS`：core 节点与标记的编辑规格表；
- 古籍扩展见 [`@bibliotype/classical`](../classical/README.md) 的 `./editor` 子入口。

### IR ⇄ ProseMirror 转换

- `irNodeToPm(node, schema)` / `pmNodeToIr(pmNode)`：双向转换（容器内直挂文本在转换时聚合为段落）；
- `toPmAttrs` / `toIrAttrs` / `declaredAttrNames` / `RAW_ATTRS_ATTR`：属性映射（未声明属性经 `RAW_ATTRS_ATTR` 透传保留）。

### 编辑命令

`undoCommand` · `redoCommand` · `undoDepth` · `redoDepth` · `toggleMarkOfType` ·
`setHeadingLevel` · `setParagraph` · `toggleQuote` · `toggleBulletList` · `insertBlockAfterSelection`

### 插件与键位

- `createBookEditorPlugins(schema)`：history + 键位插件集；
- `createBookEditorKeymap(schema)`：基础键位 + 书稿快捷键 —
  `Mod-b / Mod-i / Mod-u`（粗体 / 斜体 / 下划线）、`Mod-z / Shift-Mod-z / Mod-y`（撤销 / 重做）、
  `Mod-Alt-0..3`（正文 / 标题 1~3）、列表项内 `Enter` 切分列表项。

## 相关

- 功能参考：[docs/02-editor-and-plugins.md](../../docs/02-editor-and-plugins.md)
- 数据模型：[docs/01-document-model.md](../../docs/01-document-model.md)
- 仓库主页：[bibliotype](../../README.md)
