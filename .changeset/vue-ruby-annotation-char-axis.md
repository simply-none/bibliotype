---
"@bibliotype/vue": patch
---

修复分页编辑态中「同段落选中内容之前有注音时，行内标记落点整体右移」：

- **根因**：字符坐标轴不一致。模型轴（IR / PM / 切片，口径见 `reader.collectNodeText`）**不含** ruby 注文——注文存放于 mark 的 `attrs.text`，不是文本子节点；而片段 / 量尺 DOM 轴**含**注文——`html-serializer` 把 ruby 渲染为 `<ruby>基字<rt>注文</rt></ruby>`，`<rt>` 是真实文本节点。两轴相差「选中位置之前的注文字数」，选区 / 光标 / 行首偏移换算随之整体右移。
- **修复**：新增 `ruby-annotation` 原子模块（注文识别），DOM 文本采集处一律跳过 `<rt>` / `<rp>` 子树，两处同源修复：
  - `paged-editor/input-router` 的 `fragTextNodes`：纠正行内标记落点右移、含注音段落的 IME 插入位置、光标还原与跨片段导航边界判断；
  - `pagination-measure` 的 `collectTextOffsets`：`lineOffsets` 回到模型轴，纠正含注音多行段落的片段切片边界与选区映射。
