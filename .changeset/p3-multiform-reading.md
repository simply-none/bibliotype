---
"@bibliotype/core": minor
"@bibliotype/reader": minor
"@bibliotype/vue": minor
---

P3 多形态阅读（D5）与历史遗留修复：

- **遗留修复（恢复链路宽容）**：`restoreLibrary` 与 `restoreSnapshot` 的校验选项现透传 `validateDocument`；**恢复路径默认把未知节点 / 标记类型降级为 warning**（而非直接判非法），因此含古籍插件标记（`collation-mark` / `judou` 等）的合法文档可正常备份恢复、可正常回滚历史版本。显式调用 `validateDocument`、传入 `validate: false` 或 `unknownTypesAsWarning: false` 仍保持严格。`core` 新增 `RESTORE_VALIDATE_DEFAULTS` / `validateRestoredDocument` 与 `RestoreValidationOptions`；`restoreSnapshot` 成功分支可额外回传 `warnings`。
- **流式阅读（`scroll-flow`，横排）**：`reader` 新增 `buildFlowChunks`（`maxBlocksPerChunk` / `maxCharsPerChunk` 双上限、按章切块、确定性 key）、`Reader.getFlowChunks` / `getNode` / `getBlockIndex` / `getFlowChunkIndex` / `getPositionForNode`（按块序号取锚点位置，与既有 `restorePosition` 兼容）；`vue` 新增 `flow-model` 纯函数（`estimateFlowChunkHeight` / `resolveMountWindow` / `resolveAnchorChunkIndex` / `adjustScrollOffset`）与 `prefers-reduced-motion`，`BtBookView` 新增 `scroll-flow` 模式——按章分块、视口窗口懒挂载、骨架占位、滚动后实测高度校正、以锚点持久化进度（`initialPosition` / `update:position`），并支持 `flowChunkBlocks` / `flowRootMargin` / `estimateFlowHeight`。
- **翻页动效**：`BtBookView` 新增 `pageTransition`（`none` / `slide` / `fade`，默认 `slide`），横排滑动 / 直排方向自适应，尊重系统「减少动态效果」与显式关闭；`vue` 导出 `usePrefersReducedMotion`。
- **双页对照容器**：`vue` 新增纯布局容器 `BtSpreadLayout`（双栏 / 对页、中缝、标签）与 `BtCompareView`（单文档退化对页；传第二份文稿时左右并排、页码双向同步含重入守卫与越界钳制），`BtCollationCompare` 的 facing 模式改为复用 `BtSpreadLayout`（保留 `.bt-collation-compare__pane` 与 `data-role`，既有测试不受影响）。
- **兼容性**：`BtBookView` 的 `mode` 仅扩展联合类型，`page` / `scroll` 分支代码路径与产物不变；`restoreLibrary` / `restoreSnapshot` 增加可选参数，**默认行为由「未知类型即失败」改为「未知类型降级告警」属有意行为修正**——含插件类型的文档此前会被整库恢复 / 历史回滚拒绝，现已可正常恢复；如需维持旧严格口径，传 `unknownTypesAsWarning: false` 即可。生产依赖零新增，库内不写存储。
