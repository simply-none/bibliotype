---
"@bibliotype/vue": patch
"@bibliotype/demo": patch
---

双页对照修正：对照就地替换主区渲染并隐藏目录栏（不再叠加原正文），舞台高度有界、容器禁用内部滚动，
滚轮专注翻页；单文档对页透传 `tokens` / `fontToken` / `fontSize` / `features` / `namedStyles`，
古籍仿真纸色与字体同单页；对页中缝 24px、两页各自投影，直排 / 横排不再粘连；Demo 顶栏「逐页」后
新增「退出对照」，移除对照标题条，进入编辑自动退出。
