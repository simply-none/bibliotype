---
"@bibliotype/editor": patch
"@bibliotype/reader": patch
"@bibliotype/layout": patch
"@bibliotype/vue": minor
---

表格编辑增强：

- **editor**：`table` / `table-row` / `table-cell` 渲染为语义 `<table><tbody><tr><td>`（保留 `bt-*` class 与 `data-bt-id`），修复插入表格后编辑画布一片空白；
- **reader**：表格加入复合原子块，`extractBlocks` 不再下钻到单元格段落，分页与序列化保留完整 `<table>` 包裹；
- **layout**：表格样式随书写方向（`writing-mode: inherit`），空单元格保留最小尺寸，直排下不再塌陷；
- **vue**：新增 `BtTableSizePicker`（Word / WPS 式行 × 列网格 + 精确输入），配合工具条在直排下同样可插入表格。
