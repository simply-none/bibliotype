---
"@bibliotype/editor": patch
"@bibliotype/reader": patch
"@bibliotype/vue": patch
---

文档内锚点跳转：导入保留源元素 id，阅读视图点击 `<a href="#…">` 注码跳到目标内容，修「点击刷新」。

- **editor**：schema 解析层（`buildSchema`）为全部节点 parseDOM 规则统一保留源元素 `id`（覆盖导入的 HTML / docx / EPUB 与 bt-* 渲染产物 HTML 回编辑器的往返）——`<a href="#…">` 的跳转目标块（段落 / 列表项 / 标题等）从此带源 id，阅读器可按块 id 定位页码。
- **reader**：新增「链接 hash → 叶块 id」索引与 `Reader.getPageOfAnchor(hash)`——链接标记的 hash（EPUB 遗留 `text00012.html#ch1-9` 取末段）反查其所在块再定位页码，首次出现优先。
- **vue**：`useNoteInteraction` 点击委托新增「文档内锚点链接」分支——书内相对锚点（含 path#hash 形态，文件名段为 EPUB 残留）**一律消费**，绝不交给浏览器默认导航（相对路径导航会把预览页整页「刷新」）。跨页定位三级解析：目标块 id 直查 → **EPUB 回链约定**（注码 `#ch1-9` ↔ 注文回链 `#ch1-9-back`，经 `getPageOfAnchor` 反查注文所在块，**存量书免重导即可跳转**）→ 点击注文回链时剥 `-back` 后缀反查注码；全部落空（坏链）静默消费。绝对地址（http / mailto 等）与无 hash 的普通链接照常放行；同页已渲染的目标直接高亮定位。

