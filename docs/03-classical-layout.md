# 03 古籍排版

> 涉及包：`@bibliotype/classical`　·　相关：[02 编辑器与插件](02-editor-and-plugins.md)、[05 版式与 HTML](05-layout-and-html.md)、[11 主题与令牌](11-theme-tokens.md)

`@bibliotype/classical` 以**插件 + 编辑子入口**两种形态提供古籍能力：

- 插件（主入口）：向 core 实例注册古籍节点、写入古籍主题覆盖；
- 编辑子入口（`@bibliotype/classical/editor`）：向编辑器注册古籍规格、提供古籍命令；
  与主入口分离，纯阅读 / 导出场景不引入 ProseMirror 依赖。

## 古籍节点（13 种）

| 分组 | 常量 | 值 | 说明 |
| --- | --- | --- | --- |
| 注疏体例 | `DOUBLE_NOTE` | `double-note` | 双行小注（正文一行夹两行小字） |
| | `INLINE_NOTE` | `inline-note` | 夹注（行内注文，随正文流） |
| | `HEAD_NOTE` | `head-note` | 眉批（版心上方批语） |
| | `TAIL_NOTE` | `tail-note` | 尾批（段末 / 篇末批语） |
| 校勘字形 | `COLLATION_NOTE` | `collation-note` | 校勘记（底本 / 校本异文记录） |
| | `COLLATION_MARK` | `collation-mark` | 出校符号（○□△，`attrs.symbol` 取值） |
| | `VARIANT_CHAR` | `variant-char` | 异体字（`attrs.standard` 携规范字形） |
| | `TABOO_CHAR` | `taboo-char` | 避讳字（`attrs.taboo` 携避讳缘由） |
| 版式元素 | `IMPRINT` | `imprint` | 牌记 / 刊记 |
| | `COLOPHON` | `colophon` | 卷末题记 / 跋语 |
| | `SEAL` | `seal` | 印章（`attrs.kind` 区分起首章 / 压角章） |
| | `BORDER_FRAME` | `border-frame` | 版框装饰（乌丝栏 / 朱丝栏，`attrs.style`） |
| | `FISH_TAIL` | `fish-tail` | 鱼尾（`attrs.style` 区分单 / 双鱼尾） |

## 古籍标记（6 种）

`CLASSICAL_MARK_TYPES`：`proper-name`（专名号）、`book-title`（书名号）、
`circle-emphasis`（圈点，`attrs.style` 区分圈 / 点）、`note-ref`（注文引用锚点，
`attrs.noteId`）、`variant`、`taboo`。

## 插件安装

```ts
import { createBibliotype } from '@bibliotype/core';
import { createClassicalPlugin } from '@bibliotype/classical';

const instance = createBibliotype();
instance.plugins.install(createClassicalPlugin());

/* 可附加自定义覆盖（优先于默认古籍覆盖） */
instance.plugins.install(
  createClassicalPlugin({ overrides: { 'font-size-body': '18px' } }),
);
```

安装副作用（卸载自动还原）：注册全部古籍节点定义（`CLASSICAL_NODE_DEFINITIONS`，
批量原子，冲突抛错）；写入古籍主题覆盖并收集还原函数。

## 编辑扩展（`@bibliotype/classical/editor`）

```ts
import { createDefaultEditorSchemaRegistry, BookEditor, createBookEditorPlugins } from '@bibliotype/editor';
import {
  buildClassicalEditorSchema,       // 标准规格 + 古籍规格一步构建
  registerClassicalEditorSpecs,      // 或增量注册（返回注销函数）
  toggleProperName, insertDoubleNote, insertCollationSymbol,
} from '@bibliotype/classical/editor';
import { createEmptyDocument } from '@bibliotype/core';

const schema = buildClassicalEditorSchema();

/* 增量注册等价写法： */
const registry = createDefaultEditorSchemaRegistry();
const unregister = registerClassicalEditorSpecs(registry);
const schema2 = registry.buildSchema();

const editor = new BookEditor({
  schema,
  plugins: createBookEditorPlugins(schema),
  document: createEmptyDocument({ title: '十三经注疏' }),
});

/* 命令即 ProseMirror Command；schema 未注册对应规格时返回 false */
editor.dispatch((tr) => { /* … */ });
toggleProperName()(editor.editorState, (tr) => editor.dispatch(tr));
```

### 古籍命令一览

| 命令 | 行为 |
| --- | --- |
| `toggleProperName()` | 切换专名号 |
| `toggleBookTitle()` | 切换书名号 |
| `toggleCircleEmphasis(style?)` | 切换圈点（可选 `style`） |
| `toggleVariant()` | 切换异体字标记 |
| `insertDoubleNote()` | 当前叶块后插入双行小注 |
| `insertHeadNote()` | 当前叶块后插入眉批 |
| `insertCollationNote()` | 当前叶块后插入校勘记 |
| `insertCollationSymbol(symbol = '○')` | 光标处插入出校符号（可传 □ / △） |

## 古籍主题与推荐布局

古籍主题覆盖（`CLASSICAL_THEME_OVERRIDES`）：正文字体改楷体系（`font-family-classical-body`）、
`text-indent-body: 0`（古籍无首行缩进），并新增 4 个扩展令牌：

| 扩展令牌 | 默认值 | 说明 |
| --- | --- | --- |
| `writing-mode` | `vertical-rl` | 直排右起 |
| `text-orientation` | `mixed` | 直排字符方向 |
| `text-combine-upright` | `digits` | 数字合并策略 |
| `text-combine-limit` | `4` | 合并位数上限 |

阅读侧配合使用古籍布局预设：

```ts
import { CLASSICAL_LAYOUT_OPTIONS } from '@bibliotype/layout';
import { Reader } from '@bibliotype/reader';

const reader = new Reader({ layout: CLASSICAL_LAYOUT_OPTIONS }); // 直排、16 开、中文页码
reader.loadDocument(document);
```

### 古籍直排 vs 古籍仿真直排

两者**并列**，互不影响：

| | 古籍直排（本节） | 古籍仿真直排 |
| --- | --- | --- |
| 布局 | `CLASSICAL_LAYOUT_OPTIONS`（无 `facsimile` 字段） | `FACSIMILE_BASE_LAYOUT` + 模板填充 `facsimile` |
| 版框 | 扩展令牌 `page-border`（页面 border，会侵占版心） | 装饰图层（画在页边距内，不侵占版心） |
| 界行 / 版心 | 无 | 有（乌丝栏 / 朱丝栏、书口鱼尾） |
| 对既有行为 | — | **零改动**：缺省 `facsimile` 即走本节全部原路径 |

详见 [22 古籍仿真直排](22-facsimile-vertical.md)。

## 阅读与导出中的古籍

- **阅读分块**：`reader` 将双行小注 / 眉批 / 校勘记等标记为「版式文本容器」，
  无论子级形态（直挂文本或容器 + 段落）恒整体成块，保证容器样式与稳定 id 不丢失；
- **导出**：EPUB / PDF 导出传 `tokens`（古籍合并令牌）+ `fontToken: FONT_TOKENS.CLASSICAL_BODY`
  + `layout: CLASSICAL_LAYOUT_OPTIONS`，序列化器按 `bt-{type}` 类输出容器样式。

## 相关

- 包参考：[`@bibliotype/classical`](../packages/classical/README.md)
- 编辑规格机制：[02 编辑器与插件](02-editor-and-plugins.md)
- 直排与数字合并细节：[05 版式与 HTML](05-layout-and-html.md)
