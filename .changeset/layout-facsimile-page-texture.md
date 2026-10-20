---
"@bibliotype/layout": minor
---

古籍仿真新增纸纹令牌 `page-texture`

- `buildBookCss`：`page-texture` 存在时在装饰段输出 `background-image: var(--bt-page-texture)` + `repeat`，与版框 / 界行同闸门（`pageDecoration && facsimile && 直排`）；缺省不输出任何规则，古典 / 现代路径逐字符不变。
- 纸纹属纯绘制令牌：不侵占版心、不进度量签名，`page-texture` 留值也不会让「古籍直排 / 现代横排」画出纸纹。
