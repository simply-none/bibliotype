---
"@bibliotype/editor": minor
"@bibliotype/layout": minor
---

表格数据与交换层增强：`table-row` 新增 `header`（表头行），`table-cell` 新增 `colspan` / `rowspan` / `align`（默认值在 IR 中省略）；HTML 导入识别 `<thead>` / `<th>` 与 `colspan` / `rowspan` / `align`（含 `data-align`、内联 `text-align`），导出输出 `<thead>` / `<th>`、原生跨行跨列与 `data-align`（无表头行时保持旧输出）；编辑器单元格 `toDOM` 输出原生 `colspan` / `rowspan`；新增命令 `toggleTableHeaderRow` / `setTableCellAlign` 与 `TableCellAlign` 类型；book CSS 增加单元格对齐与表头底色规则；文档 21 与能力清单同步。
