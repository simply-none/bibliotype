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

## 相关

- 包参考：[`@bibliotype/layout`](../packages/layout/README.md)
- 分页与阅读状态机：[04 阅读器与分页](04-reader-and-pagination.md)
- 令牌体系：[11 主题与令牌](11-theme-tokens.md)

## 页底注区（B5）

`serializePageNotes(notes, options)` 把分页器已算出的 `page.notes` 序列化为页底注区 HTML：

- 容器 `bt-page-notes`，每条 `bt-page-note` 带 `data-note-id`，注文沿用节点自身 attrs（注码 / 编号由注文节点提供）；
- `continued` 为真时输出「续前页」标记（`bt-note-continued`）；**不输出「接下页」** —— 分页器不知道注文后续是否还有内容，不臆造标记；
- `overflow` 为真时给注区加 `data-overflow="true"` 仅作告警，不裁剪（按行拆条属于分页内核职责）；
- 样式由 `buildBookCss` 输出（`.bt-page-notes` / `.bt-page-note` / `.bt-note-continued`）：与正文等宽、顶部 `border-block-start` 分隔线，直排按列宽收束。
