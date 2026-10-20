# 04 阅读器与分页

> 涉及包：`@bibliotype/reader`（消费 `@bibliotype/layout`）　·　相关：[01 数据模型](01-document-model.md)、[05 版式与 HTML](05-layout-and-html.md)、[06 Vue 集成](06-vue-integration.md)

`Reader` 是**无 DOM 的阅读状态机**：聚合「文档 + 布局 + 分页 + 目录」，提供翻页、跳转、
搜索、进度与事件；DOM 渲染交给封装层（如 `BtBookView`）。

## 构造与载入

```ts
import { Reader } from '@bibliotype/reader';
import { DEFAULT_LAYOUT_OPTIONS, CLASSICAL_LAYOUT_OPTIONS } from '@bibliotype/layout';

const reader = new Reader({
  layout: { pageSize: /* 覆盖局部 */ },   // 基于 DEFAULT_LAYOUT_OPTIONS 合并
  pageMainSize: 640,                       // 每页可用主轴尺寸 px；缺省按页面尺寸与页边距推导
  measure: { charsPerLine: 30 },           // 估算上下文覆盖（字号/行距变化时联动重算）
  estimator,                               // 自定义块尺寸估算器（缺省 defaultEstimator）
  events,                                  // 外部事件总线（与 core 实例共享）；缺省自建
});

reader.loadDocument(document);             // 提取块 → 分页 → 建目录 → 触发事件
```

载入流程与事件：

```text
loadDocument
  ├─ extractOutline(root)            → 目录树（卷/章/节）
  ├─ emit('document:load')           
  ├─ repaginate()
  │    ├─ extractBlocks(doc)         → 线性叶块序列（结构容器首块 + h1/h2 标题 breakBefore）
  │    ├─ paginate(blocks)           → 页编排（keepWithNext 等）
  │    ├─ 索引块→页映射 + 容器锚点（容器 id → 首叶所在页）
  │    └─ emit('page:change')
  └─ emit('toc:ready')
```

事件总线可自建，也可与 core 实例共享同一订阅面（实例内插件与外部观察者事件同源）：

```ts
import { createBibliotype } from '@bibliotype/core';

const instance = createBibliotype();
const reader = new Reader({ events: instance.events });   // 共享实例总线（见 13 核心运行时）

reader.events.on('page:change', ({ pageIndex }) => { /* 翻页 / 重排后同步 */ });
```

## 重排（配置变更）

```ts
reader.repaginate({
  layout: { pageSize: PAGE_SIZES.A4 },     // 局部覆盖，与当前配置合并
  pageMainSize: 720,
  measure: { lineSize: 36 },               // 字号变大 → 行尺寸联动
});
```

重排保持当前页（越界时收敛到末页）。未载入文档时调用会抛错。

## 状态读取

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `document` | `BookDocument \| undefined` | 当前文档 |
| `layout` | `LayoutOptions` | 当前布局配置 |
| `currentPage` / `totalPages` | `number` | 当前页（自 0 起）/ 总页数 |
| `progress` | `number` | 阅读进度 0~1（按已读至的页尾计） |
| `outline` | `readonly OutlineItem[]` | 目录树 |
| `allBlocks` / `pagination` | 只读 | 分页前块序列 / 分页结果 |
| `getPageBlocks(i)` | `readonly MeasurableBlock[]` | 某页的块（含 `mainSize`） |
| `getPageNodes(i)` | `readonly BookNode[]` | 某页的 IR 节点（块 id 经 `findNodeById` 还原） |
| `formatCurrentPageNumber()` | `string` | 当前页展示页码（按 `pageNumberStyle` 格式化） |
| `events` | `EventBus<BibliotypeEventMap>` | 事件总线（只读）；载入 / 分页 / 目录事件由此触发 |

## 导航

```ts
reader.nextPage();        // 下一页（返回是否发生翻页）
reader.prevPage();        // 上一页
reader.goToPage(3);       // 跳转页码（越界返回 false 且不移动）
reader.goToNode('ch-2');  // 按节点 id 跳页（支持叶块 id 与结构容器 id）
```

`goToNode` 目标无 id / 不在块序列中返回 `false`；目录项、搜索结果及上层应用（如 demo 书签面板）均基于它跳转。

## 全文搜索

```ts
const results = reader.search('学而时习之', { limit: 50, contextLength: 12 });
// [{ nodeId, pageIndex, blockType, excerpt, matchCount }, …]

if (results[0]) reader.goToNode(results[0].nodeId);
```

按块级文本做**大小写敏感的字面子串匹配**，逐页扫描叶块；`excerpt` 为带省略号的
上下文摘录（命中词前后各 `contextLength` 字符）。

## 底层工具（单独可用的纯函数）

```ts
import {
  extractBlocks, defaultEstimator, collectNodeText, isLeafBlock,
  findNodeById, extractOutline, resolveNodeTitle, countOutlineItems,
  formatPageNumber, toChineseNumeral, toRomanNumeral,
  DEFAULT_MEASURE_CONTEXT,
} from '@bibliotype/reader';
import { paginate } from '@bibliotype/layout';

const blocks = extractBlocks(document, {
  estimator: defaultEstimator,              // (node, context) => number
  context: DEFAULT_MEASURE_CONTEXT,         // { charsPerLine: 26, lineSize: 30, blockSpacing: 12 }
});
const result = paginate(blocks, { pageMainSize: 640 });
// result: { pages: PaginatedPage[], totalPages, totalBlocks }

const pageNo = formatPageNumber(12, 'chinese');   // '十二'（decimal / chinese / roman）
```

`extractBlocks` 的块规则：

- 结构容器（封面 / 卷 / 章 / 节 / 序 / 附录 / 目录等）逐层深入，**首块标记 `breakBefore`**（另起页）；
- 叶块（纯文本容器）各自成块；含「行内载体」子元素的块不拆开（随父块整体度量）；
- **版式文本容器**（注文 / 牌记 / 题记等）无论子级形态恒整体成块（编辑保存规范化后样式与 id 不丢失）；
- **表格是复合原子块**：`table` 整体成块（`COMPOSITE_ATOMIC_TYPES`），不再逐层下钻到 `table-row` / `table-cell`；
  否则块序列只剩单元格段落，序列化会丢失 `<table>` 包裹、页面上表现为空白（详见 [21 表格编辑](21-table-editing.md)）；
- **h1 / h2 标题另起页**：章 / 节级标题（`attrs.level` ≤ `HEADING_BREAK_BEFORE_MAX_LEVEL`，缺省 2）仿纸质书从新页页首起排，标记 `breakBefore`；h3~h6 不强制另起页。该标记与结构容器首块标记、分页符标记正交，主轴方向由调用方按书写方向传尺寸，**横排与直排同逻辑**；
- 标题块标记 `keepWithNext`（与下段同页）。

## 分页规则（layout.paginate）

| 场景 | 规则 |
| --- | --- |
| 贪心装箱 | 块沿主轴累加，超页换页 |
| `breakBefore` / `breakAfter` | 强制换页（章首 / 卷末 / h1·h2 标题；横排与直排同逻辑，由 `extractBlocks` 产出 `breakBefore`） |
| `keepWithNext` | 与下一块同页；放不下则整体换页（下一块强制换页时不连坐；下块可拆时仅要求头部 minFirst 行同页） |
| 行级拆分（`splittable` + `lineSize`） | 装不下的正文段落在行处断开跨页续排，页输出 `items: PageItem[]`（`fromLine` / `lineCount`）；未拆分时 `lineCount=0` 按整块渲染，`blocks` 字段向后兼容 |
| 孤寡行控制（`widowControl`） | 拆分后首页片段 ≥ minFirst 行、末页片段 ≥ minLast 行（默认 2 / 2），不满足则让行或整体换页 |
| 超大块 | 可拆者按每页容纳行数连续跨页；不可拆者独占一页（避免死循环） |
| 表格 | 复合原子块：不标 `splittable`，整块占位；超大表独占一页，不拆行 / 单元格 |
| 非法输入 | `pageMainSize <= 0` 或块尺寸为负抛 `RangeError` |

不传 `splittable` / `lineSize` / `widowControl` 时，行为与块原子版完全一致；行级拆分能力的消费方接入见 [18 纸书排版引擎路线图](18-pagination-engine-roadmap.md)（Phase 3 / 4）。

### 与古籍仿真版式的关系

`resolvePageMainSize` / `resolvePageCrossSize` 会按需扣除版框与版心：

- **古籍直排 / 现代横排**（无 `facsimile`）：扣除 `page-border` 边框，口径与既往一致；
- **古籍仿真直排**（`facsimile` 非空）：版框画在页边距内、**不扣除**（与 `page-border` 成对失效），只从直排主轴扣除版心带宽 `facsimile.gutter.size`；
- 版心带宽与两个仿真字体族令牌进入 `computeMetricsSignature`，改框色 / 界行色 / 纸色不会触发重排。

详见 [22 古籍仿真直排](22-facsimile-vertical.md)。

## 相关

- 包参考：[`@bibliotype/reader`](../packages/reader/README.md)
- 分页器与样式构建：[05 版式与 HTML](05-layout-and-html.md)
- Vue 响应式绑定：[06 Vue 集成](06-vue-integration.md)
