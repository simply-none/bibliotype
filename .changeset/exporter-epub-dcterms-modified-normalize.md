---
"@bibliotype/exporter-epub": patch
---

修复 EPUB 导出后在京东读书等阅读器一直"加载中"打不开（P0）。上一轮已改为 EPUB 2.0 + `toc.ncx`，但仍残留 EPUB 3 专属结构；京东读书底层为 Adobe RMSDK（EPUB 2 严格 XML 解析器），解析 `version="2.0"` 包时遇到这些节点会失败而卡死。本轮补齐为"标准 EPUB 2.0"：

- OPF：`version="2.0"` 路径不再输出 EPUB 3 专属 `<meta property>`（`dcterms:modified`、副标题 `refines`），改以 `dc:date` 承载修改日期；补 `xmlns:opf` 命名空间与 `dc:date`。（`version="3.0"` 路径仍保留 EPUB 3 meta 以兼容 EPUB 3 阅读系统。）
- manifest：EPUB 2 路径下 nav 条目去掉 EPUB 3 专属 `properties="nav"`（RMSDK 不识别）；保留 `toc.ncx` 与 `nav.xhtml` 并存。
- 内容 XHTML：doctype 由 HTML5 `<!DOCTYPE html>` 改为 XHTML 1.1（`PUBLIC "-//W3C//DTD XHTML 1.1//EN"`），`<head>` 以 `<meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>` 替代 HTML5 `<meta charset>`，匹配 RMSDK 严格的 XHTML 1.1 解析要求。

导出确定性不受影响，exporter-epub 单测覆盖 EPUB 2 / EPUB 3 两条路径。
