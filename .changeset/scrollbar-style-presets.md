---
"@bibliotype/vue": patch
"@bibliotype/demo": patch
---

新增古籍风滚动条样式：`BtBookView` 的滚动条改由 `--bt-scrollbar-*` 令牌驱动（尺寸 / 滑块 /
轨槽 / 悬停色，均带默认值回落），Demo「设置 → 其他」提供「墨线 / 卷轴 / 竹简」三套预设并随界面
偏好快照持久化。WebKit 用 `::-webkit-scrollbar` 画轨槽与滑块并隐藏两端按钮；标准属性
（`scrollbar-width` / `scrollbar-color`）收在 `@supports not selector(::-webkit-scrollbar)` 内，
避免 Chromium 因命中标准属性而整体丢弃伪元素、退回带箭头的系统滚动条。
