---
"@bibliotype/layout": patch
---

直排字图不再旋转 90°：移除书册样式表对 `.bt-glyph-image` 的 `transform:
rotate(90deg)` 直排分支。缺字字形图是「正立文字的图片」——直排下汉字本身
直立不旋转，字图同理，无论横排 / 直排恒以原图方向展示（与行内 SVG 合成
字形 `.bt-glyph` 的既有口径一致，弹窗放大原本即按原图方向展示）。
