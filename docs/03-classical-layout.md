# 03 古籍排版

> 涉及包：`@bibliotype/classical`　·　相关：[02 编辑器与插件](02-editor-and-plugins.md)、[05 版式与 HTML](05-layout-and-html.md)、[11 主题与令牌](11-theme-tokens.md)

`@bibliotype/classical` 以**插件 + 编辑子入口**两种形态提供古籍能力：

- 插件（主入口）：向 core 实例注册古籍节点、写入古籍主题覆盖；
- 编辑子入口（`@bibliotype/classical/editor`）：向编辑器注册古籍规格、提供古籍命令；
  与主入口分离，纯阅读 / 导出场景不引入 ProseMirror 依赖。

## 古籍节点（15 种）

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

## 古籍标记（7 种）

`CLASSICAL_MARK_TYPES`：`proper-name`（专名号）、`book-title`（书名号）、
`circle-emphasis`（圈点，`attrs.style` 区分圈 / 点）、`judou`（句读候选，K3）、
`note-ref`（注文引用锚点，`attrs.noteId`）、`variant`、`taboo`。

`judou` 的 `attrs` 为 `symbol`（候选标点）、`source`（自动建议为 `auto`）、
`suggestionId`、`rule`、`confidence`；标记**不改动正文字符**，渲染层用
`.bt-mark-judou::after { content: attr(data-symbol) }` 画淡色候选标点。

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
| `applyJudouSuggestions(items)` | 批量接受句读建议（单事务，落 `judou` 标记，可撤销） |
| `applyProperNameSuggestions(items)` | 批量接受专名建议（落 `proper-name` 标记） |
| `removeSuggestionMarks(options?)` | 拒绝 / 反悔：移除 `source=auto` 的自动标记（可按 `suggestionIds` 过滤） |
| `commitJudouAsText(options?)` | 采纳为标点：把已接受的句读标记落成真实字符并移除标记 |

## 句读 / 专名自动标注（K3）

三层分工，**建议不落盘**——只有人工接受后才写文档：

| 层 | 包 | 导出 |
| --- | --- | --- |
| 规则 | `classical` | `suggestJudou(text, options?)`、`judouMarkerRange(candidate, text)`、`JUDOU_SYMBOLS`、`EXISTING_PUNCTUATION` |
| 专名 | `classical` | `detectProperNames(text, { terms?, detector? })`、`BUILTIN_PROPER_NAME_TERMS`、`ProperNameDetector`（宿主注入模型） |
| 建议模型 | `classical` | `buildAnnotationSuggestions(blocks, options?)`、`collectSuggestionBlocks(document)`、`countSuggestions` |

规则只覆盖低争议信号：句末语气词（也 / 矣 / 焉 / 哉 / 耳 / 乎 / 耶 / 邪 / 夫 / 兮）→ 句号；
提示语（曰 / 云 / 问）→ 冒号；句首连词（然而 / 是以 / 故 / 则 / 而 / 若 …）→ 其前逗号。
已有标点之后不再重复建议，同一偏移只保留置信度最高的一条。

```ts
import { buildAnnotationSuggestions, collectSuggestionBlocks } from '@bibliotype/classical';

const suggestions = buildAnnotationSuggestions(collectSuggestionBlocks(document), {
  // 专名模型端口：宿主接 NER 服务 / 本地模型；不传则只用内置字典
  detector: ({ text }) => myNer(text),
});
// [{ id: 'judou:p-1:2:3:：', kind: 'judou', blockId: 'p-1', start: 2, end: 3, symbol: '：', … }]
```

偏移口径：**段内 UTF-16 code unit**，与 ProseMirror 位置一致；`id` 由类别 + 块 id +
区间 + 符号确定性生成，可复现、可批量接受。

Vue 侧 `useAnnotationSuggestions({ document, revision?, apply })` 把建议编排成状态机
（待处理 / 已接受 / 已拒绝 / 已落地），接受 / 拒绝 / 采纳为标点的命令由宿主注入
（`@bibliotype/vue` 不直接依赖 `classical/editor`，只读阅读场景不加载 ProseMirror）。
`BtAnnotationSuggestions` 是配套面板：类别筛选、逐条接受 / 拒绝、改标点 / 改类别、
批量确认与「采纳为标点」。详见 [06 Vue 集成](06-vue-integration.md#句读--专名建议k3)。

## 批点套印（直排 v2 批 6）

朱墨套印的色层落在注 / 批类节点与圈点标记的 `inkColor` 属性
（`red` / `blue` / `yellow`；缺省全墨）——批注圈点用朱，可扩蓝黄多评家分色：

- **命令**：`setInkColor(color | null)` 作用于光标所在注 / 批类节点
  （footnote / endnote / margin-note / head-note / tail-note / collation-note /
  double-note / inline-note / general-review）；`black` / null 回归全墨；
- **渲染**：`data-ink` 属性选择器取 `--bt-ink-*` 变量（主题可覆盖色值），
  预览 / EPUB / PDF 全路径输出（批点套印不限仿真书）；
- **单色模式**：`buildBookCss({ monoInk: true })`（PDF / EPUB 导出选项
  `monoInk` 透传）跳过色层规则——批注圈点回归全墨，单色印刷交付；
- **圈点双位**（§11.4）：句读标记居字右下（缺省）；文法符号（密圈 / 密点）
  经圈点标记 `position: 'grammar'`（`setMarkAttrs`）居字右——两类不争空间；
  密度档受 CSS text-emphasis 能力限制顺延（以 style 实心 / 镂空二维替代）；
- **卷末总评**：`general-review` 节点（批 1）配 `.bt-general-review` 结构块
  样式（分隔线起首、注文色、小一号）；
- 注码圈码：注码标记 marker 直接用 ① ② 等圈码字形（内容层，置于被注字后）。
## 行款规则（直排 v2 批 4）

古籍行款——正文连排、段界靠格位——由段落 / 引文的行款属性承载（批 1 登记、
批 3 命令写入、批 2 / 批 4 消费）：

| 属性 | 形式 | 直排（行内流） | 横排 / EPUB / 流式导出（降级） |
| --- | --- | --- | --- |
| `indent` 1~4 | 低格 | 段首空位盒（列首空 N 字位） | `text-indent: N em`（属性选择器，覆盖令牌缩进） |
| `lift: 'space'` | 空抬 / 挪抬 | 并入段首空位（+1 字位） | 无低格并存时 `text-indent: 1em`（并存时被低格吸收——敬语段不设低格的惯例，与直排相加口径的差异即此） |
| `lift: 'newline'`（`liftLevel` 1~4） | 平抬 / 单双三四抬 | `<br>` 断列 + 抬升列首空位（高出 N 字；页首自动降顶格） | 换段（段落本独立成块；level 供导出侧沿用，呈现从简） |
| `breakLine` | 提行另起 | 同上（断列） | 换段 |

- **分页折算**：低格 / 挪抬使首行有效容量扣减（`defaultEstimator` 按
  `lineRuleOverhead` 折算行数）；提行 / 平抬标注 `breakColumn`——直排装箱把
  当前列剩余空间弃用（usedMainSize 对齐列距），块从新列顶格起写；DOM 实测
  路径（量尺含行内流断列效果）优先，估算折算为无 DOM 导出的兜底；
- **导出同源**：PDF paged 直排与预览共享 `serializeVerticalFlow`（连排 /
  双行夹注固定双列 / 行款标记），续排片段自动省略行款前缀；
- **章首顶格**：古籍主题 `text-indent` 令牌缺省 0（正文连排本无段首缩进），
  章首段顶格即缺省形态；现代横排的「章首段不缩进」惯例由文档侧对章首段
  显式设 `indent` 属性表达（属性值优先于令牌）。
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

## 印章印谱（K5）

`seal` 节点新增可选 attrs：`style`（`zhu` 朱文 / `bai` 白文，缺省朱文）、
`layout`（`square` 方印回文 / `column` 竖排，缺省方印）、`border`
（`none` / `thin` / `thick`，缺省粗边）。

- 序列化（`@bibliotype/layout`）把印章输出为**内联 SVG 印谱**
  （`renderSealSvg`，确定性纯函数，同输入同字节）；方印按传统读序
  「右上 → 右下 → 左上 → 左下」排字，白文为朱底留白；
- 关闭 SVG（`inlineSealSvg: false`，EPUB 2 自动关闭）或印文为空时退化为
  `.bt-seal:empty::after { content: attr(data-text) }` 的文字方框印章，
  不打包位图、不新增资源登记。

## 校勘配对与汇总表（K2）

- `collation-mark` 新增 `pairId` / `role`（`base` / `variant`），
  `collation-note` 新增 `pairId` / `marker`（独立编号序列）；
- 编辑命令：`insertCollationNote()` 插入时自动取号（现有最大编号 + 1）；
  `renumberCollationNotes()` 按文档顺序压缩编号（单事务、可撤销）；
  `pairCollation(baseBlockId, variantBlockId)` 把两块内的校勘标记绑定为
  同一 `pairId`（底本 / 校本各标角色）；`unpairCollation(pairId)` 解绑；
- 阅读层：`BtCollationCompare`（`@bibliotype/vue`）按 `pairId` 并排两侧
  段落，悬浮 / 聚焦时同配对双侧同步高亮；不做编辑器内并排编辑；
- 汇总表：`buildCollationSummary(document)` 生成与索引附录同构的
  `appendix` 节点（编号升序、摘要截断、每条回跳注文）；导出时经
  `exportEpub` 的 `appendices` 选项追加，`#id` 锚点自动改写为跨文件地址。

## 相关

- 包参考：[`@bibliotype/classical`](../packages/classical/README.md)
- 编辑规格机制：[02 编辑器与插件](02-editor-and-plugins.md)
- 直排与数字合并细节：[05 版式与 HTML](05-layout-and-html.md)
