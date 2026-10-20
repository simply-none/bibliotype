# @bibliotype/exporter-site

IR → 静态站点：目录页 + 每节一页 + 样式 + 搜索索引 + IR 原文。纯函数、无 IO、输出确定。

## 安装

```bash
pnpm add @bibliotype/exporter-site @bibliotype/core @bibliotype/layout
```

## 快速上手

```ts
import { exportSite } from '@bibliotype/exporter-site';

const { files, sections, warnings } = exportSite(document, {
  siteTitle: '论语译注',
  language: 'zh-Hans',
});

for (const file of files) {
  // 自行写入磁盘 / 打包 ZIP / 上传静态托管
  console.log(file.path, file.mediaType, file.text.length);
}
```

## 产物

| 文件 | 说明 |
| --- | --- |
| `index.html` | 目录页（按节序链接） |
| `section-N.html` | 每节一页，含上/下一节导航 |
| `style.css` | `buildBookCss` 书册样式（作用域 `.bt-reader-page`）+ 站点框架样式 |
| `search-index.json` | `{ version, entries: [{ id, title, path, text }] }` |
| `book.json` | IR 原文（可关） |

## API 概览

| 分组 | 导出 |
| --- | --- |
| 编排 | `exportSite`、`DEFAULT_SITE_CONTAINER` / `DEFAULT_MAX_SECTIONS` |
| 分节 | `planSections` / `resolveSectionTitle` / `isStructureNode`、`SITE_STRUCTURE_TYPES` |
| 渲染 | `renderSectionPage` / `renderIndexPage` / `buildSiteCss` |
| 搜索 | `buildSearchEntry` / `serializeSearchIndex` / `normalizeSearchText`、`SITE_SEARCH_INDEX_VERSION` |
| 类型 | `SiteFile` / `SiteSection` / `SiteSearchEntry` / `SiteExportOptions` / `SiteExportResult` |

## 约定

- 分节规则：有内容的结构节点各成一页；纯容器向下递归；根下零散块合并为「正文」页；
- 所有 IR 文本经 `escapeHtml` 转义，正文 HTML 只由 `serializeNode` 产出；
- 样式全部限定在 `.bt-reader-page` / `.bt-site-*`，不产生全局选择器；
- 节数超过 `maxSections`（缺省 2000）抛 `RangeError`，不静默截断。

## 相关

- 功能参考：[docs/28-site-export.md](../../docs/28-site-export.md)
- 样式构建：[docs/05-layout-and-html.md](../../docs/05-layout-and-html.md)
- 仓库主页：[bibliotype](../../README.md)
