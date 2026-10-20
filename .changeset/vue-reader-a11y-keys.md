---
"@bibliotype/vue": minor
---

阅读视图交互与无障碍补齐：

- `BtBookView` page 模式内置键盘翻页（←→ ↑↓、PageUp/PageDown、空格、Home/End；带修饰键的组合不拦截）与触屏滑动（横排左滑下一页、直排右滑下一页、纵向滑动不误触）；新增 `ariaLabel` prop、`role="document"`、`tabindex="0"`、`:focus-visible` 焦点环与 `aria-live` 页码播报；
- `BtPager` 补 `role="group"` / `aria-label`，页码状态区加 `aria-live="polite"`。
