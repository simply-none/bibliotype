---
'@bibliotype/import-epub': patch
'@bibliotype/reader': patch
---

epub 导入按自带目录重建层级，修正目录与正文对不上

- 新增 `nav.xhtml` 解析（优先）与 `toc.ncx` 解析（次之），两者都缺才回退扁平抽取；
  目录深度不再被压成「卷 > 章」两层，可产出卷 / 章 / 节任意嵌套与 `bt-section`。
- href 统一以**目录文件自身所在目录**为基准解析，修正 NCX 放在子目录时标题退化成「第N节」；
  zip 条目查找按「精确 → URL 解码 → 忽略大小写」回退并返回实际条目名，避免大小写不一致导致整篇静默丢失。
- 同一 XHTML 被多条目录项指向时按锚点切分 `<body>`，每章各自成容器——目录点得到、正文对得上。
- 正文顺序改以目录先序为准（spine 只回答「哪些文件是正文」），目录未收录的文档就近归档不丢失。
- 新增 `readToc` 公开导出与 `EpubToHtmlOptions.onReport`（`epubToBookDocument` 透传），
  报告目录来源 / 条目数 / 缺失文件 / 未定位锚点；demo `ImportPanel.vue` 在状态行展示该报告。
- `reader`：`extractOutline` 的无结构节点回退分支改为按 heading 的 `attrs.level` 建父子
  （h2 挂到最近的 h1 下、跳级挂最近更高级），不再一律平铺为 `level: 0`。
