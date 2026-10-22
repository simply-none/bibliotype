---
"@bibliotype/fonts": minor
"@bibliotype/exporter-epub": minor
"@bibliotype/exporter-site": minor
---

P4 批 6（E3）：新增字体内核包 `@bibliotype/fonts`，EPUB / 站点导出支持内嵌子集字体。

- **用字统计**：`collectDocumentChars(document)` 遍历 IR 文本节点（含 ruby / 标题 / 注文，过滤控制符、保留空白与标点），输出去重升序字符集 `chars` 与逐字 `counts`；80 万字文档只保留唯一字（测试：8 字）。
- **可插拔子集后端**：`prepareFontBundle(document, fonts, { backend })`（异步，后端可为 wasm / 子进程，如 `subset-font` / `fonttools`），本包不内置字体解析二进制；未提供后端时按原始字节嵌入并告警。后端抛错或返回空字节抛 `FONT_SUBSET_FAILED`（新错误码，含 `fontId` / `family` / `backend` 与根因）。
- **@font-face 与命名**：按格式嗅探（woff2 / woff / otf / ttf）与内容哈希生成确定性文件名 `bt-<family>-<weight><i>-<hash8>.<ext>`，`font-display` 可配，产物 `FontBundle{ faces, css, licensePath, license, rights, report, warnings }`。
- **缺字回退**：后端可返回 `missingChars`，告警按主题字体栈给出降级链（与 K6 同口径）；未返回时标记「覆盖信息不完整」，不假阴性。
- **体积与许可**：覆盖报告含 `sourceBytes / subsetBytes / reduction`（80 万字测试下降 ≥60%）；许可写入 `fonts/LICENSE.txt`，简短版权行写入 OPF `dc:rights`。
- **exporter-epub**：新选项 `fonts?: FontBundle` —— `@font-face` 前置到 `style.css`，字体字节写入 `OEBPS/fonts/`，manifest 登记 `font-N` / `font-license`，告警以 `FONT-REPORT` 经 `onValidation` 报告（`validate: false` 仍报告）；EPUB 2 路径同样支持。
- **exporter-site**：新选项 `fonts?: FontBundle`，`SiteFile` 新增可选 `data: Uint8Array`（字体二进制，`text` 为空串），`@font-face` 前置到站点 `style.css`，告警并入 `SiteExportResult.warnings`。
- **测试**：`@bibliotype/fonts` 21 例（统计 / 体积 / 缺字回退 / 许可 / 确定性 / 错误）、`exporter-epub` 5 例、`exporter-site` 4 例；`docs/07`、`docs/28` 已回写。
