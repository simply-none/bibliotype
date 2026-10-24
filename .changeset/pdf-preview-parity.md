---
"@bibliotype/exporter-pdf": patch
---

PDF 导出样式与预览一致性修复（现代横排 / 古籍直排 / 古籍仿真直排）：

- 光栅直出（`exportRasterPdf`）foreignObject 包装改为 XHTML `<body>`——此前包成
  `div` 使 `body {…}` 根规则与全部 `body .bt-*` 作用域规则失配，字体 / 颜色 /
  书写方向全丢（直排变横排）；
- 打印 CSS 补根级 `text-indent`（容器段落 `inherit` 链不再断到 0，双行小注 /
  夹注首行缩进与预览一致）；
- `page-border` 令牌（古籍直排双边版框）在 paged 模式逐页绘制，与预览页框
  inline 同值（分页口径本就扣除 border 宽度，此前不画框留空位）；仿真版式
  与令牌成对失效的闸门与预览一致；
- 逐页分栏双通道：版面级（`layout.columns`）落 `.bt-page` 根级 `column-count`，
  块级（结构节点 `attrs.columns`）探测分页结果后包 `.bt-page__flow[data-columns]`
  下发分栏规则；paged 下 body 根规则不再分栏（避免把 `.bt-page` 序列当栏内容排）；
- 页底浮注：`footnoteFloat` / `noteMaxRatio` 选项透传内部 Reader（与预览同源），
  每页渲染 `.bt-page-notes` 注区（含跨页续注标记）。
