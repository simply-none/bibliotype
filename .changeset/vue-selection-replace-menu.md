---
"@bibliotype/vue": minor
---

新增选区「替换为」浮动菜单：`BtSelectionReplaceMenu` 组件、`useSelectionReplace` 组合式与 `placeFloating` 定位纯函数。选中文字后在选区旁弹出，按分组展示目标，点击经 `binding.execute` 执行；优先用可见 DOM 选区定位（连续画布与 paged 画布通用），去抖 120ms，支持只读、Esc / 点外部关闭与自动弹出开关。
