---
"@bibliotype/vue": minor
---

`BtDrawer` 开放一组可覆盖的视觉变量（都带原默认值，不传即维持库自身观感，桌面回归不变）：
`--bt-drawer-mask`（遮罩色）、`--bt-drawer-shadow`（面板投影）、`--bt-drawer-radius`（底部 sheet 上圆角，12 → 16）、
`--bt-drawer-radius-sm`（关闭按钮圆角）、`--bt-drawer-hover`（关闭按钮悬停底）、`--bt-drawer-ease`（入场缓动）。
同时为抽屉 / sheet 补入场动效（侧滑推入、底部升起、遮罩淡入），并在 `prefers-reduced-motion: reduce` 下整块关闭；
关闭按钮加三态过渡，头部标题与内边距按移动端字号微调。皮肤本身仍归宿主（demo 的 `--ui-*` 令牌 + `[data-skin]`），库内不引入主题状态与存储。
