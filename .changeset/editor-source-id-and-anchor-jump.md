---
"@bibliotype/editor": patch
"@bibliotype/vue": patch
---

文档内锚点跳转：导入保留源元素 id，阅读视图点击 `<a href="#…">` 注码跳到目标内容，修「点击刷新」。

- **editor**：schema 解析层（`buildSchema`）为全部节点 parseDOM 规则统一保留源元素 `id`（覆盖导入的 HTML / docx / EPUB 与 bt-* 渲染产物 HTML 回编辑器的往返）——`<a href="#…">` 的跳转目标块（段落 / 列表项 / 标题等）从此带源 id，阅读器可按块 id 定位页码。注意：此前导入的存量书源 id 已在解析时丢失，需重新导入后锚点跳转才生效。
- **vue**：`useNoteInteraction` 点击委托新增「文档内锚点链接」分支——目标在当前页时高亮定位（`scrollIntoView` + `bt-note-active`），跨页时经 `Reader.getPageOfNode`（既有 O(1) 块页映射）翻页后补高亮滚动；目标 id 解析不到时不拦截，交宿主 / 浏览器默认行为。导入注码（link 标记形态 `<a class="bt-mark-link" href="#…">`）不再触发浏览器默认锚点导航把预览页「刷新」到顶。
