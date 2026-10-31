---
'@bibliotype/exporter-site': patch
'@bibliotype/exporter-pdf': patch
'@bibliotype/exporter-epub': patch
'@bibliotype/fonts': patch
'@bibliotype/xref': patch
---

导出链路修复（排版工业级批次 6）

- **site 搜索索引接修订视图**：`search-index.json` 曾不按 `revisionView` 过滤，
  终稿视图下已删除文字仍可被搜到；现索引文本提取按视图过滤
  （新增 `nodePlainTextForView`，缺省 `final` 与页面序列化口径一致）。
- **site 嵌套章节去重**：章同时含正文与子节时，子节内容曾同时出现在父页
  HTML 与子页（双份）；现父页只收直属内容（`PlannedSection.content`），
  与 nav 层级一致。
- **PDF paged 分支修订视图进分页**：预分页 Reader 曾不感知 `revisionView`，
  被隐藏内容仍消耗分页容量（80 个删除段落 final 视图仍占 80 页）；现分页前
  按视图投影文档（复用 core `projectRevisionView`，稳定 id 保留）。
- **PDF facing 镜像不对称边距**：对页模式 verso 曾只加装订 gutter、基础边距
  不镜像；现 verso 水平边距为 recto 的物理镜像（auto 与 paged 分支一致）。
- **打印直排眉批 / 旁批双渲染修复**：paged 正文流（含分截分组）先剔除
  head-note / margin-note 再序列化，装饰宿主不再重复渲染一份。
- **字体字符收集扩围**（fonts）：`collectDocumentChars` / `prepareFontBundle`
  新增 `extraSources`（元数据 / 页眉页脚文本）与 `pageNumberStyleChars(style)`
  页码字符集（中文含 〇零一二三四五六七八九十百千万、罗马大小写）——页码与
  页眉文本曾不在子集内，渲染回退系统字体。
- **EPUB 书末尾注跨文件链接修正**：尾注聚合到独立 XHTML 后，注码 / 回链曾为
  局部 `#n` / `#r`，跨阅读器跳转失效；现按拆分后的「锚点 → 文件」映射统一
  改写为内容文档同目录相对地址（新增 `link-rewrite.ts`，`href` 形态从
  `text/sec-N.xhtml#id` 变为 `sec-N.xhtml#id`）。
- **xref 两遍收敛**（xref）：新增 `resolveReferencesConverged`——循环
  「重建页码索引 → 重替换 → 比较」至多 3 轮（可配），页码稳定提前退出；
  不收敛返回 `converged: false`。每轮以**原文档 + 最新索引**重跑替换
  （占位符只在原稿上），保证「产物页码 = 产物分页」。
