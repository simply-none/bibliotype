# 05 版式与 HTML

> 涉及包：`@bibliotype/layout`（含 `@bibliotype/layout/html` 子入口）　·　相关：[04 阅读器与分页](04-reader-and-pagination.md)、[07 EPUB 导出](07-export-epub.md)、[08 PDF 与打印](08-export-pdf.md)、[11 主题与令牌](11-theme-tokens.md)

`layout` 是纯函数的排版引擎：布局选项 → CSS 声明 / CSS 文本 / HTML 片段，
无 DOM 依赖，可测试、可 SSR、可被 Node 端导出器复用。

## 布局配置

```ts
interface LayoutOptions {
  writingMode: WritingMode;                 // 'horizontal-tb' | 'vertical-rl' | 'vertical-lr'
  pageSize: PageSize;                       // { name, width, height }（px，96dpi）
  columns: number;                          // 分栏数 1~3
  pageNumberStyle: PageNumberStyle;         // 'decimal' | 'chinese' | 'roman'
  combineUpright: CombineUprightOptions;    // 直排数字/英文策略（D3，含长数字串汉字分组）
  facsimile?: FacsimileOptions;             // 古籍仿真版式（缺省 undefined = 不启用）
}
```

| 预设 | 值 |
| --- | --- |
| `DEFAULT_LAYOUT_OPTIONS` | 横排、A5、单栏、阿拉伯页码 |
| `CLASSICAL_LAYOUT_OPTIONS` | 直排右起、16 开、单栏、中文页码 |
| `FACSIMILE_BASE_LAYOUT` | 同上，但由 `FACSIMILE_PRESETS` 填充 `facsimile`（版框 / 界行 / 版心） |

`facsimile` 是「古籍仿真直排」的唯一开关：缺省时版心尺寸、样式表与度量签名
与未实现该能力前完全一致；启用后只有版心带宽（`facsimile.gutter.size`）进入
主轴扣减，版框与界行画在页边距内、不侵占版心。详见
[22 古籍仿真直排](22-facsimile-vertical.md)。

```ts
import {
  PAGE_SIZES, createPageSize, resolveContentBox, mergeLayoutOptions,
  DEFAULT_LAYOUT_OPTIONS, isVerticalMode,
  WRITING_MODES, TEXT_ORIENTATIONS,
} from '@bibliotype/layout';

const custom = createPageSize('大16开', 750, 1050);          // 自定义页面尺寸
const box = resolveContentBox(PAGE_SIZES.A5, 48, 56);        // 扣除页边距后的内容区
const options = mergeLayoutOptions(DEFAULT_LAYOUT_OPTIONS, { columns: 2 });
isVerticalMode(options.writingMode);                          // 是否竖排
WRITING_MODES.VERTICAL_RL;                                    // 书写方向常量：竖排右起
TEXT_ORIENTATIONS.UPRIGHT;                                    // 直排字符方向常量：全部直立
```

`WRITING_MODES` / `TEXT_ORIENTATIONS` 为书写方向与直排字符方向的取值常量集合
（`horizontal-tb` / `vertical-rl` / `vertical-lr`；`mixed` / `upright` / `sideways`），
配置 `writingMode` 等选项时使用，避免手写字符串。

## 直排数字 / 英文合并（D3）

> （D3）为立项决策编号，索引见 [README 术语与决策索引](README.md#术语与决策索引)。

竖排文本中数字与拉丁字母需专门策略：短数字串合并进一格、超长数字串侧转顺排、
拉丁词默认侧转 90°。

```ts
import {
  segmentForVertical, combineUprightCss, needsCombineUpright,
  DEFAULT_COMBINE_OPTIONS, SEGMENT_KINDS,
} from '@bibliotype/layout';

segmentForVertical('第2026卷 Web 版');
// [{ kind: 'native', text: '第', upright: 'as-is' },
//  { kind: 'digits', text: '2026', upright: 'combine' }, … ]

combineUprightCss({ maxDigits: 4, latinStrategy: 'rotate' }); // 'digits 4'
combineUprightCss({ maxDigits: 0, latinStrategy: 'rotate' }); // undefined（禁用合并）
```

`CombineUprightOptions`：`maxDigits`（合并位数上限，默认 4；≤0 禁用）、
`latinStrategy`（`rotate` 侧转 / `combine` 并入字格）、`longDigits`（超长数字串
`sideways` 侧转 / `kanji` 转汉字数字直排，缺省侧转）。

## 竖排文字形态（B7）

竖排下标点与引号的横排字形位置错位（句号跑到左下、引号横躺），须换用 Unicode
竖排形态；数字可选「汉字数字直排」分组。全部为纯函数，且**逐字符一一对应**，
不改字符数，可直接作用于已分页 / 已实测文本（不破坏 `lineOffsets` / 字符区间）。

```ts
import {
  toVerticalPunctuation, toKanjiDigits, toFullwidthDigits,
  transformVerticalText, needsVerticalTextTransform, VERTICAL_PUNCTUATION_FORMS,
} from '@bibliotype/layout';

toVerticalPunctuation('子曰：「学而时习之。」');  // 子曰︓﹁学而时习之︒﹂
toKanjiDigits('1850');                        // 一八五〇
transformVerticalText('1850年', { digits: 'kanji' });  // 一八五〇年（标点同时转换）
```

| 项 | 说明 |
| --- | --- |
| `VERTICAL_PUNCTUATION_FORMS` | 横排 → 竖排形态表：`。︒` `、︑` `，︐` `：︓` `；︔` `！︕` `？︖` `（︵` `）︶` `〔︹` `〕︺` `…︙`；引号书名号 `「﹁` `」﹂` `『﹃` `』﹄` `【﹇` `】﹈` `《︽` `》︾` `〈︿` `〉﹀` |
| `transformVerticalText(text, { punctuation?, digits? })` | 标点缺省转换；`digits: 'kanji' \| 'fullwidth' \| 'none'`（缺省 `none`） |
| `needsVerticalTextTransform(text, options?)` | 是否需要转换（渲染层跳空遍历） |

序列化器提供同名开关（缺省不转换，交给浏览器 OpenType `vert` 特性）：

```ts
serializeNode(node, { verticalText: { digits: 'kanji' } });  // 导出管线逐字一致
```

`exporter-pdf` 的 `PrintDocumentOptions.verticalText` 透传到两条渲染路径（`auto` 流式 /
`paged` 逐页）；代码块逐字输出，不受转换影响。直排正文亦可直接用
`segmentForVertical(text, { longDigits: 'kanji' })` 得到汉字数字分段。

## 样式构建（内联声明）

```ts
import { buildRootStyle, buildPageStyle, buildCssVariables } from '@bibliotype/layout';
import { DEFAULT_THEME } from '@bibliotype/core';

/* 书页根容器：字体 / 字号 / 行高 / 字距 / 缩进 / 颜色 / 书写方向 / 分栏 */
const rootStyle = buildRootStyle({
  tokens: DEFAULT_THEME,             // ThemeAccessor.all() 或合并后的令牌表
  options: layoutOptions,
  fontToken: FONT_TOKENS.CLASSICAL_BODY,   // 可选：古籍正文字体键
});

/* 页面容器：固定尺寸 + 页边距（padding = page-margin 令牌） */
const pageStyle = buildPageStyle(layoutOptions.pageSize, DEFAULT_THEME);

/* CSS 自定义属性层：令牌 → --bt-* 变量 */
const variables = buildCssVariables(DEFAULT_THEME);
// { '--bt-font-family-body': '…', '--bt-color-text': '#2c2c2c', … }
```

均为纯函数，返回 kebab-case 声明对象，渲染层直接套用即可。

## 分页器

`paginate` 细节见 [04 阅读器与分页](04-reader-and-pagination.md)：

```ts
import { paginate, type MeasurableBlock } from '@bibliotype/layout';

const blocks: MeasurableBlock[] = [{ id: 'p-1', mainSize: 120, keepWithNext: true }];
const { pages, totalPages, totalBlocks } = paginate(blocks, { pageMainSize: 640 });
```

### 页底注区（脚注浮注）

块标 `floatToBottom: true` 且开启 `noteArea` 时，脚注不进正文流，而是落在所在页的页底注区：

```ts
const { pages } = paginate(
  [
    { id: 'p-1', mainSize: 200 },
    { id: 'fn-1', mainSize: 60, floatToBottom: true }, // 脚注
    { id: 'p-2', mainSize: 250 },
  ],
  { pageMainSize: 600, noteArea: { maxRatio: 0.4 } },
);

pages[0]?.items;        // 正文片段（p-1、p-2），不含脚注
pages[0]?.notes;        // 页底注片段（fn-1）
pages[0]?.noteMainSize; // 注区占高 60 → 正文容量降为 540
```

- 正文可用容量 = 页面容量 − 本页注区高度，即**注区动态收缩正文**（注文越高，正文越短）；
- 注区上限 = 容量 × `maxRatio`（缺省 0.4）；超出上限时注文**整条续到下一页页底**（跨页续注）；
- 单条注超过上限也独占一页（不死循环），由渲染侧截断 / 拆条；
- 未开启 `noteArea` 时行为与旧版完全一致（页对象不出现 `notes` / `noteMainSize`）。

阅读器侧由 `Reader({ footnoteFloat: true, noteMaxRatio })` 自动把 `footnote` 块标 `floatToBottom` 并开启注区，
注文经 `getPageNoteItems` / `getPageNotes` / `getPageNoteMainSize` 取用（[04 阅读器与分页](04-reader-and-pagination.md#脚注浮注页底注区)）。

## HTML 序列化（`@bibliotype/layout/html`）

子入口与主入口分离：测量 / 分页场景不引入 HTML 输出代码。

```ts
import { serializeNode, escapeHtml, buildBookCss, declarationToCss } from '@bibliotype/layout/html';
```

### serializeNode / escapeHtml

```ts
const html = serializeNode(node, {
  tagOverrides: { 'double-note': 'aside' },   // 类型 → 标签覆盖（优先级最高，插件节点定制）
  anchorIds: plan.anchors,                    // 无 id 节点注入锚点（EPUB 目录跳转依赖）
});
```

规则：

- XHTML 兼容输出：void 元素自闭合、属性双引号、实体转义（`escapeHtml`）；
- 内置 core 全部节点的标签映射（`paragraph → p`、`quote → blockquote`、
  `chapter → section`、`toc → nav`、`footnote → aside` 等）；
  未知类型按容器启发式兜底（有元素子节点 → `div`，否则 `span`）；
- 每个元素输出 `class="bt-{type}"`，与 `buildBookCss` 的类样式配套；
- marks 数组索引 0 为最内层，序列化时自内向外逐层包裹；
- 非白名单属性统一输出为 `data-*`，语义信息不丢失。

### 修订视图（`revisionView`）

`SerializeNodeOptions.revisionView` 在**序列化边界**投影修订（C5），编辑器内部文档始终保留原文：

| 值 | 输出 | 用途 |
| --- | --- | --- |
| `'marked'`（序列化器缺省） | 三类标记全部保留为 `ins` / `del` / `span` + `data-change-id` / `data-author` / `data-timestamp` | 编辑留痕、审阅 |
| `'final'` | 接受全部：删除内容不输出、插入去标 | **导出默认**（EPUB / PDF / 站点） |
| `'original'` | 拒绝全部：插入内容不输出、删除去标 | 呈现原稿 |

```ts
serializeNode(document.root, { revisionView: 'final' });    // 导出终稿
serializeNode(document.root, { revisionView: 'marked' });   // 带修订标记版
```

- 投影只作用于**文本叶子**：`resolveMarksForView` 判定整段隐藏时返回空串，元素结构与 id 不受影响；
- `format-change` 在标记视图不改变字形（赭黄虚线由 CSS 给出）；`previous` 镜像只在 IR / 撤销栈，不写进 DOM；
- 导出器（`exporter-epub` / `exporter-pdf` / `exporter-site`）的 `revisionView` 选项缺省 `'final'`，
  需要留痕交付时显式传 `'marked'`；
- 非法值按缺省 `'marked'` 处理，不抛错（旧宿主传错参数不会直接毁掉导出）。

三个标记的样式由 `buildBookCss` 在根容器内 scoped 输出：`.bt-mark-insertion` 墨绿下划线、
`.bt-mark-deletion` 朱红删除线 + 灰字、`.bt-mark-format-change` 赭黄虚线下划线——只用文字装饰，
不加色块，直排下不压字。取舍：相比「删除即丢内容 + 旁路记录」，保留内容让拒绝可无损还原，
代价是修订态文档体积增大、终稿必须投影，因此导出前统一走 `final`。

### buildBookCss / declarationToCss

```ts
const css = buildBookCss({
  tokens: DEFAULT_THEME,
  options: layoutOptions,
  fontToken: FONT_TOKENS.CLASSICAL_BODY,       // 可选
  containerSelector: '.bt-reader-page',          // 默认 'body'；阅读器可指向自身容器
  pageDecoration: false,                         // 默认 false：古籍仿真装饰图层开关
});
```

产物三段：`:root` 输出 `--bt-*` 变量；根容器规则经 `var()` 引用变量（书写方向 /
直排策略 / 分栏随布局选项）；`.bt-*` 节点类样式（限定在根容器内，避免样式泄漏）。

`pageDecoration` 只由**固定分页渲染路径**开启（阅读视图 / 编辑分页 / 打印 `paged`），
且还要求布局带 `facsimile` 与直排（三重闸门）。EPUB（reflow）、连续编辑画布、
量尺表一律不开启，故「现代横排 / 古籍直排」的样式表逐字符不变。

## 缺字合成与回退链（K6）

分三层：`core` 决策、`layout` 渲染、导出器报告。

### 解析与回退（core）

```ts
import { parseIds, resolveGlyphFallback, collectGlyphIssues } from '@bibliotype/core';

const parsed = parseIds('⿰山夆'); // { tree, issues }
resolveGlyphFallback('𫞩', {
  families: ['Songti'],
  probe,                       // (char, family) => boolean；缺省视为全部命中
  idsFor: (char) => ids.get(char),
});
// { stage: 'font' | 'ids' | 'tofu', family?, idsTree?, missing, privateUse, … }
```

- 回退顺序固定：主字体链 → IDS 合成 → 方框（`stage: 'tofu'`）；
- IDS 结构不完整（缺组件 / 超深）**不参与合成**，避免拼出错字；
- `parseIds` 支持 U+2FF0–U+2FFB 全部 12 个运算符（含 `⿲` / `⿳` 三组件）。

### 合成渲染（layout）

```ts
import { renderIdsSvg, renderIdsGlyphHtml } from '@bibliotype/layout';

renderIdsSvg({ description: '⿰山夆', frame: true });
renderIdsGlyphHtml('⿰山夆');
// <span class="bt-glyph bt-glyph--ids" data-ids="⿰山夆"><svg …></svg></span>
```

纯字符串、零依赖、零随机：同一描述逐字节一致，可直接快照。书册样式 `.bt-glyph`
把 SVG 按 1em 内联并下沉基线，颜色取 `currentColor`（换主题无需额外规则）。

### 序列化替换

`serializeNode(node, { glyph })` 逐字符回调：返回片段则替换该字符，返回 `undefined`
按原文转义输出；**片段视为已转义的受信 HTML**（通常由 `renderIdsGlyphHtml` 产出）。
不传 `glyph` 时产物与旧版逐字节一致。

### 导出前报告

```ts
collectGlyphIssues(document, { families, probe, idsFor }); // core：带 path / context / code
collectEpubGlyphProblems(document, options);               // exporter-epub：warning 级 ValidationProblem[]
collectPdfGlyphProblems(document, options);               // exporter-pdf：GlyphIssue[]
```

报告只警告、不阻断导出（补字是作者决策）；Vue 侧 `useGlyphAudit` + `BtGlyphAuditPanel`
在设置面板展示缺字清单，导出时由 demo 弹消息条提示。

## 页底注区序列化（B5）

`serializePageNotes(notes, options)` 把分页器已算出的 `page.notes` 序列化为页底注区 HTML：

- 容器 `bt-page-notes`，每条 `bt-page-note` 带 `data-note-id`，注文沿用节点自身 attrs（注码 / 编号由注文节点提供）；
- `continued` 为真时输出「续前页」标记（`bt-note-continued`）；**不输出「接下页」** —— 分页器不知道注文后续是否还有内容，不臆造标记；
- `overflow` 为真时给注区加 `data-overflow="true"` 仅作告警，不裁剪（按行拆条属于分页内核职责）；
- 样式由 `buildBookCss` 输出（`.bt-page-notes` / `.bt-page-note` / `.bt-note-continued`）：与正文等宽、顶部 `border-block-start` 分隔线，直排按列宽收束。

### 注码 / 注文的可定位契约（D9）

注释序列化在原有类名之外补充两个**稳定锚点**，供阅读器做事件委托，不改 `epub:type` 语义：

| 输出 | 位置 | 含义 |
| --- | --- | --- |
| `data-note-id="<节点 id>"` | 注释块（`aside` / `div`）自身 | 注文锚点：正文流里的注文（未浮注）也有，页底注区容器同样带此属性 |
| `data-note-ref="<refId>"` | `.bt-note-marker` | 注码 → 正文引用：`refId` 同时用于 `bt-note-backref` 的 `href` |
| `id="ref-…"` / `href="#<noteId>"` | `.bt-mark-noteref` | 正文注码：`id` 供回跳，`href` 供跳注 |
| `href="#<refId>"` | `.bt-note-backref` | 回跳链接（`↩`） |

激活态（点击注码 / 回跳时由阅读器加类，约 2s 后移除）：

- `.bt-note-active`：注释条目整体浅强调色底 + `background-color` 过渡；`.bt-mark-noteref.bt-note-active` / `.bt-note-marker.bt-note-active` 用更深的强调色；
- 规则仍在 `scoped('.bt-reader-page')` 段内，不进全局选择器；`prefers-reduced-motion: reduce` 下去掉过渡。

> 交互实现（跳转、回跳、预览、快捷键）见 [31 注释交互](31-notes.md)，序列化只负责契约与样式。

## 分栏 / 对页 / 分栏符（P1-A）

- **分栏**：`chapter` / `section` 的 `attrs.columns`（1~3）经 `extractBlocks` 传给 `MeasurableBlock.columns`；分页器按「页容量 × 栏数」装箱，栏数变化开新页，产物页带 `page.columns`。
- **渲染**：`BtBookView` 在正文流上按页设置 `column-count` + `column-fill: auto`，子块 `break-inside: avoid`；多栏量尺按栏宽（页宽扣栏间距后均分）实测。
- **对页**：`BtBookView` 新增 `spread="facing"`，左右并排渲染相邻两页（偶数页在左），缩放按双页宽计算；EPUB 仍为重排流，不套对页。
- **分栏符**：`break(variant='column')` + `insertColumnBreak`；CSS `break-before: column`，单栏退化为细分隔标记。分页器不重算列填充（列内断点由 CSS 执行），极端情况下可能留白。

## 相关

- 包参考：[`@bibliotype/layout`](../packages/layout/README.md)
- 分页与阅读状态机：[04 阅读器与分页](04-reader-and-pagination.md)
- 令牌体系：[11 主题与令牌](11-theme-tokens.md)
- 修订标记与接受 / 拒绝：[02 编辑器与插件](02-editor-and-plugins.md#修订模式c5)
