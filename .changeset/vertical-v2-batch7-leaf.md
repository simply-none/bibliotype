---
"@bibliotype/layout": minor
"@bibliotype/reader": minor
"@bibliotype/editor": minor
"@bibliotype/vue": minor
"@bibliotype/exporter-pdf": minor
---

直排排版引擎 v2 批 7（图文与整叶收尾）：筒子叶版心交替 / 叶次 a/b 页码 / 插图版式。

- **筒子叶版心交替**：`facsimile.gutter.alternate` 选项 + `facsimilePageOf`
  页级变体纯函数（奇数页翻转版心侧，耳框与内缩随页）——预览 BtBookView
  （page / scroll / 对页的版心、耳框、页框内缩）、编辑画布 PagedCanvas
  （页框内缩 + data-gutter-side 打标）、打印 paged（版心 / 耳框随页 +
  `.bt-page[data-gutter-side]` 镜像内缩 CSS）三端接入；分页与度量不分侧
  （带宽尺寸对称，页数与既有口径一致）。docs/22 已知限制 3「版心恒在左侧」
  自本批解除；
- **叶次 a/b 页码**：`PAGE_NUMBER_STYLES.LEAF_AB`（`leaf-ab`）——一叶两半叶
  页码体系（奇数页「第 X 叶·上」、偶数页「第 X 叶·下」，中文叶数），与
  decimal / chinese / roman 并行；
- **插图版式**：`image.attrs.layout`（editor 规格登记）——`embedded`（缺省
  嵌入正文）/ `full-width` 整幅独占版心宽 / `half-width` 半幅居中；
  序列化透传 `data-layout`、CSS 属性分支；复合版式（上图下文 / 左图右文 /
  双面连式）由结构层承担（两截本 bands / 对页）；
- 图文对照阅读按计划列为可选未实现（平台功能非版式规则）。
- 古典基线第二十次重锁（插图版式属性规则全路径输出）。
