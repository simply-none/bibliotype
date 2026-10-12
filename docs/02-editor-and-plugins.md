# 02 编辑器与插件

> 涉及包：`@bibliotype/core`、`@bibliotype/editor`　·　相关：[01 数据模型](01-document-model.md)、[03 古籍排版](03-classical-layout.md)

编辑器采用「**无视图状态机 + 框架封装**」分层：`@bibliotype/editor` 只维护
ProseMirror `EditorState` 与 IR 转换，DOM 视图由 `@bibliotype/vue`（`BtEditor`）等封装层挂载。

## 编辑管线

```text
BookDocument ──irNodeToPm──▶ ProseMirror Doc ──EditorState + 插件──▶ 事务 dispatch
     ▲                                                              │
     └───────────────── pmNodeToIr ◀────────────────────────────── 新状态
```

## 规格注册（D8）

> （D8）为立项决策编号，索引见 [README 术语与决策索引](README.md#术语与决策索引)。

编辑节点 / 标记必须先在**编辑规格注册表**登记，才能进入 schema：

```ts
import { createDefaultEditorSchemaRegistry } from '@bibliotype/editor';

const registry = createDefaultEditorSchemaRegistry();   // 预置 core 节点 + 标记规格
const schema = registry.buildSchema();                  // → ProseMirror Schema
```

- `EditorSchemaRegistry`：按命名空间登记的规格表，冲突抛 `EditorSpecConflictError`；
- `CORE_EDITOR_NODE_SPECS` / `CORE_EDITOR_MARK_SPECS`：core 的标准规格表；
- 古籍规格（`double-note` 等）通过 `registerClassicalEditorSpecs(registry)` 增量注册，
  或 `buildClassicalEditorSchema()` 一步构建（见 [03 古籍排版](03-classical-layout.md)）。

## BookEditor 门面

```ts
import { BookEditor, createBookEditorPlugins, undoCommand } from '@bibliotype/editor';
import { createEmptyDocument } from '@bibliotype/core';

const schema = createDefaultEditorSchemaRegistry().buildSchema();
const editor = new BookEditor({
  schema,
  plugins: createBookEditorPlugins(schema),   // history + 键位
  document: createEmptyDocument({ title: '论语集解' }),
});

const off = editor.onChange((doc) => { /* 持久化 / 重新分页 */ });

/* 命令即 ProseMirror Command：(state, dispatch) => boolean */
undoCommand(editor.editorState, (tr) => editor.dispatch(tr));

const document = editor.getDocument();    // 导出最新 IR（metadata 随载入值保留）
off();
```

要点：

- `loadDocument` 会**重建编辑状态**并把载入文档的 `metadata` / `schemaVersion` 记住；
  `getDocument` 输出时原样带回（编辑不产生元数据副作用）；
- `dispatch` 仅在 `tr.docChanged` 时广播变更（选区等事务不触发）；
- 编辑器**不修改**传入文档对象（IR 按值进出）。

## 命令一览

| 命令 | 说明 |
| --- | --- |
| `undoCommand` / `redoCommand` | 撤销 / 重做（配合 history 插件） |
| `undoDepth` / `redoDepth` | 剩余可撤销 / 重做步数 |
| `toggleMarkOfType` | 按标记类型开关行内标记 |
| `setHeadingLevel(level)` / `setParagraph()` | 标题级别 / 转回正文 |
| `toggleQuote` / `toggleBulletList` | 引文块 / 无序列表 |
| `insertBlockAfterSelection` | 在选区后插入块 |

### 默认键位（`createBookEditorKeymap`）

| 快捷键 | 行为 |
| --- | --- |
| `Mod-b` / `Mod-i` / `Mod-u` | 粗体 / 斜体 / 下划线（标记未注册时省略绑定） |
| `Mod-z` / `Shift-Mod-z` / `Mod-y` | 撤销 / 重做 / 重做（Windows 习惯） |
| `Mod-Alt-0..3` | 正文 / 标题 1~3 |
| `Enter`（列表项内） | 优先切分列表项，否则回退基础键位 |

## IR ⇄ ProseMirror 转换细节

- **容器直挂文本聚合**：宽松 IR 允许容器（如注释容器）直接挂文本叶子；
  转入 PM 时自动聚合为段落（PM 严格要求块容器→块节点），转出后保持规范形态；
- **属性透传**：未在规格中声明的属性经 `RAW_ATTRS_ATTR` 原样保留（往返不丢），
  `toPmAttrs` / `toIrAttrs` 负责双向映射，`declaredAttrNames` 可枚举已声明属性；
- **往返一致性**：由于注释容器在阅读分块中恒为**原子叶块**（见 [04](04-reader-and-pagination.md)），
  编辑保存产生的「容器 + 段落」规范形态与初始宽松形态渲染结果一致。

## 插件系统（core）

插件是 bibliotype 的扩展单元（classical / collab 等均以插件形态提供能力）：

```ts
import { definePlugin } from '@bibliotype/core';

const plugin = definePlugin({
  name: '@example/my-plugin',
  version: '1.0.0',
  install(context) {
    // context: { events, nodeTypes, theme }
    const restore = context.theme.set('accent', '#1f6feb');
    context.nodeTypes.registerAll([{ type: 'my-node', kind: 'block', namespace: 'example' }]);
    return () => restore();   // 卸载清理：uninstall / dispose 时调用
  },
});

instance.plugins.install(plugin);     // 重复安装抛 PluginConflictError
instance.plugins.installAll([a, b]);  // 批量安装（失败自动回滚）
instance.plugins.uninstall(plugin.name);
instance.plugins.list();              // 已安装插件名
```

- 插件声明合并可扩展事件类型：

```ts
declare module '@bibliotype/core' {
  interface BibliotypeEventMap {
    'my-plugin:ready': { count: number };
  }
}
```

- 安装成功会触发核心事件 `plugin:installed`。

## 相关

- 包参考：[`@bibliotype/editor`](../packages/editor/README.md) / [`@bibliotype/core`](../packages/core/README.md)
- 古籍编辑扩展：[03 古籍排版](03-classical-layout.md)
- Vue 编辑视图：[06 Vue 集成](06-vue-integration.md)
