# @bibliotype/xref

两遍排版的交叉引用：分页结果 → 页码索引 → 把 `{{page:id}}` / `{{ref:label}}` 换成真实页码。

## 安装

```bash
pnpm add @bibliotype/xref @bibliotype/core
```

## 快速上手

```ts
import { buildPageIndex, CrossReferenceRegistry, resolveReferences } from '@bibliotype/xref';

const index = buildPageIndex(reader.pagination.pages);   // { entries: { 'p-1': 3 }, totalPages: 210 }
const registry = CrossReferenceRegistry.from([{ label: 'fig-1', nodeId: 'img-1' }]);

resolveReferences('参见第 {{page:p-1}} 页，另见图 {{ref:fig-1}}', index, registry);
```

## API 概览

| 分组 | 导出 |
| --- | --- |
| 索引 | `buildPageIndex` / `lookupPage` / `serializePageIndex` / `deserializePageIndex` |
| 登记表 | `CrossReferenceRegistry`（`register` / `registerMany` / `get` / `list` / `resolvePage` / `toJSON` / `fromJSON`）、`XREF_SCHEMA_VERSION` |
| 替换 | `findPageReferences` / `findLabelReferences`、`replacePageReferences` / `replaceLabelReferences` / `resolveReferences`、`hasReferences` |
| 类型 | `PageSource` / `PageIndex` / `CrossReference` / `PageReferenceOptions` |

## 约定

- 输入是「每页出现过哪些块 id」的最小投影，与 layout 的 `PaginatedPage` 兼容；
- 同一节点跨页出现时取**首次出现页**；
- 目标缺失替换为 `options.missing`（缺省 `？`），不抛错；
- 替换必须在 `serializeNode` **之前**做，否则占位符会被转义。

## 相关

- 功能参考：[docs/26-cross-reference.md](../../docs/26-cross-reference.md)
- 仓库主页：[bibliotype](../../README.md)
