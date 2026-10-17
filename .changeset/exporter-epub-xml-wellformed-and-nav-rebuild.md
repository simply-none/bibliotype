---
"@bibliotype/layout": patch
"@bibliotype/exporter-epub": patch
"@bibliotype/import-epub": patch
---

修复「epub 导入后直接导出，产物在部分阅读器打不开」（第四次修复，根因在 XML 格式良好性）

三处缺陷：

1. **P0 非法 XML 字符**：外部 EPUB 正文常含 XML 1.0 非法字符（C0 控制符如 U+000B / U+000C / U+0007、
   U+FFFE / U+FFFF）。xmldom 与浏览器 DOM 解析时**宽容放行且不报错**，实测 IR 层仍会原样携带，
   导出后落在 XHTML / OPF / NCX 里 → 严格 XML 解析器（expat / RMSDK 内核）报
   `not well-formed (invalid token)`，整机拒绝打开。
   现于唯一的序列化出口统一净化：`html-serializer` 新增 `stripInvalidXmlChars` / `escapeXml`，
   并让 `escapeHtml` 委派给 `escapeXml`（既有调用点零改动即获得净化）；
   exporter-epub 的 xhtml / opf / ncx / nav 四个模板改走 `escapeXml`。**代理对（emoji）明确放行**，不被误删。
2. **P1 导入书目录为空**：`buildNavItems` 原先只认 `SECTION_TYPES`（volume / chapter / section / …），
   而外部 epub 导入后是「无结构节点 + 一串 heading」的扁平 IR → nav / ncx 输出为空。
   现新增第二个来源：**顶层 heading（level ≤ 2）**，h2 嵌套到所属 h1 之下；
   无 id 的候选标题由 `planDocument` 统一预分配 `bt-a-N` 锚点并注入 XHTML
   （SECTION_TYPES 分支行为与 demo 书籍口径保持不变）。
3. **P1 图片死链**：导入的图片保留包内相对 `src`（如 `../images/cover.png`），导出时不打包媒体 →
   生成指向不存在路径的 `<img>`。现 `epubToHtml` 默认开启 `inlineImages`（可 opt-out），
   把包内图片按 OPF manifest 的 media-type 内联为 data URI；外链（`http(s)` / `data:`）不动，
   资源缺失或超过 2 MB 时跳过不改写。
