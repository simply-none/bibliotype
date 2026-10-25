---
"@bibliotype/core": minor
"@bibliotype/classical": minor
"@bibliotype/editor": minor
"@bibliotype/layout": minor
"@bibliotype/reader": minor
---

直排排版引擎 v2 批 1（模型层）：双行夹注行内化 + 墨钉 / 卷末总评节点 + 行款属性登记。

- **IR 0.4.0 迁移**：`double-note` 由块容器改为**行内容器**（古籍口径：小字≈
  正文之半、随文双行连排不换列，n 字占 n/2 字位）。`migrateDocument` 内置
  `0.3.0→0.4.0` 步骤：容器内段落展平为行内 children；块位夹注包一层段落
  （行内节点落合法段落位）；id / attrs 原样保留，入参不可变。
- **编辑器**：规格改 `inline*`（与夹注 inline-note 同形态）；`wrapDoubleNote`
  行内包裹命令（选区包裹 / 空光标插入，`insertDoubleNote` 为别名）；IR ⇄ PM
  往返走行内通道；新增 `insertInkNail` / `insertGeneralReview` 命令。
- **新节点**：`ink-nail`（墨钉——未定字占位黑块，行内原子，1em 实心方）、
  `general-review`（卷末总评，结构块，title 供目录提取）。
- **行款属性**：`LINE_RULE_ATTRS`（`indent` 低 N 格 / `lift`+`liftLevel` 抬头
  六式 / `breakLine` 提行另起 / `band` 两截本归属）并入 `COMMON_NODE_ATTRS`，
  缺省 null 不参与序列化——未使用行款的文档 IR 逐字节不变；渲染 / 分页侧
  消费属批 2 / 批 4。
- **reader**：`double-note` 移出版式文本容器清单（随所在段落成块、随行切片）；
  `general-review` 纳入容器清单。
- **序列化与样式**：`double-note` 恒输出行内 `span`（不再走块级启发式 div）；
  横排括注随文（伪元素括号 + 0.72em 小字，古籍点校整理规范）；墨钉样式；
  仿真网格层移除块级夹注规则（列内双行属批 2 列盒渲染器，行内夹注继承
  根行高天然落格）；古典基线哈希第十五次重锁。
- demo：《论语》样册夹注改段内行内位；「替换为」菜单的双行夹注移入
  「行内容器」组（同段选区包裹）；工具条插入项同步。
