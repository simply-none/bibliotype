---
"@bibliotype/vue": minor
---

Vue 编辑封装增强：`BtEditor` 新增编辑态整页缩放（`scale`）与只读模式（`editable`）props，分页参考线随实测尺寸联动；新增 DOM 实测分页工具导出 `measureBlockSizes` / `disposeMeasureSheet`（`MeasureBlockSizesInput` 类型），并补导出 `EditorBinding` / `EditorBindingOptions` 类型，供工具条作用域插槽与外部组合复用。
