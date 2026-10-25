---
"@bibliotype/layout": minor
"@bibliotype/vue": minor
---

直排排版引擎 v2 批 2（渲染层）：直排行内流——正文连排 / 双行夹注固定双列 / 低格与抬头标记。

- **行内流渲染**（`serializeVerticalFlow`，`layout/html`）：直排（古籍直排 +
  仿真）页内容改写为行内流——段落行内化（`.bt-vpara`）、容器 `.bt-vflow` 在
  `vertical-rl` 下自然换列，列宽由根行高（= 列距）决定、与界行网格咬合，
  根治「CSS 块流段段换列、版面半空」（连排：段界靠格位标记，古籍原生形态）；
- **双行夹注固定双列**：`.bt-vnote` 恒 1 大字位宽 × 整列高的双列小字盒
  （「从上排到底」古籍形制）——`splitDoubleNoteLines` 按每子列容量
  （每行大字数 × 2）拆右 / 左子列，竖排 block 流自右向左、DOM 序即阅读序，
  字步进补至半字位（n 字占 ⌈n/2⌉ 字位）；直排 multicol 轴向不可靠已实测
  排除，采用显式双列；
- **行款标记渲染**（批 1 属性消费）：低格 / 挪抬 → 段首空位盒（`.bt-vpad`
  N 字位高）；提行 / 平抬 → `<br class="bt-vbreak">` 断列 + 抬升列首空位；
  `lineRuleOverhead` / `doubleNotePlaceholderChars` 提供无 DOM 导出折算口径；
- **三端接入**：预览 `BtBookView`（page / scroll / 对页直排分支）与量尺
  `pagination-measure`（直排同形态实测——行边界与夹注原子性自洽）；
- 隔离：横排产物逐字符不变；夹注盒宽经间接变量 `--bt-vnote-pitch` 接入
  列距（非仿真直排不出现仿真变量名）；古典基线第十六 / 十七次重锁。
