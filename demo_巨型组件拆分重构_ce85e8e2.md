# demo 巨型组件拆分重构

## 总原则

- **行为保持**：不改任何默认值、存储 key（`bt-demo:settings` 等）、事件名、class 名、导出路径；既有 9 个测试文件全部依赖独立模块（`ui-skin.ts` / `facsimile-theme.ts` / `composables/*`），其文件位置与导出名**不得变动**。
- **遵守规范**：文件 kebab-case、组件 PascalCase、统一具名导出、中文 JSDoc、2 空格/单引号/尾逗号；门面组件只做组装；禁止复制粘贴（重复的 wheel 滚动逻辑合并为一个组合式复用）。
- **每阶段验证**：`pnpm --filter @bibliotype/demo typecheck` + `pnpm --filter @bibliotype/demo test` + `pnpm --filter @bibliotype/demo build`，并 `pnpm --filter @bibliotype/demo dev` 手动冒烟当阶段涉及的链路（翻页/编辑/保存设置/导出/H5 抽屉）。
- **纯重构不附 changeset、不回写 docs**（demo 私有不发布，无用户可感知行为变化）；每阶段各给一条 `refactor(demo): …` 提交文本，由维护者提交（规范第八节）。

## 阶段 1：App.vue 逻辑抽离（script 1800 行 → 组合式 + 纯模块）

新增 `src/composables/`（按 App.vue 现有注释分块一一对应）：

| 新文件 | 迁出内容（App.vue 行号参考） |
| --- | --- |
| `use-app-themes.ts` | THEMES 主题定义、ThemeKey/ThemeConfig、night 夜间预设（L127–205、335–340） |
| `use-app-skin.ts` | uiSkin/uiDensity/uiMotion、activeSkin、setUiSkin、themePresetTokens 联动（L343–397） |
| `use-mobile-shell.ts` | breakpoint/mobileShell、mobileLayoutPatch、railLayout/verticalRail、mobileAsideOpen/mobileMenuOpen/mobileInspectorOpen、openMobileTab/openMobileInspector/onMobileAction（L242–333） |
| `use-layout-tokens.ts` | 版式补丁、effectiveLayout、facsimilePreset(Tokens)、activeFontToken、tokens/panelLayout/panelTokens、parseTokenNum、fontSizeNum/lineHeightNum 与回调、onApplyThemeTokens（L206–497） |
| `use-reader-session.ts` | createReader、readerEpoch、remeasure/scheduleRemeasure、measureContext/pageMainSize/bottomSlack、readerMetricsSignature、customized、switchTheme、attachPageTracking/onReadingPosition（L499–680、1003–1024） |
| `use-settings-snapshot.ts` | SettingsSnapshot read/apply/persist、lastPage/savedPosition localStorage 读写、hashString/bookIdFromTitle 纯函数（L847–1001） |
| `use-edit-session.ts` | mode、editorVisiblePage/editStartPage、editorReadonly、btEditorRef、captureSlotBinding/inspectorBinding、onEditorChange、saveAndPreview、toggleEditMode、onTocSelect（L679–760、1150–1188、1517–1538） |
| `use-view-mode.ts` | viewMode/effectiveViewMode/pageTransition/modeFallbackHint、cycleViewMode、viewModeLabel、flowSupported、onModeFallback（L688–707、1026–1108） |
| `use-editor-zoom.ts` | editorScale/editorStageRef、zoomStep/fitEditorWidth（L748–775） |
| `use-export.ts` | onExportEpub/PDF、getElectronPdfBridge、warnGlyphProblems、reportExportProblems、download、pdfExporting/pdfPagedMode、compareOpen（L1189–1375、1628–1644） |
| `use-toolbar-scroll.ts` | 工具栏 wheel + pointer 拖拽（L1376–1456）；**同时替换 EditorToolbar.onWheel（L898）的重复实现** |
| `use-suggestions.ts` | K3 句读/专名建议：runEditorCommand、onAccept/onReject/onCommitSuggestions（L1552–1627） |
| `use-aside-tabs.ts` | activeTab/toggleTab/activeTabLabel、settingsOpen/infoOpen/closeSettings、inspectorCollapsed/toggleInspector（L1457–1516、1676） |
| `use-book-meta.ts` | currentMetadata/bookTitle/infoEditable/onMetadataSave/onLibraryBook（L726–740、1646–1675） |
| `use-app-lifecycle.ts` | onKeydown/onVisibilityChange/onPageHide/onPageShow/onWindowBlur/onBeforeUnload 的注册与清理（L1678–1740） |

App.vue script 变为：引入组合式 + 组装接线（booted 启动流程、useDraftAutosave/useToast/useTocPrefs/usePerfProbe 等原调用保持原位）。组合式之间经参数传递依赖（依赖注入），不互相 import 全局单例。

## 阶段 2：App.vue 模板与样式拆分（template ~780 行 + style ~1100 行）

新增 `src/components/app/`：

- `AppTopBar.vue`：桌面顶栏（书名 chip、全局动作、工具栏滚动容器）+ H5 顶栏（L1876–1953 区域）；
- `AppStatusBar.vue`：底部状态栏（进度/翻页/视图切换/缩放，含直排转置后的状态栏列）；
- `MobileMoreSheet.vue`：H5「更多」菜单 sheet（L2287–2559 区域，含皮肤/缩放/PDF 模式紧凑行）;
- `MobileInspectorSheet.vue`：H5 编辑态属性拖拽 sheet（L2276–2286）。

主区（书页 + AsidePanels + 编辑器/阅读器）**留在 App.vue**——绑定面过密，拆出收益低风险高。

样式处理：
- 组件专属样式随模板迁入子组件 `<style scoped>`；
- App.vue 剩余全局骨架 grid、直排转置（约 L3099–3428）、H5 单列骨架（L3429–3512）拆为 `src/styles/app-shell.css`、`app-vertical-rail.css`、`app-mobile-skeleton.css` 三个文件，经 App.vue 多个 `<style scoped src="…">` 引入（scoped 语义不变）；
- props/emits 采用「分组对象传递」：整传组合式返回（如 `:skin="skinApi"`、`:shell="mobileShellApi"`），避免上百个标量 prop。

目标：App.vue ≤ 500 行。

## 阶段 3：SettingsPanel.vue（1732 行）

按面板分区拆到 `src/components/settings/`：

- `SettingsLayoutSection.vue`：页面尺寸/页边距/行距/余量（pageSizeKey/marginBox/slack*/numToken/numOf，L208–316）；
- `SettingsFacsimile.vue`：古籍仿真整块（facsimile/patchFacsimile/patchGutter/toggleGutter*/colorValue，L318–454）；
- `SettingsPageChrome.vue`：页眉页脚（L455–499）；
- `SettingsAppearance.vue`：外观主题令牌 + 字体列表 + 缺字检查（L154–202）；
- `SettingsUiSkin.vue`：皮肤/密度/动效（L581–594）；
- `SettingsStylesSection.vue`：命名样式 + 预设 + 翻页动效（L500–580）；
- `settings-utils.ts`：mergeTokens 等纯函数（就近放 `components/settings/`）。

SettingsPanel.vue 保留：导航、分区切换、特征样式（继续用 FeatureStyleEditor）、底部保存/关闭条。目标 ≤ 450 行。

## 阶段 4：EditorToolbar.vue（1107 行）

- `components/editor-toolbar-actions.ts`：L210–815 的巨型动作定义数组按组拆为纯工厂函数（入参为命令执行器与状态查询函数 `toggleMark/markOn/nodeOn/execute…`），返回 ToolbarAction[]——可脱离组件单测；
- `components/TableSizeMenu.vue`：表格尺寸网格选择器（L156–193 + 对应模板/样式）；
- `composables/use-toolbar-fold.ts`：H5 折叠（compactToolbar/expandedRows/isRowExpanded/toggleRow/visibleActions/hasFoldedActions，L824–896）；
- wheel 逻辑删除本地实现，改用阶段 1 的 `use-toolbar-scroll.ts`。

目标 ≤ 300 行。补一个 `__tests__/editor-toolbar-actions.test.ts` 冒烟单测（动作表结构完整性：key 唯一、label 非空、禁用条件纯函数）。

## 阶段 5：BookInfoDialog.vue（962 行）

- `src/catalog-export.ts`：DC JSON / CNMARC 导出、safeFilename/contributorText/schemeText/formatTimestamp、buildPatch 的元数据映射纯函数（L109–160）＋新增 `__tests__/catalog-export.test.ts` 单测；
- `composables/use-metadata-draft.ts`：Draft 状态、toDraft/norm/buildPatch、增删行操作（L163–360）；
- `components/BookInfoView.vue`（查看态模板 L362–约 540）与 `components/BookInfoEditForm.vue`（编辑态表单），BookInfoDialog 只剩遮罩/卡片/切换外壳。

目标：BookInfoDialog ≤ 200 行。

## 阶段 6：次级文件（400–650 行）

- `composables/use-style-settings.ts`（646 行）：拆出 `style-settings-persist.ts`（legacy key 迁移/快照序列化纯函数）、`use-style-presets.ts`（预设导出导入）；`useStyleSettings` 留在原文件作为组装门面——**文件路径与导出名不变**（两个测试文件引用它）；
- `composables/use-style-schema.ts`（501 行）：选项常量表 → `style-options.ts`；字段工厂 color/num/text/select/borderTriple/spacingFields → `style-field-helpers.ts`；STYLE_FIELDS 按现代节点 / 古籍标记两段拆为 `style-fields-core.ts`、`style-fields-classical.ts`，schema 文件保留 getStyleFields/listSections 门面与全部导出名；
- `components/LibraryDrawer.vue`（602 行）：按 tab 拆 `components/library/` 下 `LibraryShelf.vue`、`LibraryBackup.vue`、`LibraryCrypt.vue`、`LibraryRevisions.vue`、`LibraryVersions.vue`（脚本 L77–262 的注释分区即边界），容器保留 tab 导航与滚动锁；
- `src/styles.css`（309 行）：拆 `styles/base.css`、`styles/skins.css`（四套皮肤）、`styles/interaction.css`（触控反馈/焦点环），styles.css 保留 @import 作为入口（main.ts 引用不变）。

## 测试与验收

- 全程 4 条红线自查：无新增全局 CSS 选择器、无 console.log 遗留、无 any/@ts-ignore、无死代码；
- 最终全量：`pnpm typecheck` + `pnpm test`（turbo 全仓）；demo 构建通过、e2e 冒烟（`pnpm e2e:smoke`，Playwright 已配置）通过；
- 交付 6 条分阶段提交文本（`refactor(demo): …`），不自行 commit。

## 风险与假设

- 最大风险在阶段 2 模板拆分（顶栏/底栏/更多 sheet 与 Reader/Editor 状态互引多），采用整组 props 传入 + 事件上抛缓解；每阶段独立可回滚；
- 直排转置样式依赖 App.vue 根 grid 类名，拆 css 到 src 引用文件时保持选择器逐字不变；
- `<style scoped src>` 为 Vue 3 支持特性，若发现与现有 vite 配置冲突，退化为样式保留在 App.vue（不影响其余拆分）。