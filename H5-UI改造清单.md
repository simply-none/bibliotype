# H5（移动端 Web）UI 改造清单

> 目标：让阅读 / 编辑 / 面板工具在手机浏览器（375–768px 视口）与 WebView 下可用、
> 可读、可触控；桌面布局零回归。
> 勾选口径：`[ ]` 待开始｜`[x]` 已完成。改造实施时逐项勾选。
> 完成定义：样式/交互改造 + happy-dom 可断言的语义钩子（aria / 断点类名）+ `docs/06` 回写 + changeset，四项齐才算完成。
> 改造原则：**H5 样式一律走 `@media` / 容器查询增量，不改桌面默认值**；组件库（`@bibliotype/vue`）与宿主（demo）分层改造，宿主负责布局骨架，组件负责自身自适应与触摸交互。

---

## 进度总览

| 批次 | 项数 | 主题 | 状态 |
| --- | --- | --- | --- |
| 批 A | 6 | P0 阅读链路 H5（布局骨架 / 分页 / 手势 / 目录） | [x] |
| 批 B | 6 | P1 编辑链路 H5（软键盘 / 工具条 / 选区） | [x] |
| 批 C | 6 | P2 面板与工具 H5（侧栏抽屉化 / 模态全屏化） | [x] |
| 批 D | 7 | P3 全局基建（断点体系 / 触控规范 / safe-area） | [x] |
| 合计 | 25 | — | [x] |

> 建议顺序：批 D 的 D1（断点 composable）先行或与批 A 同批——后续各批都依赖断点判定；批 A → B → C 按使用频率排序；批 D 其余项可穿插执行。

---

## 批 A P0 阅读链路 H5

### A1 demo App 移动布局骨架

- **现状问题**：`apps/demo/src/App.vue` 为桌面三层 chrome——顶栏 + 左栏 tab 面板（目录/搜索/书签/导入）+ 右栏属性检视器 + 主区 + 底部状态栏；直排模式把五行 chrome 整体旋 90° 变成五条竖列。窄屏（<768px）三栏挤压，阅读区不可用。
- **改造要点**：
  - [x] 断点 <768px 切换为「单列 + 底部导航」：阅读区全屏；目录 / 搜索 / 书签 / 导入 tab 收进左抽屉；属性检视器收进底部 sheet
  - [x] 顶栏压缩为「书名 + 保存状态 + 菜单（更多）」单行；导出 / 设置 / 主题等全局动作进菜单
  - [x] 直排竖列布局（.app--rail）在 H5 禁用，chrome 恢复常规横排摆位
  - [x] 底部状态栏（进度 + 翻页器）常驻阅读态
- **涉及文件**：`apps/demo/src/App.vue`、`apps/demo/src/styles.css`
- **验收**：375×667 视口下阅读区满屏、无横向滚动；≥1024px 桌面布局与改前逐像素一致。

### A2 BtBookView 窄屏分页版式

- **现状问题**：页面按桌面版式设计（等比缩放自适应），H5 窄屏整页缩小后字号不可读；直排页宽与版心按桌面标定。
- **改造要点**：
  - [x] demo 增 H5 版式预设（窄页宽 / 版心边距 / 字号令牌重标定），经既有 `layoutPatch` / `tokenPatch` 双层机制注入，不改组件默认值
  - [x] 直排（vertical-rl）与横排分别标定移动版心；主题切换联动保持
  - [x] 等比缩放逻辑在断点内以「容器宽 = 页宽」为准，避免双重缩放
- **涉及文件**：`apps/demo/src/App.vue`（预设）、`packages/vue/src/components/BtBookView.vue`
- **验收**：375px 宽下直排 / 横排两模式版心正文等效字号 ≥14px；翻页 / 重排正常。

### A3 BtPager 触摸翻页手势

- **现状问题**：翻页仅按钮点击 + 键盘 ←/→；触屏无手势。
- **改造要点**：
  - [x] 阅读区左右滑动翻页（阈值 ~50px，速度方向判定），直排 RTL 翻页方向与滑动方向正确映射
  - [x] 点击左 / 右边缘区域翻页（阅读器惯例）；点击中部呼出 / 收起 chrome（可后续扩展）
  - [x] 滑动手势与文本选择 / 滚动冲突消解（仅在无选区且页面无纵向滚动余量时触发）
- **涉及文件**：`packages/vue/src/components/BtPager.vue`、`BtBookView.vue`
- **验收**：横排左滑 = 下一页；直排滑动方向与阅读方向一致；滑动不误选文本。

### A4 BtToc 目录抽屉化

- **现状问题**：目录为左栏常驻 tab，窄屏无空间。
- **改造要点**：
  - [x] H5 下目录改为左滑抽屉（遮罩 + 边缘手势呼出 + 遮罩点击关闭）
  - [x] 抽屉内保留 BtTocItem 跳转定位，跳转后自动收起
- **涉及文件**：`packages/vue/src/components/BtToc.vue`、`BtTocItem.vue`、demo App
- **验收**：抽屉打开不挤压阅读区；跳章后抽屉自动关闭并定位到对应页。

### A5 BtNotePreview 注音 / 注释预览触摸化

- **现状问题**：预览卡片按 hover 触发与鼠标定位，触屏无法使用。
- **改造要点**：
  - [x] 触屏改为点按切换 / 长按呼出；点击卡片外区域关闭
  - [x] 卡片定位改为跟随目标的浮动层（防溢出屏幕边缘翻转）
- **涉及文件**：`packages/vue/src/components/BtNotePreview.vue`
- **验收**：移动端可打开 / 关闭预览；卡片不超出视口。

### A6 底部状态栏 H5 化

- **现状问题**：阅读态底栏 = 进度条 + 翻页器 + 视图切换，一行在窄屏溢出。
- **改造要点**：
  - [x] H5 保留进度 + 翻页器；次要控件（视图切换 / 双页对照入口）收进「更多」菜单
  - [x] 进度条支持拖动跳页（触摸）
- **涉及文件**：`apps/demo/src/App.vue`（底栏宿主）、`BtPager.vue`
- **验收**：375px 宽下底栏单行不溢出；拖动进度条可跳页。

---

## 批 B P1 编辑链路 H5

### B1 BtEditor 软键盘与视口适配

- **现状问题**：编辑画布假设桌面视口；软键盘弹出遮挡光标所在行，contenteditable 获得焦点时页面可能被系统顶起后不复位。
- **改造要点**：
  - [x] 监听 `visualViewport` resize / scroll，软键盘弹出时滚动定位到光标
  - [x] 编辑区底部动态 padding（键盘高度补偿）；收起键盘后视口复位
  - [x] `interactive-widget=resizes-content`（viewport meta，配合 D4）
- **涉及文件**：`packages/vue/src/components/BtEditor.vue`、demo viewport meta
- **验收**：软键盘弹出后光标始终可见；收起后无布局残留偏移。

### B2 EditorToolbar 工具条 H5 化（demo 宿主）

- **现状问题**：仿 Word 功能区多行横向排布；悬浮用法提示（ToolbarUsageTip）依赖 hover。
- **改造要点**：
  - [x] H5 压缩为单行可横滚（或收进「Aa 格式」底部弹出条）；分组折叠
  - [x] ToolbarUsageTip 在触屏禁用（hover 提示改长按或直接移除）
  - [x] 常用动作（加粗 / 标题 / 注音）保留为直出按钮
- **涉及文件**：`apps/demo/src/components/EditorToolbar.vue`（宿主）、ToolbarUsageTip
- **验收**：375px 宽下无换行溢出；核心格式动作一键可达。

### B3 BtSelectionReplaceMenu 触摸选区适配

- **现状问题**：替换菜单按鼠标选区定位；触摸选择依赖系统手柄，菜单定位与关闭时机需重算。
- **改造要点**：
  - [x] 菜单定位避让选区手柄与软键盘；防溢出翻转
  - [x] 触摸滚动 / 选区变化时即时关闭；点按菜单项不丢失选区
- **涉及文件**：`packages/vue/src/components/BtSelectionReplaceMenu.vue`
- **验收**：触摸选择文本后菜单出现且可点；滚动 / 失焦正常关闭。

### B4 BtTableSizePicker 触控目标

- **现状问题**：表格尺寸网格按鼠标悬停精度设计，触点过小。
- **改造要点**：
  - [x] 网格单元触控目标 ≥44px（触屏断点下放大格子）
  - [x] 点按确认（桌面 hover 预览 + 点击确认逻辑保留）
- **涉及文件**：`packages/vue/src/components/BtTableSizePicker.vue`
- **验收**：触屏可准确选中目标行列。

### B5 属性检视器底部 sheet 化

- **现状问题**：编辑态右栏纵向 inspector（Word 任务窗格式）窄屏无处安放。
- **改造要点**：
  - [x] H5 收进底部可拖拽 sheet（半屏态 + 全屏态），选中节点变化时联动
  - [x] 与 BtSidebarResizer 的拖宽逻辑互斥（触屏用拖拽把手）
- **涉及文件**：`apps/demo/src/App.vue`（属性栏宿主）、`BtSidebarResizer.vue`
- **验收**：编辑态选中节点后 sheet 内容联动；拖拽高度顺滑。

### B6 编辑自动保存的移动端生命周期

- **现状问题**：自动保存已做「节流合并 + 空闲落盘 + 单飞去重」与 visibilitychange 兜底；移动端还需处理 WebView 切后台被杀、切应用不触发 beforeunload 的场景。
- **改造要点**：
  - [x] `pagehide` / `visibilitychange` 兜底落盘核对补齐（pageshow 恢复）
  - [x] 键盘收起（blur）作为一次节流保存触发点
- **涉及文件**：`apps/demo/src/composables/use-draft-autosave.ts`
- **验收**：编辑后直接切后台再回，内容不丢（草稿可恢复）。

---

## 批 C P2 面板与工具 H5

### C1 侧栏统一抽屉化（标注 / 修订 / 版本）

- **现状问题**：BtAnnotationSidebar / BtAnnotationSuggestions / BtRevisionSidebar / BtVersionHistory 为桌面侧栏，窄屏挤压主区。
- **改造要点**：
  - [x] 统一抽屉容器（右滑抽屉 + 遮罩），侧栏内容组件原样嵌入（组件内部布局自适应窄宽）
  - [x] 侧栏内操作按钮触控目标 ≥44px
- **涉及文件**：上述四个组件 + demo 抽屉宿主
- **验收**：各侧栏在抽屉中可用、滚动顺滑；桌面侧栏行为不变。

### C2 模态全屏化（设置 / 信息 / 导出 / 面板类）

- **现状问题**：BtThemePanel、BtBackupPanel、BtEncryptionPanel、BtFontFallbackPanel、BtGlyphAuditPanel、BtDocumentStats 及书籍信息 / 导出弹窗按桌面模态设计，窄屏内容截断。
- **改造要点**：
  - [x] H5 断点下模态转全屏页（或底部全高 sheet），底部安全区留白（配合 D3）
  - [x] 表单控件触控目标与间距核对
- **涉及文件**：上述六个面板组件 + demo 弹窗宿主
- **验收**：各面板在 375px 宽下内容完整、可滚动、按钮可达。

### C3 BtSidebarResizer 触屏禁用

- **现状问题**：拖宽把手依赖鼠标拖拽，触屏无意义且误触。
- **改造要点**：
  - [x] 触屏断点隐藏把手（抽屉 / sheet 自身接管宽度与高度）
- **涉及文件**：`packages/vue/src/components/BtSidebarResizer.vue`
- **验收**：触屏不见把手且无拖拽副作用；桌面不受影响。

### C4 BtSpreadLayout 对页降级单页

- **现状问题**：对页（双页并排）在窄屏并排放不下。
- **改造要点**：
  - [x] 断点 <768px 对页自动降级单页（`facing` 关闭），恢复宽视口自动还原
- **涉及文件**：`packages/vue/src/components/BtSpreadLayout.vue`
- **验收**：窄屏单页正常、宽屏对页如旧，切换无残留状态。

### C5 对照视图窄屏堆叠

- **现状问题**：BtCollationCompare / BtCompareView 双栏并排对照，窄屏挤压。
- **改造要点**：
  - [x] 窄屏改上下堆叠（或原文 / 校本 tab 切换），滚动同步逻辑按模式调整
- **涉及文件**：`BtCollationCompare.vue`、`BtCompareView.vue`
- **验收**：窄屏下对照内容完整可读，滚动联动不错位。

### C6 BtBookShelf 书架响应式

- **现状问题**：书架网格按桌面列数设计。
- **改造要点**：
  - [x] 网格列数随视口自适应（375px → 2 列）；卡片触控目标 ≥44px
- **涉及文件**：`packages/vue/src/components/BtBookShelf.vue`
- **验收**：375px 宽 2 列不溢出；长按 / 点按操作可用。

---

## 批 D P3 全局基建

### D1 断点体系（先行项）

- **现状问题**：无统一断点判定，各组件自行感知尺寸；CSS 与 JS 断点可能漂移。
- **改造要点**：
  - [x] CSS 断点变量（`--bt-bp-sm: 640px; --bt-bp-md: 768px; --bt-bp-lg: 1024px`）
  - [x] `useBreakpoint()` composable（matchMedia 驱动，SSR 安全），demo 与组件共用
  - [x] 组件内触屏判定统一走断点 / `pointer: coarse` 媒体查询
- **涉及文件**：`packages/vue/src/composables/`（新增）、demo
- **验收**：resize / 旋转时断点切换正确；SSR 渲染不报 mismatch。

### D2 触控目标 ≥44px 全局规范

- **现状问题**：部分按钮 / 图标按桌面 24–32px 设计。
- **改造要点**：
  - [x] 触屏断点下全局最小触控目标（点击区补 padding，不改视觉尺寸）
  - [x] 对现有组件做触点 audit（清单化超小目标并逐个修复）
- **涉及文件**：各组件样式、demo styles.css
- **验收**：audit 清单归零；误触率明显下降。

### D3 safe-area 与刘海屏

- **现状问题**：未处理 `env(safe-area-inset-*)`，全屏 / 底部导航在刘海屏被遮挡。
- **改造要点**：
  - [x] viewport meta `viewport-fit=cover`
  - [x] 底部导航 / 底栏 / 全屏 sheet padding 加 safe-area；横屏左右安全区
- **涉及文件**：demo index.html、styles.css、App.vue
- **验收**：iPhone 模拟器（刘海）下底栏与 sheet 不被遮挡。

### D4 viewport 与字体缩放

- **现状问题**：未确认 viewport meta 完整策略；系统字号放大时布局可能破。
- **改造要点**：
  - [x] viewport meta 定稿（含 `interactive-widget=resizes-content`、`viewport-fit=cover`）
  - [x] 尺寸单位尽量 rem / em 跟随系统字号；禁止 `text-size-adjust` 意外放大
  - [x] 与 A2 版式预设核对：系统字号放大不破版（降级为可接受）
- **涉及文件**：demo index.html、styles.css
- **验收**：系统字号调大 120% 后关键页可读不破版。

### D5 滚动锁定与橡皮筋

- **现状问题**：抽屉 / 弹层开启时背景仍可滚动（iOS 橡皮筋），定位漂移。
- **改造要点**：
  - [x] 抽屉 / sheet / 全屏模态开启时 body 锁滚（`overscroll-behavior` + 位置补偿）
  - [x] 关闭后恢复滚动位置
- **涉及文件**：抽屉 / 模态宿主（demo）、共享 composable
- **验收**：iOS Safari 开抽屉背景不动，关闭后位置不变。

### D6 桌面回归保障

- **现状问题**：H5 增量样式若误写进桌面默认值会造成回归。
- **改造要点**：
  - [x] 约定：所有 H5 样式在 `@media (max-width: ...)` / `pointer: coarse` 内，PR 审查口径
  - [x] happy-dom 断点模拟测试（断点类名 / aria 钩子断言）；桌面截图基线（B3 上线后并入像素回归）
- **涉及文件**：相关组件测试、e2e 工程（批 4 I1 落地后挂用例）
- **验收**：桌面布局零 diff；触屏断点用例全绿。

### D7 横竖屏切换重排

- **现状问题**：旋转屏幕后分页 / 对页状态可能不刷新（视口宽高变化需重排）。
- **改造要点**：
  - [x] orientation 变化触发重排（复用既有 repaginate 链路）与对页降级重判（C4）
  - [x] 防抖处理，避免软键盘触发的 resize 误判为旋转
- **涉及文件**：demo App、`useBreakpoint` / `BtBookView`
- **验收**：旋转后页数与版式正确重建；键盘弹出不误触发重排。

---

## 执行约定

1. **分层**：布局骨架 / 导航形态归宿主（demo）；组件自身自适应与触摸交互归 `@bibliotype/vue`；组件默认（桌面）行为不变。
2. **断点增量**：H5 样式一律 `@media` / `pointer: coarse` 增量；JS 侧统一 `useBreakpoint`，禁止组件内手写宽度魔法数。
3. **完成定义**：改造 + 语义钩子测试（happy-dom 可断言的 aria / 类名 / 断点行为）+ `docs/06` 回写 + changeset。
4. **验证命令**：`pnpm build` / `pnpm test` / `pnpm typecheck`；视口类验收用浏览器设备模拟（375×667 / 414×896 / iPad 768×1024）。
5. **一批一提交**：Conventional Commits 中文描述（如 `feat(demo): 阅读链路 H5 布局骨架（A1）`）。
6. **与 P4 清单的关系**：批 D6 的像素 / e2e 回归在 P4 批 4（I1 / B3）落地后挂用例；H5 改造不阻塞 P4 推进。

## docs 回写索引

| 批次 | 回写 docs | 内容 |
| --- | --- | --- |
| 批 A | `docs/06`（阅读交互篇） | 移动布局骨架、手势翻页、目录抽屉 |
| 批 B | `docs/06` | 软键盘适配、工具条、选区菜单 |
| 批 C | `docs/06` | 抽屉 / 全屏化面板规范 |
| 批 D | `docs/06` + `docs/12`（工程篇） | 断点体系、触控规范、safe-area 约定 |
