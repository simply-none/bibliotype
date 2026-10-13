---
"@bibliotype/vue": minor
---

BtBookView 新增 `mode` prop（`page` 单页翻页 / `scroll` 连续滚动多页，默认 `page`）。`scroll` 模式把所有分页纵向拼接为可滚动容器，滚动时按可见页回写 Reader 页态，外部翻页（BtPager / 键盘 / 目录）滚动定位到对应页；useReaderBinding 相应暴露响应式 `pagination` 以支撑全页渲染。
