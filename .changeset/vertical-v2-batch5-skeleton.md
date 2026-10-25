---
"@bibliotype/layout": minor
"@bibliotype/reader": minor
"@bibliotype/exporter-pdf": minor
---

直排排版引擎 v2 批 5（版面骨架扩展）：书耳 / 鱼尾扩展 / 眉栏 / 眉批旁批装饰位 / 两截本三截本。

- **书耳（耳题）**：`facsimile.ear` 选项——版框外上角小方框竖排题本页篇名；
  `reader.getPageEarText`（章名 → 卷名 → 书名回退，封面不标）与
  `serializePageEar` 三端共用；预览（page / scroll / 对页）、编辑画布、打印
  paged 同步注入；
- **鱼尾扩展**：数量枚举至三 / 四尾（多尾沿版心带均布、上下相向交替——偶数
  序尾垂直镜像）；新增 `fishTailStyle`（black / white / line / floral 四态），
  序列化输出 `data-fish-style`；
- **眉栏**：`facsimile.eyebrow` 选项——版框上方天头横线区；
- **眉批 / 旁批装饰位**：仿真直排下 `head-note` 分流到天头容器（多列小字）、
  `margin-note` 分流到界行外窄条（预览与打印 paged 同口径；编辑画布保持
  flow 原位可编辑）；
- **两截本 / 三截本（两截楼）**：结构节点 `bands`（2|3，`bandRatio` 缺省
  0.4/0.6 与 0.25/0.35/0.4）+ 内容节点 `band` 归截——paginator 按截位分组、
  各截以「页容量 × 截高占比」独立装箱、页按序交错合并；渲染层
  `groupNodesByBand` 分组包 `.bt-bands` 分层容器（截间横线、各截独立连排），
  预览与打印 paged 同构。已知限制：与页底浮注并存未支持、`bandRatio` 自定义
  占比渲染读取待后续、编辑画布暂按平铺。
- 花栏（竹节 / 博古 / 卍字栏）按计划低优先顺延；古典基线零变化（装饰仅
  facsimile 路径）。
