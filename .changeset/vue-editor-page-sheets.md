---
"@bibliotype/vue": minor
---

BtEditor 的 `pagination` 由「分页参考线（虚线）」升级为「分页纸张效果」：以与预览同源的块→页归属，按真实 DOM 定位逐页渲染纸面面板（纸色 + 阴影 + 页码标签），页间留出缝隙露出台面底色（`--bt-editor-stage`），呈现类似预览的逐页纸张观感；横排 / 直排均支持，关闭 `pagination` 时保持原有连续长纸样式。
