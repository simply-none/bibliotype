---
"@bibliotype/vue": minor
---

图片放大查看（lightbox）：阅读视图点击图片、编辑画布双击图片，弹窗等比放大查看内容。

- **新增 `BtImageLightbox` 组件**：Teleport 到 body 的暗色遮罩 + 居中等比大图（object-fit contain）+ 说明文字（字图显示「原字：X」、插图显示 alt）；关闭途径为遮罩点击 / Esc / 右上角关闭按钮，开启期间 `useScrollLock` 锁背景滚动（计数锁，可与抽屉等浮层叠加）；直排阅读流中字图的 90° 旋转不带入弹窗，恒以原图方向展示。视觉变量 `--bt-lightbox-mask` / `--bt-lightbox-color` / `--bt-lightbox-image-bg` 均带默认值。
- **新增 `useImageLightbox` 组合式与 `resolveImageTarget` 纯函数**：统一识别阅读页真 `<img>`（块级插图 / 行内字图，原字在 `data-char`）与编辑画布 `div.bt-image[data-src]` 三种形态，供宿主自定义视图接线。
- **`BtBookView` 新增 `imageLightbox` prop（缺省 false，向后兼容）**：开启后点击正文插图或行内字图弹窗放大，page / scroll / scroll-flow 三种模式均生效；命中即消费该次点击，不再触发翻页分区（单页模式点图不再翻页）。
- **`BtEditor` 新增 `imageLightbox` prop（缺省 false）**：开启后双击画布内图片弹窗放大——用双击避免与 ProseMirror 单击选中节点冲突。
- demo 宿主侧（私有包）：阅读视图与编辑画布开启 `image-lightbox`。
