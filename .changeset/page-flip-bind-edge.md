---
'@bibliotype/page-flip': patch
---

四向装订与全参数化：

- **bindEdge 四向装订**：`PageProvider` 新增可选 `bindEdge`（left/right/top/bottom，
  缺省由 orientation 映射 ltr→left、rtl→right）——书脊可在任意边缘
  （挂历=上、台历=下），折痕/翻越方向/书口叠边/接触投影随装订侧自动朝向；
  新增 `page-frame` 模块（屏幕↔规范空间四种帧映射纯函数）；
  swipe 统一为规范空间判定（规范 x 减小 = forward）；键盘方向轴随装订侧
  （top ↑=下一页、bottom ↓=下一页，左右装订 ←→ 恒定）；
- **FlipConfig 六组嵌套参数化**：geometry/timing/shading/interaction/render/
  behavior 共 63 个参数，`resolveFlipConfig` 深合并只覆盖关心的叶子；
  着色组（折页纸背色/混色比/明度、投影强度与带宽三项式、根部与书脊 AO、
  书口叠边层数层深层缝亮边）经 uniform 运行时可调；render 组含网格分段/
  相机距离/dpr 上限/纹理预算/排版占比（`FlipRenderAdapter` 增可选
  `setRenderOptions`）；behavior 组含捏角/捏边/滑动/滚轮/键盘开关；
  默认值与重构前行为完全一致。
