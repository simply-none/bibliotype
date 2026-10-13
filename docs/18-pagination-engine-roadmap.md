# 18 纸书排版引擎路线图

> 目标：分页行为对齐纸书排版逻辑——**页是固定框、正文如水流动**（段落可在行处跨页断开、
> 有孤寡行控制、标题不落地），预览 / 编辑 / 导出三方同源。

## 市场调研结论（2026-10）

| 方案 | 定位 | 编辑态可用性 |
| --- | --- | --- |
| Paged.js / Vivliostyle | CSS Paged Media polyfill，静态分页流（页眉页脚 / 对页 / 脚注） | 不可用：重写 DOM、破坏 contenteditable；适合后续 PDF 导出管线 |
| prosemirror-pagination | `doc = page+` 页节点入数据模型 | 不可用：已停止维护；PM 作者明确反对分页入模型（页边界增删摧毁选区映射） |
| Badon Writer | 300+ 页真分页编辑器（CSS 布局、不拆节点） | 闭源；思路与本项目一致，可借鉴 |
| ProseMirror 社区共识 | 连续文档 + decorations / 占位画页边界（Google Docs 同款） | **本项目采用路线** |

结论：无可直接引入的开源编辑态分页引擎；差异化能力（CJK 行网格、古籍版式）必须自建。

## 现状与差距

`@bibliotype/layout` 分页器已具备：贪心装箱、`breakBefore` / `breakAfter`（章首 / 卷末另起页）、
`keepWithNext`（标题 + 首段同页）、超大块独占一页。

与纸书的差距：**块原子归属**——段落装不下时整块挪页（纸书在行处断开），且缺孤寡行控制。

## 阶段计划

- **Phase 1（已完成）编辑态止血**：`BtEditor` 横排断页尺寸改用编辑器 DOM 实时实测
  （相邻叶块顶边差），与纸张定位同源；不再依赖外部旧 `blockSizes`（仅直排 / 多栏回退）。
  纸张逐页等高，超高页随内容增高、不溢出纸外。
- **Phase 2 layout 行级拆分**：`MeasurableBlock` 增 `lineSize` / `splittable`；
  `paginate` 输出页内片段（`fromLine` / `lineCount`），含孤寡行约束（拆分后首页片段
  与续页片段各 ≥ 2 行，可配）；超高块按每页可容纳行数连续拆分。
- **Phase 3 预览同源**：`extractBlocks` 为正文段落输出 `splittable` + `lineSize`；
  `pagination-measure` 量尺输出扩展 `{ advance, lineSize }`；`BtBookView` 片段以
  裁剪窗口渲染（固定高 + overflow hidden + `translateY(-fromLine * lineSize)`），不拆 IR / DOM。
- **Phase 4 编辑态像素级对齐**：`BtEditor` 与预览共用同一 paginate 结果（含片段），
  页边界允许落在段落中间，续页片段首行按行网格对齐到下一张纸内容区首行。

## 暂缓项

- 直排（vertical-rl）行级拆分 = 列级拆分（量尺目前对直排回退估算，维持块级行为）；
- 多栏（columns > 1）分页、脚注浮注、对页（recto / verso）与奇偶页眉；
- PDF 导出管线评估（Paged.js / Vivliostyle / 打印 CSS），与编辑态解耦；
- ruby 注音导致行高不均时的实测行盒精修（当前按均匀行高算术）。

相关实现：`packages/layout/src/paginator.ts`、`packages/reader/src/document-blocks.ts`、
`packages/vue/src/pagination-measure.ts`、`packages/vue/src/components/BtEditor.vue`、
`packages/vue/src/components/BtBookView.vue`。
