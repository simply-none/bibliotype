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
- 超大块：可拆者按每页行数连续跨页，不可拆者独占一页；直排「主轴」为横向，`mainSize` 由调用方按书写方向传入。
- 不传 `splittable` / `lineSize` / `widowControl` 时，行为与块原子版完全一致。

### HTML 序列化与书册样式表（`./html`）

```ts
import { serializeNode, escapeHtml, buildBookCss } from '@bibliotype/layout/html';

const html = serializeNode(node);   // IR 节点 → 语义 HTML（缺元素子节点时用 span，否则 div）
const css = buildBookCss({
  tokens: DEFAULT_THEME,
  options: layout,
  containerSelector: '.bt-reader-page',   // 样式作用域（可省略）
});
```

## API 概览

| 分组 | 导出 |
| --- | --- |
| 书写方向 | `WRITING_MODES`、`TEXT_ORIENTATIONS`、`isVerticalMode` |
| 页面尺寸 | `PAGE_SIZES`、`createPageSize`、`resolveContentBox` |
| 直排合并 | `SEGMENT_KINDS`、`segmentForVertical`、`combineUprightCss`、`needsCombineUpright` |
| 布局配置 | `DEFAULT_LAYOUT_OPTIONS`、`CLASSICAL_LAYOUT_OPTIONS`、`PAGE_NUMBER_STYLES`、`mergeLayoutOptions` |
| 样式构建 | `buildRootStyle`、`buildPageStyle`、`buildCssVariables` |
| 分页 | `paginate`（`MeasurableBlock` / `PageItem` / `PaginatedPage` / `PaginationResult` / `WidowControl`） |
| `./html` | `serializeNode`、`escapeHtml`、`buildBookCss`、`declarationToCss` |

## 相关

- 功能参考：[docs/05-layout-and-html.md](../../docs/05-layout-and-html.md)
- 主题令牌：[docs/11-theme-tokens.md](../../docs/11-theme-tokens.md)
- 仓库主页：[bibliotype](../../README.md)
