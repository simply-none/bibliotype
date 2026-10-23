---
"@bibliotype/layout": minor
"@bibliotype/vue": minor
---

新增版面设置「开本适配」（`LayoutOptions.pageSizeMode`），其中「自适应宽度 / 高度」为 **PDF 式整页视图缩放**（修「自适应时字体没跟着缩放」）：

- **取值表**：`PAGE_SIZE_MODES` = `width / height / h5 / fixed`，默认 `fixed`；缺省与落盘脏值经 `resolvePageSizeMode` 归一为 `fixed`，旧快照与既有主题字面量视觉零变化。
- **`resolvePageFitScale(options, stage?)`**（layout 新增）：`width` 档返回 `舞台宽 / 页宽`、`height` 档返回 `舞台高 / 页高`（允许 >1 放大，限幅 0.2~4，保留三位小数防每帧新值）——页框与分页**保持开本不动**，整页（文字、版心、页脚）按倍率等比缩放，与 PDF「适合宽度 / 适合高度」一致；不做页框重排（重排只改行宽 / 行数，字号仍按令牌落地）。`fixed` / 量不到同名轴返回 `undefined` = 不覆盖（SSR 安全）；`h5` 档恒返回 `1`（页框已按可视宽高落地，文字保持预设字号）；仿真版式不禁用——width / height 档页框恒为开本、整页 transform 等比缩放（版框 / 界行随缩放保真，不会错位），与古籍仿真兼容。两档不改页框 → 度量签名不变 → **不重量尺**，拖动窗口只是重新缩放，导出与分页几何恒为开本。
- **`applyPageSizeMode(options, stage?)`**：只有 `h5` 动几何——网页式布局，页框直接取舞台可视宽高（宽高都跟随、不设轴限幅）+ 强制单栏，文字按令牌原尺寸落地；舞台未实测回退 `H5_PAGE_SIZE`（340×560）；`width` / `height` / `fixed` 原样返回。`facsimile` 已启用时只锁几何折算（`h5` 档不覆盖）：版框 / 界行按固定开本，改几何会让界行与文字列错位；`width` / `height` 档不改几何、整页 transform 等比缩放，与仿真兼容。随包导出 `H5_PAGE_SIZE`（340×560，不进 `PAGE_SIZES` 预设表）与 `StageBoxSize` 类型。
- **`BtBookView.fitScale?: number`**（vue 新增 prop，`page` / `scroll` 模式）：传入有限正数时直接作为整页缩放倍率（覆盖 `contain` 与 `Math.min(1, ratio)` 的「只缩不放」），另受横向安全阀约束（不超过容器可用宽 / 页宽，不致冒出横向滚动条或裁掉页缘），激活时预留 `scrollbar-gutter: stable` 槽位使可用宽不随溢出二次变化（重算 watch 为 post-flush，避免档位切换瞬间读旧宽恰差一个滚动条宽）；page 模式纵向溢出由本容器滚动承接（`overflow: auto` + `margin: auto` 居中退化起点锚定，滚轮在溢出时让位原生滚动，不溢出时零视觉变化），scroll 模式槽位宽同步为 页宽 × 倍率（修「槽位固定页宽两边留白」）。未传 / 非法值回退原 `fit` 策略；`scroll-flow` 模式不受影响。

demo 宿主侧（私有包）：面板下拉四档固定文案（自适应宽度 / 自适应高度 / 自适应 H5 / 固定，不随书写方向换词）；新增 `use-stage-size`（`ResizeObserver` 实测 `.app__stage` 并按 computed style 扣内边距）；`use-layout-tokens` 按「主题基准 → 窄屏适配缺省 → 用户补丁 → 折算」合并生效层并暴露 `fitScale`，同时喂给 `BtBookView :fit-scale` 与编辑画布 `editorScale`（编辑态限幅 0.2~2，超出走画布横向滚动）；面板回显改读声明层，并在宽 / 高档下另回显生效层倍率（「视图缩放 ×N.NNN」，量不到舞台时明示回退固定开本，消除静默失效）；废除旧的 `mobileLayoutPatch` 无条件压页宽，窄屏只在用户未选过适配时缺省按 `h5` 取形；`use-editor-zoom` 的「适应」改用同一份舞台实测值。
