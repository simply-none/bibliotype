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
- `buildEditorSchema()`：一步构建标准 schema（等价 `createDefaultEditorSchemaRegistry().buildSchema()`）；
- `DEFAULT_EDITOR_NAMESPACE` / `DEFAULT_EDITOR_TOP_NODE`：缺省命名空间（`'core'`）与根节点类型（`book`）；
- `CORE_EDITOR_NODE_SPECS` / `CORE_EDITOR_MARK_SPECS`：core 的标准规格表；
- `COMMON_NODE_ATTRS` / `STRUCTURE_NODE_ATTRS` / `COMMON_MARK_ATTRS`：属性映射共享片段——节点公共
  `id` + `rawAttrs` 兜底、结构节点追加 `title`（reader 目录提取依赖）、标记公共 `rawAttrs`，供扩展规格复用；
- 古籍规格（`double-note` 等）通过 `registerClassicalEditorSpecs(registry)` 增量注册，
  或 `buildClassicalEditorSchema()` 一步构建（见 [03 古籍排版](03-classical-layout.md)）。

## BookEditor 门面

```ts
import { BookEditor, createBookEditorPlugins, undoCommand } from '@bibliotype/editor';
import { createEmptyDocument } from '@bibliotype/core';

const schema = createDefaultEditorSchemaRegistry().buildSchema();
const editor = new BookEditor({
  schema,
  plugins: createBookEditorPlugins(schema),   // history + 键位 + 粘贴增强 + 快捷输入
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

### 快照口径与保存链路性能（大文档必读）

`onChange` 回调参数是**共享 IR 快照**（`getSharedDocument` 口径）：未变子树与上一次
快照复用同一引用，**消费方必须视其为只读**（原地修改会污染后续快照）。两条导出的成本差：

| 方法 | 成本 | 用途 |
| --- | --- | --- |
| `getSharedDocument()` | O(变更子树)（缓存命中近乎零成本） | 高频管线：逐键重排、变更广播、保存快照 |
| `getDocument()` | O(全文档) + 等量对象分配 | 低频路径：一次性导出、初次载入 |

实测（78 万字 / 12623 块）：`getDocument()` 4.8 ms/次，`getSharedDocument()` 0.02 ms/次。
**禁止在逐键事务里调用 `getDocument()`**——它是编辑卡顿的典型来源（见 [14 常见问题](14-faq.md) 第 6 条）。
落盘策略（节流 / 空闲时段 / 单飞去重）见 [10 存储适配器](10-storage-adapters.md)。

## 命令一览

| 命令 | 说明 |
| --- | --- |
| `undoCommand` / `redoCommand` | 撤销 / 重做（配合 history 插件） |
| `undoDepth` / `redoDepth` | 剩余可撤销 / 重做步数 |
| `toggleMarkOfType` | 按标记类型开关行内标记 |
| `setHeadingLevel(level)` / `setParagraph()` | 标题级别 / 转回正文 |
| `toggleQuote` / `toggleBulletList` | 引文块 / 无序列表 |
| `insertBlockAfterSelection` | 在选区后插入块 |
| `insertMathBlock(tex)` / `insertMathInline(tex)` | 公式块 / 行内公式（源码存 `attrs.tex`） |
| `insertRuby(reading, text?)` | 注音：选区加 `ruby` 标记，或插入带注音文字 |
| `insertFigure({ src, alt, caption })` | 图片 + 图注块组，光标落入图注 |
| `insertHorizontalRule()` / `insertPageBreak()` | 分隔线 `break(variant='hr')` / 分页符 `break(variant='page')` |
| `insertFootnote` / `insertEndnote` / `insertMarginNote` / `insertNote` | 脚注 / 尾注 / 边注，按同类现存数量自动编号（见 [31 注释](31-notes.md)） |
| `insertToc(options?)` | 生成 / 刷新目录页（见下节） |

### 目录生成 / 刷新（`insertToc`）

```ts
import { insertToc, collectTocEntries } from '@bibliotype/editor';

insertToc();                                  // 插在前置页之后
insertToc({ maxLevel: 1, includeHeadings: true });
insertToc({ title: '' });                     // 不排「目录」标题行
insertToc({ links: false });                  // 纯文字目录
insertToc({ hrefPrefix: 'text/sec-0.xhtml#' }); // 跨文档链接前缀
```

- 产物是 `toc` 块：标题行 `data-role="toc-title"` + 逐条段落 `toc-entry`（顶层）/ `toc-subentry`（更深），
  与 demo 目录页、`book-css` 的 `role.toc-*` 样式同一口径；
- 条目只收**有 `id` 的结构节点**（卷 / 章 / 节 / 附录 / 前言 / 后记；`includeHeadings` 时加 heading），
  无 id 的节点没有可用锚点，宁缺不列；
- 层级按结构嵌套推导，跳级收敛为「父级 + 1」，避免缩进错位；
- 已存在目录时**原位替换内容**（保留其 `id` 与自定义属性），即「刷新」；文档无可收条目时返回 `false`。

### 默认键位（`createBookEditorKeymap`）

| 快捷键 | 行为 |
| --- | --- |
| `Mod-b` / `Mod-i` / `Mod-u` | 粗体 / 斜体 / 下划线（标记未注册时省略绑定） |
| `Mod-z` / `Shift-Mod-z` / `Mod-y` | 撤销 / 重做 / 重做（Windows 习惯） |
| `Mod-Alt-0..3` | 正文 / 标题 1~3 |
| `Enter`（列表项内） | 优先切分列表项，否则回退基础键位 |

## Markdown 快捷输入（input rules）

`createInputRulesPlugin(options?)` 以 `appendTransaction` 实现，**不依赖 `EditorView`**——无视图编辑
状态机（`BookEditor`）与自绘画布（`BtEditor`）同样生效。在**块首**输入触发串即转为对应节点：

| 输入 | 结果 |
| --- | --- |
| `# ` ~ `###### ` | 标题 1~6（保留块 `id` 与其余属性） |
| `> ` | 引用块（包裹当前段落） |
| `- ` / `* ` / `+ ` | 无序列表 |
| `1. ` | 有序列表 |
| ` ```ts ` | 代码块（`language = 'ts'`，缺省语言为空） |
| `---` / `***` | 分隔符 `break(variant='hr')`；位于末块时自动补空段落承接光标 |

```ts
import { createInputRulesPlugin, matchInputRule } from '@bibliotype/editor';

const plugins = [createInputRulesPlugin({ horizontalRule: false })];   // 按种类关闭
matchInputRule('# ');   // { kind: 'heading', prefixLength: 2, headingLevel: 1 }
```

- 选项 `headings` / `quote` / `lists` / `codeBlock` / `horizontalRule`，缺省全开；
- 只处理空选区（光标）且光标位于文本块内：带前缀（`请# `）或非块首不触发；
- 判定逻辑是纯函数 `matchInputRule`，`applyInputRules` 可单独复用于自定义输入管线。

## 查找替换（编辑态）

```ts
import { findNextMatch, findTextMatches, replaceAll, replaceMatch } from '@bibliotype/editor';

const matches = findTextMatches(doc, '第\\d+章', { regex: true, limit: 100 });
const next = findNextMatch(doc, '学而', state.selection.from, { caseSensitive: true });
replaceMatch(matches[0]!, '新文本');   // 「替换当前」
replaceAll('第\\d+章', '第X章', { regex: true });   // 「全部替换」
```

| 选项（`EditorSearchOptions`） | 说明 |
| --- | --- |
| `caseSensitive` | 大小写敏感（默认 false） |
| `regex` | 按正则解释查询串（默认字面匹配；非法正则返回空结果，不抛错） |
| `wholeWord` | 整词匹配，仅在查询首 / 尾为拉丁字母或数字时启用词边界；CJK 保持子串匹配 |
| `range` | 文档坐标范围限定（匹配区间须整体落入） |
| `limit` | 结果上限（默认不限） |

- 匹配逐 text 节点扫描，不跨节点 / 标记边界；
- 替换沿用匹配起点处的 marks，自后向前批量替换以免坐标漂移；
- `buildSearchRegExp` / `escapeRegExp` 可单独取用。

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
