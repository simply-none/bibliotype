---
"@bibliotype/core": minor
"@bibliotype/editor": minor
"@bibliotype/layout": minor
"@bibliotype/exporter-pdf": minor
"@bibliotype/exporter-epub": minor
---

直排排版引擎 v2 批 6（批点与套印）：墨色色层 / 单色模式 / 圈点双位 / 卷末总评样式。

- **套印墨色**：core 新增 `INK_COLORS`（black / red / blue / yellow）；注 / 批
  类节点（footnote / endnote / margin-note / head-note / tail-note /
  collation-note / double-note / inline-note / general-review）与圈点标记的
  规格登记 `inkColor` 属性；命令 `setInkColor(color | null)` 作用于光标所在
  注 / 批节点（black / null 回归全墨）；
- **渲染**：book-css 新增套印墨色规则——`data-ink` 属性选择器取
  `--bt-ink-*` 变量（朱 / 蓝 / 黄，主题可覆盖），预览 / EPUB / PDF 全路径
  输出（批点套印不限仿真书）；
- **单色模式**：`buildBookCss({ monoInk })` 跳过色层规则（批注圈点回归全墨）；
  PDF / EPUB 导出选项 `monoInk` 透传——单色印刷交付；
- **圈点双位**（§11.4）：句读标记居字右下（缺省）、文法符号经圈点标记
  `position: 'grammar'` 居字右（直排惯行，两类不争空间）；密度档受 CSS
  text-emphasis 能力限制顺延（style 实心 / 镂空二维替代，docs 记录）；
- **卷末总评样式**：`.bt-general-review` 结构块（分隔线起首、注文色、小一号，
  补批 1 节点缺口）；注码圈码由 marker 字形（① ② …）内容层承担。
- 古典基线第十九次重锁（套印与圈点规则为全路径输出）。
