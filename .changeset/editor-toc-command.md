---
"@bibliotype/editor": minor
"@bibliotype/layout": patch
---

新增目录生成 / 刷新：`insertToc`（按卷 / 章 / 节等结构节点生成 `toc` 块，标题行与条目带 `toc-title` / `toc-entry` / `toc-subentry` 版式角色与锚点链接；已存在目录时原位替换内容并保留 id，支持 `maxLevel` / `includeHeadings` / `links` / `hrefPrefix` / `title`）、`collectTocEntries`（文档先序收集条目，跳级层级收敛为父级 + 1）与 `buildTocNode`（由条目构造目录节点）。

`layout` 的 `book-css` 补目录链接规则：`.bt-toc .bt-mark-link` 跟随目录版式，不另加颜色与下划线。
