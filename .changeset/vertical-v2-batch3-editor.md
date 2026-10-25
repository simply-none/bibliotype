---
"@bibliotype/editor": minor
"@bibliotype/vue": minor
---

直排排版引擎 v2 批 3（编辑层）：分页画布直排行内流 + 行款命令。

- **行款命令**（editor）：`setLineIndent(n|null)` 低格、`setLift(type, level?)`
  抬头（空抬 / 挪抬 / 平抬 + 单双三四抬）、`toggleBreakLine()` 提行另起——
  作用于光标所在段落 / 引文（标题不命中），attrs 经 IR ⇄ PM 无损往返；
- **PagedCanvas 直排行内流**：连排片段（段落 / 引文）改走
  `serializeVerticalFlow`（与预览 BtBookView 同形态）——片段以行内呈现、
  正文跨片段同列连排（`.bt-paged-frag--inline`）；续排片段（fromLine > 0）
  自动省略行款前缀（不重复低格 / 抬头）；空行内段落以零宽字符撑出落点；
- **字符轴兼容**：行内流标记（空位盒 / 断列 br）不产生文本节点，
  `fragTextNodes` 的 DOM 文本轴与模型轴保持同口径——选区桥 / IME / 点击
  定位无需改动（附测试锁定）；
- 隔离：横排画布渲染通道不变（无 bt-vflow 类、块级序列化）。
- demo：工具条「插入」行新增行款组 7 项（低两格 / 顶格 / 挪抬 / 平抬 /
  提行 / 墨钉 / 总评），速查文档同步。
