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
  │    ├─ extractBlocks(doc)         → 线性叶块序列（结构容器首块 breakBefore）
  │    ├─ paginate(blocks)           → 页编排（keepWithNext 等）
  │    ├─ 索引块→页映射 + 容器锚点（容器 id → 首叶所在页）
  │    └─ emit('page:change')
  └─ emit('toc:ready')
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
- 标题块标记 `keepWithNext`（与下段同页）。

## 分页规则（layout.paginate）

| 场景 | 规则 |
| --- | --- |
| 贪心装箱 | 块沿主轴累加，超页换页 |
| `breakBefore` / `breakAfter` | 强制换页（章首 / 卷末） |
| `keepWithNext` | 与下一块同页；放不下则整体换页（下一块强制换页时不连坐） |
| 超大块 | 独占一页（避免死循环） |
| 非法输入 | `pageMainSize <= 0` 或块尺寸为负抛 `RangeError` |

## 相关

- 包参考：[`@bibliotype/reader`](../packages/reader/README.md)
- 分页器与样式构建：[05 版式与 HTML](05-layout-and-html.md)
- Vue 响应式绑定：[06 Vue 集成](06-vue-integration.md)
