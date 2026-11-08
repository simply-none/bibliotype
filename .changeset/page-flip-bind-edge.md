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
- **\u53cc\u9875\u6a21\u5f0f\uff08spread\uff09**\uff1a`behavior.viewMode: 'spread'` \u6216\u8fd0\u884c\u65f6
  `setViewMode()` \u5207\u6362\u5de6\u53f3\u5bf9\u5f00\u89c6\u56fe\uff08\u4e0e\u5355\u9875\u4e92\u65a5\uff09\u2014\u2014spread s \u663e\u793a\u9762
  [2s\u22121, 2s]\uff08\u5c01\u9762 spread \u5de6\u9762\u7a7a\uff09\uff0cforward \u6298\u53f3\u9762\u8d8a\u4e66\u810a\u843d\u5de6\u9762\u3001
  backward \u6298\u5de6\u9762\u53f3\u7ffb\uff1b\u7740\u8272\u5668\u65b0\u589e uOffsetX\uff08\u53cc\u9875\u4e16\u754c\u504f\u79fb\uff09\u4e0e
  uTuvFrame\uff08\u7eb9\u7406\u5e27\u4e0e\u51e0\u4f55\u5e27\u89e3\u8026\uff09\uff1brender \u9002\u914d\u5668 render \u7b7e\u540d\u6539
  \u7eb9\u7406\u89e3\u6790\u5668\uff1b\u975e left \u88c5\u8ba2\u81ea\u52a8\u56de\u9000\u5355\u9875\u3002
