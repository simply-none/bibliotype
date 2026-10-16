---
"@bibliotype/layout": patch
---

修复标题经 IR 往返后层级错位（P1-2 / R3）：schema 中 heading 的 `level` 默认值与 html-serializer 的缺省回退不一致——`heading` spec `level.default = 1`，而 `html-serializer` 缺省回退为 `2`，导致 H1 经 IR 往返后被渲染 / 导出成 `<h2>`（H2/H3 正常）。现统一回退为 `1`，使 `equals spec 默认值` 的省略输出与缺省回退口径一致（兜底默认值须与 spec 默认一致）。
