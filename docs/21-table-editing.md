# 21 表格编辑、插入与直排

> 涉及包：`@bibliotype/editor`（节点 DOM / 命令）、`@bibliotype/reader`（分块与分页）、
> `@bibliotype/layout`（表格样式）、`@bibliotype/vue`（尺寸选择器）、`apps/demo`（工具条整合）
> 相关：[02 编辑器与插件](02-editor-and-plugins.md) · [04 阅读与分页](04-reader-and-pagination.md) ·
> [05 版式与 HTML](05-layout-and-html.md) · [06 Vue 集成](06-vue-integration.md) ·
> [19 工具条使用说明](19-editor-toolbar-usage.md) · [20 选区替换为](20-selection-replace.md)

本文说明表格的插入体验、编辑态为什么曾显示为空白、分页口径，以及直排（竖排）下的行为。

---

## 一、数据模型

```text
table (block)
└── table-row+          （至少一行）
    └── table-cell+     （至少一列）
        └── block+      （单元格内是块，编辑时通常是空段落）
```

- 节点名：`table` / `table-row` / `table-cell`，均带通用 attrs（含稳定 `id`、`rawAttrs`）。
- **简化模型**：没有 `colspan` / `rowspan` / 表头（`th`）属性；单元格内可放任意块，但工具条只提供空段落。
- 编辑命令：`insertTable(rows, cols)`、`tableAddRow()`、`tableAddColumn()`、
  `tableDeleteRow()`、`tableDeleteColumn()`（后四者要求光标在单元格内）。

---

## 二、插入体验（Word / WPS 式）

工具条「表格」不再直接插 3×3，而是打开 `BtTableSizePicker`：

| 交互 | 行为 |
| --- | --- |
| 网格 | 默认 8×8；鼠标悬停实时高亮 `r × c`，标题下方显示「行 × 列」 |
| 点击 | 点击网格单元格立即按该尺寸插入 |
| 精确输入 | 下方「行 / 列」数字输入（1 ~ max），点「插入」按输入尺寸插入 |
| 定位 | Teleport 到 body + `fixed` 定位，复用 `placeFloating`（上/下翻转、水平夹紧），不会被工具条横向滚动容器裁切 |
| 关闭 | `Esc` / 点选择器外 / 点触发器再次切换 / 插入完成后 |
| 越界 | 行列自动夹紧到 `1 ~ maxRows / maxCols`，不会插入 0 行 0 列 |

落点与旧版一致：**当前叶块之后**插入表格，单元格内嵌空段落，光标随即进入首个单元格。

```ts
import { BtTableSizePicker } from '@bibliotype/vue';
```

| Props | 说明 |
| --- | --- |
| `anchor` | 必填；触发器（表格按钮）的视口矩形 |
| `trigger?` | 触发器元素；点它时不触发「外部点击关闭」，交父级切换 |
| `maxRows?` / `maxCols?` | 网格上限，默认 8 / 8 |
| `rows?` / `cols?` | 初始行列，默认 3 / 3 |

`emit('select', { rows, cols })` / `emit('close')`。

demo 的接法见 `apps/demo/src/components/EditorToolbar.vue`：点击时分发到
`onActionClick`，记录按钮矩形并打开选择器；选定后执行 `insertTable(rows, cols)`。

---

## 三、编辑态渲染：为什么之前是「空白」

`withDefaultNodeDom` 会给没有 `toDOM` 的节点兜底成 `div.bt-<type>`。表格三件套因此曾被渲染为：

```text
div.bt-table > div.bt-table-row > div.bt-table-cell
```

浏览器不会对嵌套 `div` 建立表格布局，编辑画布上就只剩一片空白（或几条无意义的边框）。

**修复**（`packages/editor/src/schema-registry.ts` 的 `semanticDomShape`）：

```text
table       → <table class="bt-table"><tbody>…</tbody></table>
table-row   → <tr class="bt-table-row">…</tr>
table-cell  → <td class="bt-table-cell">…</td>
```

- 仍保留 `bt-*` class、`data-*` 属性与 `data-bt-id`（分页参考线按块定位要用）；
- `parseDOM` 同步接受 `table` / `tr` / `td` / `th`（粘贴与 HTML 回填）；
- 编辑器注入的 book CSS 会给 `.bt-table-cell` 加边框 / 内边距 / 最小尺寸，空表也不会塌成一条线。

---

## 四、阅读 / 分页 / 导出：表格是「复合原子块」

`extractBlocks` 原本对表格逐层下钻，块序列只剩单元格段落，序列化时丢失 `<table>` 包裹，
分页页面上同样表现为空白。现在：

- `COMPOSITE_ATOMIC_TYPES` 包含 `table`，`isLeafBlock` / `isLeafBlockTypeName` 对表格返回 `true`；
- `ATOMIC_BLOCK_TYPES` 包含 `table`，表格不标 `splittable`，不参与行级拆分；
- 因此表格**整体成一个块**，HTML 序列化器一次输出完整的 `<table>…</table>`；
- 超大表格放不下时按「不可拆块」独占一页，不会把行 / 单元格拆到不同页；
- 阅读、预览、PDF `paged` 模式共用 `extractBlocks → paginate` 管线，三端一致。

**paged 编辑态限制**：表格作为原子片段整体渲染，插入、查看、翻页正常；单元格内的细粒度
光标 / 输入仍受片段桥（`selection-bridge`）限制，复杂表格编辑建议切到连续画布。这是已知限制，
不是渲染回归。

---

## 五、直排（竖排）

- 工具条表格按钮**在直排下同样可用**，不再置灰；
- `.bt-table { writing-mode: inherit }`：单元格文字随书写方向竖排，表格列沿页宽方向展开；
- `.bt-table-cell` 增加 `min-inline-size` / `min-block-size`，直排空单元格仍有可点击 / 可测量面积；
- 表格是原子块，直排分页主轴为水平方向，表格整体占一页；列数很多的宽表可能超出页宽，
  建议控制在较小尺寸（后续可做「表格转图片 / 横排旋转」等增强）。

---

## 六、测试与验证

| 层 | 用例 |
| --- | --- |
| `packages/editor/src/__tests__/commands.test.ts` | 表格节点 `toDOM` 为 `table` / `tr` / `td`，带 `bt-*` class 与 `tbody` |
| `packages/vue/src/__tests__/editor.test.ts` | 挂载 `BtEditor` 后经插槽 `binding.execute` 插入表格，画布实际出现 `table.bt-table` / `tr` / `td` |
| `packages/reader/src/__tests__/document-blocks.test.ts` | 表格整体成块、不下钻到单元格、不标 `splittable` |
| `packages/vue/src/__tests__/table-size-picker.test.ts` | 网格点击 / 精确输入夹紧 / Esc / 外部点击 / 触发器切换 |
| 手工 | demo 浏览器确认选择器位置、横排与直排表格的实际排版效果（happy-dom 无布局） |

---

## 相关

- 工具条按钮速查：[19](19-editor-toolbar-usage.md)
- 分块与分页规则：[04](04-reader-and-pagination.md)
- 表格 HTML 序列化与样式：[05](05-layout-and-html.md)
- Vue 组件与插槽 binding：[06](06-vue-integration.md)
- 编辑命令与 IR ⇄ PM：[02](02-editor-and-plugins.md)
