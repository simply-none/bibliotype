---
"@bibliotype/layout": minor
---

版面设置新增「开本适配」契约字段：

- **`LayoutOptions.pageSizeMode`（可选）**：取值表 `PAGE_SIZE_MODES`（`auto` 交叉轴自适应 / `h5` 窄屏视口取页宽 / `fixed` 严格按开本 px），默认 `PAGE_SIZE_MODES.FIXED`；三个布局预设（`DEFAULT_LAYOUT_OPTIONS` / `CLASSICAL_LAYOUT_OPTIONS` / `FACSIMILE_BASE_LAYOUT`）均显式声明固定。
- **`resolvePageSizeMode`**：读取入口，缺省与落盘脏值统一归一为 `fixed`，保证旧快照视觉零变化；随包导出 `DEFAULT_PAGE_SIZE_MODE` 与 `PageSizeMode` 类型。
- **设置面板**：「版面与页面」分区在开本 / 分栏之后增「开本适配」下拉，选项文案随书写方向换词（横排「自适应宽度」、直排「自适应高度」），改动经布局补丁写入样式草稿并随本书快照持久化。
- **已知边界**：本字段当前只记录意图，`resolvePageMainSize` / `resolvePageCrossSize` 与度量签名均不读它——切换适配不改变分页归属也不触发重排；几何接线时须同步将其纳入 `computeMetricsSignature` 参与项。
