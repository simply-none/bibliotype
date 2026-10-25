---
"@bibliotype/vue": patch
"@bibliotype/demo": patch
---

双页对照翻页步长修正：`BtBookView` 对页（`spread="facing"`）下键盘 / 滚轮 / 触屏滑动 / 边缘点按一次跨一整对（2 页），
`BtPager` 新增可选 `step`（默认 1，对页传 2），Demo 在桌面双页对照态把 `step=2` 接到状态栏翻页按钮，
不再需要连点两次或多次滚动才换页对。
