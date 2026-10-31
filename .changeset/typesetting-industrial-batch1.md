---
'@bibliotype/layout': patch
'@bibliotype/classical': patch
---

直排夹注与行内流修复（排版工业级批次 1）

- **双行夹注多对切片步长修正**：`serializeDoubleNote` 曾按每子列容量（cap）步进切窗口，
  而每对实际消耗 2×cap 字符——第 2 对起注文成段重复且尾部丢失。现切分窗口由
  新增的 `planDoubleNoteColumns` 一次算清（文本与码元窗口同源，不可能漂移）。
- **文本轴统一为 UTF-16 码元**：夹注拆列曾按码点（`[...text]`）、切片按码元
  （`text.length`），astral 字符（扩展 B–F 区汉字、emoji）子列错位并可产出孤代理
  （非法 XML、EPUB 整本拒开）。现规划器按码元切并防劈代理对（边界落在代理对
  中间回退一位）。
- **行中起注低一格接线**：`indentFirstPair` 从未传入（死参数）。现段内夹注前有
  内容时自动缩格（右列首补 1 字位空位盒，与该列少排的一位严格配对）；段首夹注顶格。
- **直排夹注几何重写**（book-css）：`.bt-vnote` 的 `inline-size: 100%`（恒占整列高）
  改为内容自适应并补 `block-size: 1em`（1 大字位宽）；`.bt-vnote-col` 的
  `letter-spacing` 曾引用从未定义的 `--bt-vnote-pitch`（恒走 2em 回退，小字步进
  超量 47%、尾部被 `overflow: hidden` 静默裁字），归零对齐容量口径，去
  `overflow: hidden`（漂移可见优于静默丢字）；`.bt-vpad` 空位盒 inline/block
  两轴转正（N 字位 × 1 字位厚，去 `1lh` 列距量纲错用）。
- **删除非法声明** `text-emphasis-position: right center`（center 不是合法关键字，
  所有浏览器整条丢弃）：直排下基础规则 `under right` 的 right 已满足「文法居字右」。
- **非连排节点透传 nodeOptions**：`serializeVerticalFlow` 序列化标题 / 版式块
  （眉批、旁批）曾丢 tagOverrides / verticalText / revisionView。
- **句读标记 astral 修复**（classical）：`judouMarkerRange` 对 astral 前字按码元
  回退一位，mark 包裹孤代理产出非法 XML；现回退到完整代理对起点。直排标点
  形式 ︒ ︑ ︠ ︡ 并入既有标点集。
