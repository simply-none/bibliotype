# @bibliotype/layout

排版基础设施：书写方向、页面尺寸、布局配置、直排数字合并、样式构建与分页器；
`./html` 子入口提供 IR → HTML 序列化与书册样式表（CSS）构建。

纯函数、无 DOM 依赖，浏览器 / Node / SSR 通用。

## 安装

```bash
pnpm add @bibliotype/layout @bibliotype/core
```

## 快速上手

### 布局配置与样式构建

```ts
import {
  DEFAULT_LAYOUT_OPTIONS,
  mergeLayoutOptions,
  buildRootStyle,
  buildPageStyle,
  buildCssVariables,
} from '@bibliotype/layout';
import { DEFAULT_THEME } from '@bibliotype/core';

/* 古籍布局：直排右起 + 16 开 + 中文页码 */
const layout = mergeLayoutOptions(DEFAULT_LAYOUT_OPTIONS, {
  writingMode: 'vertical-rl',
  columns: 1,
});

/* 令牌 + 布局 → CSS 声明对象（kebab-case，供 style 绑定或序列化） */
const rootStyle = buildRootStyle({ tokens: DEFAULT_THEME, options: layout });
const pageStyle = buildPageStyle(layout.pageSize, DEFAULT_THEME);
const cssVars = buildCssVariables(DEFAULT_THEME);   // --bt-* 自定义属性表
```

### 分页器

```ts
import { paginate } from '@bibliotype/layout';

/* 输入为「已测量高度的块」序列（测量由渲染层负责） */
const { pages, totalPages } = paginate(
  [
    { id: 'p-1', mainSize: 64 },
    { id: 'h-2', mainSize: 48, breakBefore: true, keepWithNext: true },
    /* 正文段落标 splittable + lineSize → 装不下时行级拆分跨页 */
    { id: 'p-2', mainSize: 700, lineSize: 30, splittable: true },
  ],
  { pageMainSize: 620, widowControl: { minFirst: 2, minLast: 2 } },
);
// pages[i].items → 行级片段（fromLine / lineCount）；pages[i].blocks → 向后兼容的块视图
```

- `breakBefore` / `breakAfter`：强制换页（章首 / 卷末）；
- `keepWithNext`：与下一块同页（标题 + 首段），放不下则整体换页（下块可拆时仅要求头部 minFirst 行同页）；
- **行级拆分**：块标 `splittable: true` 且给 `lineSize` 时，装不下的段落在行处断开跨页续排（页固定、正文流动）；
- **孤寡行控制**：`widowControl.minFirst` / `minLast`（默认 2 / 2）约束拆分后首 / 尾片段最少行数，不满足则让行或整体换页；
- **逐行行盒**：给 `lineMainSizes`（实测逐行尺寸，长度即行数）时按行累加判页，注音等行高不等不再溢出；缺省回退均高 `lineSize`；
- 超大块：可拆者按每页行数连续跨页，不可拆者独占一页；直排「主轴」为横向，`mainSize` 由调用方按书写方向传入。
- 不传 `splittable` / `lineSize` / `lineMainSizes` / `widowControl` 时，行为与块原子版完全一致。

### HTML 序列化与书册样式表（`./html`）

```ts
import { serializeNode, escapeHtml, buildBookCss } from '@bibliotype/layout/html';

const html = serializeNode(node);   // IR 节点 → 语义 HTML（缺元素子节点时用 span，否则 div）
// 竖排书刊可显式替换标点 / 数字：serializeNode(node, { verticalText: { digits: 'kanji' } })
// 修订投影：'final' 导出终稿 / 'original' 原稿 / 缺省 'marked' 保留 ins+del 标记
serializeNode(node, { revisionView: 'final' });
const css = buildBookCss({
  tokens: DEFAULT_THEME,
  options: layout,
  containerSelector: '.bt-reader-page',   // 样式作用域（可省略）
});
```

修订标记的样式（`.bt-mark-insertion` / `.bt-mark-deletion` / `.bt-mark-format-change`）随
`buildBookCss` 输出，全部限定在根容器内，只用文字装饰、不加色块。

注释输出带**可定位锚点**，供阅读器做事件委托（详见 [docs/05](../../docs/05-layout-and-html.md#注码--注文的可定位契约d9)）：

- 注释块：`data-note-id="<节点 id>"`；
- 注码：`<span class="bt-note-marker" data-note-ref="<refId>">N</span>`；
- 回跳：`<a class="bt-note-backref" href="#<refId>">↩</a>`；正文注码：`<a id="<refId>" class="bt-mark-noteref" href="#<noteId>">`；
- 激活态：`.bt-note-active`（注条浅色底 + `.bt-mark-noteref` / `.bt-note-marker` 强化），仅在阅读器加类时命中，`prefers-reduced-motion` 下去掉过渡。

### 古籍仿真直排（版框 / 界行 / 版心）

```ts
import {
  FACSIMILE_PRESETS, resolveFacsimilePreset, applyFacsimilePreset,
  resolveFacsimileGrid, isFacsimileEnabled,
} from '@bibliotype/layout';

const preset = FACSIMILE_PRESETS[0];                 // 宋刻浙本（默认）
const layout = applyFacsimilePreset(baseLayout, preset);
const grid = resolveFacsimileGrid(layout, preset.tokens);
// grid.linesPerHalfLeaf / charsPerColumn → 每半页 10 行 × 27 字
```

- 与「古籍直排」**并列**：`LayoutOptions.facsimile` 缺省 `undefined`，未启用时
  样式表 / 版心尺寸 / 度量签名与既往完全一致；
- 只有版心带宽进主轴扣减，版框与界行画在页边距内（不侵占版心）；
- 六个模板：`song-zhe` / `ming-jiajing` / `qing-dianben` / `jiguge` / `zhushilan` / `jinxiang`。

## API 概览

| 分组 | 导出 |
| --- | --- |
| 书写方向 | `WRITING_MODES`、`TEXT_ORIENTATIONS`、`isVerticalMode` |
| 页面尺寸 | `PAGE_SIZES`、`H5_PAGE_SIZE`（340×560，非印刷开本故不进预设表）、`createPageSize`、`resolveContentBox` |
| 直排合并 | `SEGMENT_KINDS`、`segmentForVertical`（`longDigits: 'kanji'` 数字分组）、`combineUprightCss`、`needsCombineUpright` |
| 竖排细节 | `VERTICAL_PUNCTUATION_FORMS`、`verticalPunctuationOf`、`toVerticalPunctuation`、`toKanjiDigits`、`toFullwidthDigits`、`transformVerticalText`、`needsVerticalTextTransform` |
| 布局配置 | `DEFAULT_LAYOUT_OPTIONS`、`CLASSICAL_LAYOUT_OPTIONS`、`FACSIMILE_BASE_LAYOUT`、`PAGE_NUMBER_STYLES`、`mergeLayoutOptions` |
| 开本适配 | `PAGE_SIZE_MODES`（`auto` 页框铺满舞台盒 / `h5` 340 页宽 + 单栏 / `fixed` 严格按开本 px）、`DEFAULT_PAGE_SIZE_MODE`、`resolvePageSizeMode`（缺省与脏值归一为 `fixed`）、`applyPageSizeMode`（声明布局 + `StageBoxSize` → 折算真实 `pageSize` / `columns`；仿真版式与未量到舞台时不动） |
| 样式构建 | `buildRootStyle`、`buildPageStyle`、`buildCssVariables` |
| 古籍仿真 | `FACSIMILE_PRESETS`、`resolveFacsimilePreset`、`applyFacsimilePreset`、`resolveFacsimileGrid`、`resolveLinePitch`、`isFacsimileEnabled`、`FACSIMILE_FRAMES`、`FACSIMILE_RULES` |
| 分页 | `paginate`（`MeasurableBlock` / `PageItem` / `PaginatedPage` / `PaginationResult` / `WidowControl`） |
| 印章与缺字 SVG | `renderSealSvg`（白文 / 朱文印谱）、`renderIdsSvg` / `renderIdsGlyphHtml`（IDS 缺字合成，纯字符串、零依赖、同描述逐字节一致） |
| `./html` | `serializeNode`（含 `revisionView` / `verticalText` / `anchorIds` / `glyph` 选项；`glyph` 逐字替换缺字，片段视为已转义受信 HTML）、`escapeHtml`、`buildBookCss`、`declarationToCss`、`serializePageGutter`、`serializePageNotes` |

## 相关

- 功能参考：[docs/05-layout-and-html.md](../../docs/05-layout-and-html.md)
- 主题令牌：[docs/11-theme-tokens.md](../../docs/11-theme-tokens.md)
- 仓库主页：[bibliotype](../../README.md)
