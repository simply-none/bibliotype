---
"@bibliotype/layout": minor
---

版面设置的「开本适配」从契约字段接成真实几何（修「点了保存不生效」）：

- **`applyPageSizeMode(declared, stage?)`**：把声明布局折算成生效几何。「自适应」拆成显式绑轴两档，互不混淆：`width` 页宽绑舞台实测值（限幅 240~1600）、页高按开本宽高比反推；`height` 对称（页高绑舞台、页宽反推）。两档都**绝不拉伸开本**（取代早先的单一 `auto`：先是把两轴硬铺舞台盒把竖版顶成横扁页，后是等比 contain 由折算方挑轴、用户看不出绑了哪条）；反推轴超出舞台由视图层 contain 回收。`h5` 页宽落 340 + 强制单栏、页高仍铺舞台；`fixed`（缺省）原样返回。`facsimile` 已启用时任何适配都不覆盖页型；`width` / `height` 量不到同名轴时原样返回（SSR 安全，不拿另一轴臆造）。
- **取值表变更（未发布，无迁移负担）**：`PAGE_SIZE_MODES` 从 `auto / h5 / fixed` 改为 `width / height / h5 / fixed`；历史快照里的旧值 `auto` 按脏值经 `resolvePageSizeMode` 归一为 `fixed`，面板重选一次即可。
- **`H5_PAGE_SIZE`**（340×560）：从 demo 私有能力上移为布局层常量，不进 `PAGE_SIZES` 预设表（避免出现在开本下拉里）；随包导出 `StageBoxSize` 类型。
- **度量与重排**：折算产出的是真实 `pageSize` / `columns`，二者已在 `computeMetricsSignature` 参与项内 → 预览 / 编辑画布 / 导出自动重量尺重排，本字段无需另行进签名；宿主须在舞台可用尺寸变化时重调本函数。
- **兼容性**：`LayoutOptions.pageSizeMode` 仍为可选，缺省经 `resolvePageSizeMode` 归一为 `fixed`，旧快照与既有主题字面量视觉零变化，无需迁移。demo 面板下拉同步改为四档固定文案（自适应宽度 / 自适应高度 / 自适应 H5 / 固定），不再随书写方向换词。

demo 宿主侧（私有包）：新增 `use-stage-size`（`ResizeObserver` 实测 `.app__stage` 并按 computed style 扣内边距），`use-layout-tokens` 按「主题基准 → 窄屏适配缺省 → 用户补丁 → 折算」合并生效层，面板回显改读声明层；废除旧的 `mobileLayoutPatch` 无条件压页宽（它会推翻用户显式选的「固定 / 自适应」），窄屏只在用户未选过时缺省按 `h5` 取形；`use-editor-zoom` 的「适应」改用同一份舞台实测值。
