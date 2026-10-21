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
  footnoteFloat: true,                     // 脚注浮注：脚注落页底注区（缺省关闭）
  noteMaxRatio: 0.35,                      // 注区最多占页面主轴的 35%（缺省 0.4）
});

reader.loadDocument(document);             // 提取块 → 分页 → 建目录 → 触发事件
```

载入流程与事件：

```text
loadDocument
  ├─ extractOutline(root)            → 目录树（卷/章/节）
  ├─ emit('document:load')           
  ├─ repaginate()
  │    ├─ extractBlocksIndexed(doc)  → 线性叶块序列 + 块 id→节点索引
  │    │                              （结构容器首块 + h1/h2 标题 breakBefore；浮注开启时脚注块标 floatToBottom）
  │    ├─ paginate(blocks)           → 页编排（keepWithNext / 页底注区等）
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
| `getPageBlocks(i)` | `readonly MeasurableBlock[]` | 某页正文块（含 `mainSize`；不含页底注） |
| `getPageNodes(i)` | `readonly BookNode[]` | 某页正文 IR 节点（块 id 经块索引还原） |
| `getPageNoteItems(i)` | `readonly PageItem[]` | 某页页底注条目（脚注浮注开启时；含续注片段） |
| `getPageNotes(i)` | `readonly BookNode[]` | 某页页底注的 IR 节点 |
| `getPageNoteMainSize(i)` | `number` | 某页注区占用的主轴尺寸（px；未开启 / 无注为 0） |
| `formatCurrentPageNumber()` | `string` | 当前页展示页码（按 `pageNumberStyle` 格式化） |
| `events` | `EventBus<BibliotypeEventMap>` | 事件总线（只读）；载入 / 分页 / 目录事件由此触发 |

## 脚注浮注（页底注区）

`footnoteFloat: true` 时，`footnote` 类型节点不再进正文流，而落在**所在页的页底注区**：
正文可用容量按注区高度收缩，注区超过 `noteMaxRatio`（0~1，缺省 0.4，夹到 5%~100%）
时整条续到下一页页底（跨页续注）。

```ts
const reader = new Reader({ footnoteFloat: true, noteMaxRatio: 0.4 });
reader.loadDocument(document);

reader.getPageBlocks(0);       // 正文块（不含脚注）
reader.getPageNotes(0);        // 页底注 IR 节点
reader.getPageNoteItems(0);    // 注条目（block / fromLine / lineCount / mainSize）
reader.getPageNoteMainSize(0); // 注区占高 → 正文容量 = pageMainSize − 本值
```

- 只浮 **`footnote`**：`endnote`（书末 / 篇末注）与 `margin-note`（边注）仍随正文流；
- 注块不在 `getPageBlocks` / `page.items` 里，也不计入 `usedMainSize`，渲染侧按
  `getPageNoteMainSize` 在版心底部预留注区；注区内的条目保持文档顺序；
- 注文可 `goToNode` 定位（落在其所在页）、可被 `search` 命中（搜索范围含页底注）；
- 关闭时（缺省）行为与旧版完全一致：注文就地排，页对象不出现 `notes` / `noteMainSize`；
- 分页内核语义见 [05 版式与 HTML](05-layout-and-html.md#页底注区脚注浮注)。

## 导航

```ts
reader.nextPage();        // 下一页（返回是否发生翻页）
reader.prevPage();        // 上一页
reader.goToPage(3);       // 跳转页码（越界返回 false 且不移动）
reader.goToNode('ch-2');  // 按节点 id 跳页（支持叶块 id 与结构容器 id）
```

`goToNode` 目标无 id / 不在块序列中返回 `false`；目录项、搜索结果及上层应用（如 demo 书签面板）均基于它跳转。

### 节点 ↔ 页 查询（D6 / D9）

```ts
reader.getPageOfNode('ch-2');        // 节点所在页（叶块 → 该页；容器 → 首个叶所在页）
reader.getOutlineItemAtPage(3);      // 第 3 页对应的最具体目录项（祖先优先）
reader.getOutlineAnchorAtPage(3);    // 同上，但带定位键 key / 层级 / 起始页（目录高亮用 key）
reader.getNoteAnchors();             // [{ noteId, refId?, pageIndex }…]（文档顺序）
reader.getPageOfNote('fn-1');        // 注文所在页（未浮注 / 无该注时 undefined）
reader.getPageOfNoteRef('ref-1');    // 注引用锚点所在页（注文回跳跨页用）
```

- `getPageOfNode` / `getOutlineItemAtPage` 复用重排时建立的 `pageByBlockId`（容器 id → 首叶页），
  **查询不遍历文档**，可作为翻页热路径上的调用；
- `getOutlineItemAtPage` 取「页内最具体」的目录项：同页多个标题时取层级最深者，目录高亮即用它；
- `getPageOfNoteRef` 的 `refId` 来自 `NOTE_REF` 标记的 `attrs.refId`（注文回跳链接的锚点 id），
  索引在重排时一次建立：`refId → 页`；
- 均为只读查询，不触发重排、不改变当前页。

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
- **主轴标注 `axis`**：`extractBlocks(doc, { axis: 'column' })` 给可拆块标 `axis: 'column'`（直排），横排缺省 `'row'`；`lineSize` 在直排下即列宽。分页算术只认沿主轴的尺寸，故方向不影响装箱结果；
- 标题块标记 `keepWithNext`（与下段同页）。

## 分页规则（layout.paginate）

| 场景 | 规则 |
| --- | --- |
| 贪心装箱 | 块沿主轴累加，超页换页 |
| `breakBefore` / `breakAfter` | 强制换页（章首 / 卷末 / h1·h2 标题；横排与直排同逻辑，由 `extractBlocks` 产出 `breakBefore`） |
| `keepWithNext` | 与下一块同页；放不下则整体换页（下一块强制换页时不连坐；下块可拆时仅要求头部 minFirst 行同页） |
| 行级拆分（`splittable` + `lineSize`） | 装不下的正文段落在行处断开跨页续排（直排即「列」处断开，`axis='column'`、`lineSize` 为列宽），页输出 `items: PageItem[]`（`fromLine` / `lineCount`）；未拆分时 `lineCount=0` 按整块渲染，`blocks` 字段向后兼容 |
| 逐行行盒（`lineMainSizes`） | 注音（ruby）等行内增高使行高不等时，按实测逐行尺寸累加判页 / 结算片段（`lineRangeMainSize` 与渲染侧同口径）；缺省 / 长度不符回退均高 `lineSize`，行为与旧版一致 |
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

## 流式阅读（D5 `scroll-flow`）

将正文按「结构章节」切成扁平的 `FlowChunk` 列表，视图只挂载视口附近的分块，离开视口后卸载并以估算高度占位，从而替代一次性预分页——大部头首屏只渲染当前可见的少量内容。

### 分块（`buildFlowChunks`）

- 结构容器（`volume` / `chapter` / `section` / `preface` / `postscript` / `appendix`）作为**章边界**；章内按顶层子块切片；
- 块**不可再分**（表格 / 注文不会被切碎）；
- 双上限：`maxBlocksPerChunk`（默认 24）与 `maxCharsPerChunk`（默认 1200），**先到为准**；
- `FlowChunk` 携带 `key`（无 id 节点按文档序号合成稳定 key）、`containerId`、`title`（章标题，无障碍标签）、`level`、`nodeIds`、`startIndex`、`charCount`（高度估算用）；
- 纯函数、确定性，便于单测与宿主覆盖。

### 位置（`Reader` 增量 API）

- `getFlowChunks(options?)`：结果与分页无关，只随文档与选项缓存；
- `getNode(id)` / `getBlockIndex(id)`（结构容器取首个块序号）/ `getFlowChunkIndex(id, options?)`（含容器 id → 所在块）；
- `getPositionForNode(id, { savedAt? })`：进度 = 块序号 / 总块数，锚点用 `createBlockAnchor`，与既有 `restorePosition` 完全兼容——改字号 / 屏宽后位置不漂移。

### 视图侧（`packages/vue` `flow-model` 纯函数）

- `estimateFlowChunkHeight(chunk, metrics)`：字数 / 每行字数 × 行高 + 段距；
- `resolveMountWindow({ chunks, heights, offsets, scrollTop, viewportHeight, overscan? })`：求需挂载的 key 区间；
- `resolveAnchorChunkIndex(chunks, nodeId, options?)`：含祖先 / 首块回退；
- `adjustScrollOffset(prevHeights, nextHeights, scrollTop, anchorIndex)`：上方高度变化补偿，避免跳动。

`BtBookView` 在 `scroll-flow` 下按 `flowChunkBlocks`（默认 24）分块，首屏只挂载窗口内少数分块、其余为骨架占位；滚动以「视口首块」经 `getPositionForNode` 回写 `update:position`；`initialPosition` 解析后强制挂载目标块并滚到锚点。详见 [06 Vue 集成 · 多形态阅读](06-vue-integration.md#多形态阅读d5scroll-flow--双页对照)。

## 相关

- 包参考：[`@bibliotype/reader`](../packages/reader/README.md)
- 分页器与样式构建：[05 版式与 HTML](05-layout-and-html.md)
- Vue 响应式绑定：[06 Vue 集成](06-vue-integration.md)
