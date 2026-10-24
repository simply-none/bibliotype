---
"@bibliotype/vue": minor
---

图片放大查看（lightbox）：阅读视图点击图片、编辑画布双击图片，弹窗等比放大查看内容。

- **新增 `BtImageLightbox` 组件**：Teleport 到 body 的暗色遮罩 + 居中等比大图（object-fit contain）+ 说明文字（字图显示「原字：X」、插图显示 alt）；关闭途径为遮罩点击 / Esc / 右上角关闭按钮，开启期间 `useScrollLock` 锁背景滚动（计数锁，可与抽屉等浮层叠加）；直排阅读流中字图的 90° 旋转不带入弹窗，恒以原图方向展示。视觉变量 `--bt-lightbox-mask` / `--bt-lightbox-color` / `--bt-lightbox-image-bg` 均带默认值。
- **弹窗内缩放 / 平移**：滚轮（以光标为锚）与双指捏合（以指心为锚）缩放 1×~8×，放大后拖拽平移（限幅不出视野），双击图片复位；缩放与平移状态每次打开重置，拖拽 / 捏合结束的 click 不当点按关闭遮罩。手势监听全部绑在弹窗根元素上，关闭即随 `v-if` 卸载自动摘除，不干扰阅读层翻页滚轮与原生手势（`touch-action: none` + `draggable="false"` 接管浏览器默认行为）。
- **新增 `useImageLightbox` 组合式与 `resolveImageTarget` 纯函数**：统一识别阅读页真 `<img>`（块级插图 / 行内字图，原字在 `data-char`）与编辑画布 `div.bt-image[data-src]` 三种形态，供宿主自定义视图接线。
- **`BtBookView` 新增 `imageLightbox` prop（缺省 false，向后兼容）**：开启后点击正文插图或行内字图弹窗放大，page / scroll / scroll-flow 三种模式均生效；命中即消费该次点击，不再触发翻页分区（单页模式点图不再翻页）。
- **`BtEditor` 新增 `imageLightbox` prop（缺省 false）**：开启后双击画布内图片弹窗放大——用双击避免与 ProseMirror 单击选中节点冲突。
- demo 宿主侧（私有包）：阅读视图与编辑画布开启 `image-lightbox`。
