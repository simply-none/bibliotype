---
"@bibliotype/layout": patch
---

补全 `book-css.ts` 样式空洞（P1-3 / R4）：html-serializer 序列化产物带有 class 但 `book-css` 缺少对应规则，导致这些元素插入后不可见。现补上 `.bt-seal`（印文只存于 `attrs.text`、元素为空）、`.bt-fish-tail`、`.bt-border-frame`、`.bt-inline-note`、`.bt-variant-char`（注意 `.bt-mark-variant` 已有、载体此前缺失，存在不对称）、`.bt-tail-note`（此前只出现在后代选择器、无基样式）的基样式。已覆盖的 double-note / head-note / collation-note / imprint / colophon / footnote / endnote / margin-note / collation-mark（`::after{content:attr(data-symbol)}`）/ taboo-char 不受影响。
