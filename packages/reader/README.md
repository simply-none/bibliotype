# @bibliotype/reader

阅读器状态机（无 DOM）：内容块抽取 → 分页 → 翻页 / 跳转 / 目录 / 全文搜索 / 页码。
渲染交给框架封装（`@bibliotype/vue`）或使用方自行实现。

## 安装

```bash
pnpm add @bibliotype/reader @bibliotype/core @bibliotype/layout
```

## 快速上手

```ts
import { Reader } from '@bibliotype/reader';

const reader = new Reader();          // 可传 layout / pageMainSize / measure / estimator / footnoteFloat
reader.loadDocument(document);        // BookDocument（IR）

/* 翻页与进度 */
reader.nextPage();
console.log(reader.currentPage, reader.totalPages, reader.progress);

/* 按节点 id 跳转（叶块与结构容器均支持，容器定位到其首叶所在页） */
reader.goToNode('ch-2-p-1');

/* 当前页展示页码（按 pageNumberStyle 格式化：decimal / chinese / roman） */
console.log(reader.formatCurrentPageNumber());

/* 全文搜索：返回带页号与上下文摘录的结果，nodeId 可直接用于 goToNode */
const results = reader.search('学而');
if (results[0] !== undefined) reader.goToNode(results[0].nodeId);

/* 订阅事件（document:load / page:change / toc:ready） */
const off = reader.events.on('page:change', ({ pageIndex, totalPages }) => {
  console.log(`第 ${pageIndex + 1} / ${totalPages} 页`);
});

/* 配置变更后重排（保持当前页） */
reader.repaginate({ layout: { columns: 2 } });

off();
```

## API 概览

### `Reader` 类

| 成员 | 说明 |
| --- | --- |
| `new Reader(options?)` | `layout`（局部覆盖默认布局）/ `pageMainSize` / `measure` / `estimator` / `events` / `footnoteFloat`（脚注浮注）/ `noteMaxRatio`（注区占页面主轴比例，缺省 0.4） |
| `loadDocument(doc)` | 载入文档：提取块 → 分页 → 建目录 → 触发事件 |
| `repaginate(overrides?)` | 重新分页（布局 / 主轴尺寸 / 估算上下文变更），保持当前页 |
| `document` / `layout` | 当前文档与布局配置 |
| `currentPage` / `totalPages` / `progress` | 阅读状态（progress 按已读至页尾计，0~1） |
| `outline` | 目录树（`OutlineItem[]`） |
| `allBlocks` / `pagination` / `getPageBlocks(i)` | 分页前块序列 / 分页结果 / 某页的块 |
| `getPageNodes(i)` | 某页正文 IR 节点（块 id 经块索引还原） |
| `getPageNoteItems(i)` / `getPageNotes(i)` / `getPageNoteMainSize(i)` | 页底注条目 / 注节点 / 注区占高（`footnoteFloat` 开启时） |
| `getPageGutterTexts(i)` | 版心（书口）竖写文本：书名 / 篇卷 / 叶次；未启用仿真版式或封面页返回 `undefined` |
| `getPageOfNode(id)` | 节点所在页（叶块 → 该页；结构容器 → 首个叶所在页），读预建索引、不遍历文档 |
| `getOutlineItemAtPage(i)` | 某页对应的最具体目录项（同页多标题取层级最深者），目录高亮用 |
| `getNoteAnchors()` / `getPageOfNote(id)` | 注释定位表（文档顺序，含 `noteId` / `refId` / `pageIndex`）/ 注文所在页 |
| `getPageOfNoteRef(refId)` | 注引用锚点所在页（注文回跳跨页用，`refId` 来自 `NOTE_REF` 标记） |
| `formatCurrentPageNumber()` | 当前页展示页码 |
| `search(query, options?)` | 全文搜索（`limit` 默认 50、`contextLength` 默认 12） |
| `nextPage()` / `prevPage()` / `goToPage(i)` / `goToNode(id)` | 导航（越界 / 未命中返回 false） |

### 独立函数

- **块提取**：`extractBlocks`（`isLeafBlock` 判定原子叶块，注释容器等恒为叶块）、
  `collectNodeText`、`defaultEstimator`、`DEFAULT_MEASURE_CONTEXT`；
- **块定位**：`findNodeById(root, id)`（深度优先按稳定 id 查找）；
- **目录**：`extractOutline`、`resolveNodeTitle`、`countOutlineItems`、`OUTLINE_STRUCTURE_TYPES`；
- **页码**：`formatPageNumber(n, style)`、`toChineseNumeral(n)`、`toRomanNumeral(n)`；
- **版心**：`resolvePageGutterTexts({ bookTitle, chapterTitle, pageNumberText })`（去空白后交给
  `@bibliotype/layout/html` 的 `serializePageGutter` 序列化，三端同源）。

## 工作机制

```text
BookDocument ──extractBlocks──▶ MeasurableBlock[] ──paginate──▶ PaginatedPage[]
     │                                   （layout 分页器）
     └─extractOutline──▶ 目录树（卷 / 章 / 节…）
```

- 块序列仅含**叶块**（稳定 id + 估算尺寸）；分页由 `@bibliotype/layout` 的贪心分页器完成；
- 结构容器 id（目录项）通过“首叶锚点”映射到页码，因此 `goToNode` 对容器同样有效；
- 注释容器（脚注 / 尾注 / 边注 / 双行小注等）恒判为原子叶块，样式与 id 在分块时整体保留；
- `footnoteFloat: true` 时脚注块标 `floatToBottom`，不进正文流：落所在页页底注区、正文容量按注区
  扣减，注区超过 `noteMaxRatio` 时整条续到下一页页底（尾注 / 边注不受影响）；
- 表格是复合原子块：`table` 整体成块，不下钻到 `table-row` / `table-cell`，分页与序列化保留完整
  `<table>` 包裹（否则页面会丢失表格）。

## 相关

- 功能参考：[docs/04-reader-and-pagination.md](../../docs/04-reader-and-pagination.md)
- Vue 响应式封装：[`@bibliotype/vue`](../vue/README.md)
- 仓库主页：[bibliotype](../../README.md)
