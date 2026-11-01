---
'@bibliotype/layout': patch
'@bibliotype/vue': patch
'@bibliotype/exporter-pdf': patch
'@bibliotype/reader': patch
---

古籍直排章题随文连排 + 直排量尺字位口径校正（消除「题独占整列 / 每页多算一列」）

**背景**：古籍直排逐页复核发现两类系统性偏差，都会把页末挤出 1~3 列的空白、并把正文
推到下一页（用户可见「很多空白 + 段落截断」）：

- **章题独占整列**（layout）：章题是块级元素，直排 block 流里块首必落列首，答题后的
  正文被迫另起一列；再叠加继承的倍数行高（1.9em × 2em 字号 ≈ 60.8px = 两列），
  一道题白扔 1~2 列。古籍形制是「提行 + 题文连排」（题后同列接排正文），与实现不符。
- **量尺字位口径两处**（vue）：① 块跨度误把「字位数」当 px 用（`advance = max(body,
  nextStart − start)`），推进量虚高 1/lineSize ≈ 1.7 倍；② 列号按字盒左右缘
  `Math.round(offset / 列距)` 取整——字盒（1 字宽）窄于列距，同一列 `right` 落第 k 列、
  `left` 落第 k+1 列，块跨度凭空多一整列。

**改动**：

- `vertical-flow`：章题归入行内连排（`isFlowInlineType`），序列化时前置断列标记
  `<br class="bt-vbreak">`（提行语义保留），题后正文同列接排；`isFlowParagraphType`
  保持仅段落 / 引文（供 `breakColumn` 判定，章题不再按块级另起一列）。
- `book-css`（直排分支）：`.bt-vflow .bt-heading { display: inline; margin: 0;
  line-height: <列距>px }`——行内化、去掉列宽方向外边距、锁死行盒恒 1 列；
  页首断列标记 `.bt-vbreak:first-child` 遮蔽（页流本就从列首起排，再断一次白扔一列；
  预览 / 打印 / 编辑画布三处同规则）。
- `pagination-measure`：块跨度按「矩形中心 + `Math.floor`」定位列号，一切写入分页模型
  的尺寸统一为 `字数位 × 字位宽`（px）。
- `print-document`：打印稿同步改用 `isFlowInlineType`。

**实证**（demo 实测，直排）：

- 满版：古籍直排 19 列 × 53 字，页内 `usedMainSize` 恒等于容量（577.6px），
  长文 18k 字 / 19 页 ≈ 1000 字/页；仿真直排 10 列 × 20 字，前 3 页同样满版；
- 量尺与渲染同尺：同一页模型 577.6px ↔ DOM `flow` 实测 577.45px（差 0.15px）；
- 章题：首列「题 4 字 + 正文 48 字」同列，量尺表里章题块推进量从整列（30.4px）
  降到 3~4px；
- e2e `@pixel` 三档（古籍直排 / 仿真 / 竖排左起）结构基线随之重锁，几何截图
  （页框 / 界行）逐像素不变。
