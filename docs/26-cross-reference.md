# 26 交叉引用与页码索引（两遍排版）

> 涉及包：`@bibliotype/xref`（依赖 `@bibliotype/core`）
> 相关篇目：[04 阅读器与分页](04-reader-and-pagination.md) · [18 纸书排版引擎](18-pagination-engine-roadmap.md) · [23 锚点](23-ir-validation-and-migration.md)

「参见第 128 页」必须等**分页完成**才知道页码。这就是纸书的标准做法——**两遍排版**：

```text
第一遍：分页 → buildPageIndex → { 节点 id: 页码 }
第二遍：渲染 → resolveReferences → 把 {{page:id}} / {{ref:label}} 换成真实页码
```

## 一、建立索引

```ts
import { buildPageIndex, lookupPage, serializePageIndex } from '@bibliotype/xref';

const index = buildPageIndex(reader.pagination.pages, { startNumber: 1 });
// { entries: { 'p-1': 3, 'ch-2': 12 }, totalPages: 210 }

lookupPage(index, 'ch-2');          // 12
serializePageIndex(index);          // 键有序，输出确定
```

- 输入为「每页出现过哪些块 id」的最小投影，与 `layout` 的 `PaginatedPage` 结构兼容：
  优先读 `items[].block.id`（行级拆分片段），再补 `blocks[].id`；
- **同一节点跨页出现时取首次出现页**（符合「参见第 X 页」的直觉）；
- `startNumber` 让首页从指定页码开始（封面 / 前置页由调用方偏移）。

## 二、两种占位语法

| 占位 | 取页码方式 | 适用 |
| --- | --- | --- |
| `{{page:<nodeId>}}` | 直接按节点 id | 程序生成的内容、一次性引用 |
| `{{ref:<label>}}` | 经登记表翻译成节点 id | 作者手写：只维护「图 1」这类语义标签 |

```ts
import { CrossReferenceRegistry, resolveReferences } from '@bibliotype/xref';

const registry = CrossReferenceRegistry.from([
  { label: 'fig-1', nodeId: 'img-1', kind: 'figure' },
  { label: '学而篇', nodeId: 'ch-1', kind: 'chapter' },
]);

resolveReferences('参见第 {{page:ch-2}} 页，另见图 {{ref:fig-1}}', index, registry);
// '参见第 12 页，另见图 128'
```

选项：

```ts
replacePageReferences(text, index, {
  format: (page) => `第${page}页`,          // 缺省十进制；可接中文数字 / 罗马数字
  missing: '待定',                           // 目标缺失（缺省 '？'）
  template: (formatted, match) => `[${formatted}]`,
});
```

目标缺失**不抛错**：稿件里存在指向已删除章节的引用是常态，应显示待修而不是中断导出。

## 三、登记表

```ts
const registry = new CrossReferenceRegistry();
registry.register({ label: 'tab-1', nodeId: 'tbl-1', kind: 'table' });
registry.has('tab-1');                       // true
registry.resolvePage('tab-1', index);        // 页码或 undefined
registry.list();                             // 按标签升序
registry.remove('tab-1');
registry.toJSON();                           // 确定性 JSON
CrossReferenceRegistry.fromJSON(json);       // 非法输入抛 TypeError
```

- 标签为空 / 重复抛 `RangeError`；`registerMany` 失败整体不写入；
- 建议把登记表与标注一样**单独持久化**，避免正文改动触发整本重写。

## 四、与导出器配合

EPUB / 站点导出的推荐顺序：

1. `reader.repaginate()` / `paginate(...)` 拿到分页结果；
2. `buildPageIndex(pages)`；
3. 遍历章节节点，对每个文本叶子执行 `resolveReferences(text, index, registry)`；
4. 再走 `serializeNode` 输出 HTML。

注意：**先解引用再序列化**，否则占位符会被转义。

## 五、索引词与书末索引附录（K4）

对选中文字套用 `index-term` 标记（编辑器命令 `toggleIndexTerm(term?)`，
缺省以选中文本为词条；`sortKey` 可手工指定拼音 / 笔画序），采集与附录在
`@bibliotype/core`（导出器只依赖 core，故放 IR 层）：

- `collectIndexTerms(document)`：按文档顺序收集 `term / sortKey / blockId`；
- `buildIndexEntries(document, pageNumbers?, options?)`：按词条分组，页码
  去重排序、连续页合并为区间（`3, 5–7`），记录首个命中块作回跳锚点；
  排序缺省 `localeCompare('zh-Hans-CN-u-co-pinyin')`，无 ICU 退化为码位序
  （确定性），可用 `options.compare` 覆盖；
- `buildIndexAppendix(entries, options)`：生成 `appendix` 节点（标题「索引」
  + 条目段落 + 回跳 `link` 标记）；`showPageNumbers: false` 时只出词条链接
  （EPUB 无固定页码即用此模式），`hrefFor` 控制链接地址。

`exportEpub` 缺省自动追加索引章（`includeIndex: false` 关闭），跨文件链接
由导出器按「块 id → 文件」映射生成；站点 / PDF 直接把附录节点排进 IR 即可，
三端共用同一份采集结果。分页重排后重新执行「两遍排版 + 采集」页码即更新。

## 六、常见错误

| 现象 | 根因 | 处理 |
| --- | --- | --- |
| 页码全是问号 | 索引为空（分页未跑 / id 不匹配） | 打印 `index.entries` 与实际节点 id 对照 |
| 页码差一页 | `startNumber` 与阅读器页码口径不同 | 统一用同一套 `formatPageNumber` 口径 |
| 占位符原样出现在成品 | 序列化后才替换（被转义） | 在文本层先 `resolveReferences` |
| 交叉引用指向错误章节 | 用了 `blocks` 顺序而非 `items` 片段 | 优先 `items[].block.id`，取首次出现页 |
