---
"@bibliotype/vue": minor
---

BtBookView 新增 `mode` prop（`page` 单页翻页 / `scroll` 连续滚动多页，默认 `page`）。`scroll` 模式把所有分页纵向拼接为可滚动容器，滚动时按可见页回写 Reader 页态，外部翻页（BtPager / 键盘 / 目录）滚动定位到对应页；采用窗口化虚拟滚动（按等高页步长精确推算，仅序列化 / 挂载视口附近的页 + overscan），大部头书籍不再一次性渲染全部分页。useReaderBinding 相应暴露响应式 `pagination` 以支撑分页推算。
