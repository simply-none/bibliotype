---
"@bibliotype/core": minor
"@bibliotype/reader": minor
"@bibliotype/layout": minor
"@bibliotype/vue": minor
---

P3 阅读交互批次（D6 目录增强 / D9 注释交互 / D10 主题与外观市场）：

- **D6 目录增强**：`Reader` 新增 `getPageOfNode` / `getOutlineItemAtPage`（复用分页索引，不遍历文档），`useReaderBinding` 暴露 `activeOutlineItem` / `activeOutlineKey`；`BtToc` 支持当前章高亮（含 `aria-current` 与滚入视野）、折叠记忆（`v-model:expanded-keys`）、目录内搜索（过滤 + 命中高亮 + 自动展开父级）、缩略图映射（缺省首字占位）；新增 `BtSidebarResizer`（拖拽 / 双击复位 / 方向键步进 / `role="separator"`）与 `useTocView`、`buildTocViewItems` 纯函数。
- **D9 注释交互**：序列化补可定位锚点——注文 `data-note-id`、注码 `data-note-ref`（不改 `epub:type` 语义），书册 CSS 新增 `.bt-note-active` 激活态；`Reader` 新增 `getNoteAnchors` / `getPageOfNoteRef`；新增 `useNoteInteraction`（页容器事件委托、注码跳转、回跳、双向高亮、悬浮 / 聚焦 / 触屏预览、`Alt+←/→` 循环切换）与 `BtNotePreview`，`BtBookView` 在 page / scroll 两种模式接入。
- **D10 主题与外观市场**：`core` 新增主题包格式（`kind` + `schemaVersion` + `tokens`，字段顺序确定）与 `serializeThemePreset` / `parseThemePreset` / `validateThemePreset` / `applyThemePreset`、`ThemePresetError`、`createThemePresetCatalog` 与内置 `night` / `eye-care` / `parchment`；令牌校验 `THEME_TOKEN_KEYS` / `validateThemeTokenValue`；字形覆盖 `analyzeGlyphCoverage`（`GlyphProbe` 端口）。`vue` 新增 `BtThemePanel`、`BtFontFallbackPanel`、`useThemePresets`、`createFontCheckProbe`、`splitFontFamilyList`。
- **兼容性**：均为增量导出，既有函数签名不变；`serializeNode` 仅在注释块额外输出两个 `data-*` 锚点（EPUB / 站点 / PDF 同步），书册样式表新增激活态规则（仅阅读器加类时命中）；`applyThemePreset` 默认保留排版令牌，切换主题不影响用户自定义字号。
- **依赖**：生产依赖零新增；库内仍不写 localStorage，目录折叠 / 侧栏宽度 / 主题包落盘均由宿主负责。
