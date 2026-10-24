# 图片点击弹窗放大——实施方案

## 设计要点（基于调研）

- 阅读视图三模式（单页/对页、连续滚动、流式）正文均经 v-html 渲染，点击已是**事件委托**管道（`useNoteInteraction`：closest 命中即消费 + preventDefault）。图片弹窗作为新的一环插入该管道：**注文委托 → 图片命中（preventDefault + 开弹窗）→ 原翻页分区**。
- 编辑画布中块级 image 渲染为 `div.bt-image[data-src]`（无 img 子元素）、字图为真 `img.bt-glyph-image`——解析函数统一覆盖两种形态。编辑态用**双击**（dblclick）委托，避免与 PM 单击选中节点冲突。
- 弹窗组件仿 `BtDrawer` 骨架：`Teleport to body` + fixed 暗色遮罩 + Esc + `useScrollLock`，居中等比大图（max 92vw/92vh, object-fit contain）+ 右上角 × 按钮（触屏无 Esc）+ 说明文字（字图显示「原字：X」，插图显示 alt）。直排字图在弹窗中以原图方向展示。

## 改动清单

### 1. `packages/vue/src/components/BtImageLightbox.vue`（新增）
- props：`image: { src; alt?; char? } | null`（null 不渲染）；emits：`close`
- 关闭途径：遮罩点击 / Esc（组件内 keydown，仿 BtDrawer）/ × 按钮；开启时锁背景滚动
- 样式写在自身 SFC scoped（自动并入 dist/style.css）；z-index 用 `var(--ui-z-lightbox, 50)`

### 2. `packages/vue/src/use-image-lightbox.ts`（新增）
- 纯函数 `resolveImageTarget(el)`：识别 `img.bt-image` / `img.bt-glyph-image`（src/alt/data-char）/ `div.bt-image`（data-src/data-alt，编辑画布形态），其余返回 null
- 组合式 `useImageLightbox()`：image ref + open/close
- `src/index.ts` 按现有分组风格导出；`plugin.ts` 注册组件

### 3. `packages/vue/src/components/BtBookView.vue` 接线
- 新 prop `imageLightbox?: boolean`（默认 false，向后兼容；demo 显式开启）
- 单页模式 `onPageTap`：注文凭据判断后、翻页分区前插入图片判断；scroll / flow 根容器 @click 换为组合 handler（注文凭据 → 图片 → 结束）
- 模板挂 `<BtImageLightbox>`

### 4. `packages/vue/src/components/BtEditor.vue` 接线
- 新 prop `imageLightbox?: boolean`（默认 false）；根容器 `@dblclick` 委托，命中即开弹窗；模板挂 `<BtImageLightbox>`

### 5. demo 接线
- `App.vue` 的 `BtBookView`（:581）与 `BtEditor`（:598）加 `:image-lightbox="true"`

### 6. 测试（packages/vue/src/__tests__/）
- `bt-image-lightbox.test.ts`（happy-dom）：image null 不渲染；打开渲染 src 与说明文字；Esc / 遮罩 / × 三途径 emit close
- `resolveImageTarget` 三形态命中 + 非图片返回 null
- BtBookView / BtEditor 接线经 demo 手动验证

### 7. 文档与 changeset
- `docs/06-vue-integration.md`：新增组件、组合式与 prop 说明
- 新 changeset：`@bibliotype/vue` minor（新增组件与可选 prop，向后兼容）

## 验证
- `pnpm build` + `pnpm test` + `pnpm typecheck` 全量
- demo 手动：四种阅读模式下点击插图 / 字图弹窗放大（含直排）、编辑画布双击放大、Esc / 遮罩 / × 关闭

## 交付
提交文本（由维护者提交）：
`feat(vue): BtImageLightbox 图片点击弹窗放大——阅读视图委托接入 + 编辑画布双击放大，demo 开启`