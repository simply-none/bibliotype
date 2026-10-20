---
"@bibliotype/core": minor
"@bibliotype/layout": minor
"@bibliotype/editor": minor
"@bibliotype/exporter-epub": minor
---

P1-B1 样式体系与 EPUB 结构（C10 / E2 / E4）：

- **C10 命名样式继承**：`NamedStyle` 新增可选 `basedOn`；新增 `resolveNamedStyleChain` / `resolveNamedStyleDeclarations` / `validateNamedStyleSet`（断链与成环安全降级）；`buildFeatureCss` 按继承链扁平输出 `[data-style-id]`；`normalizeStyleSnapshot` 保留依据并丢弃自引用。
- **批量样式命令**：新增 `applyNamedStyle(styleId)`（作用于选区内所有文本块，空光标作用于当前块）与 `clearFormat()`（清除 marks 与命名样式，保留结构 / id / 块级 attrs），均为单事务可撤销。
- **E2 分卷 EPUB**：新增 `exportEpubVolumes(document, options)`，按顶层 `volume` 切分、每卷独立目录、标识符确定性派生；无卷文档与 `exportEpub` 字节一致。
- **E4 前置页独立 XHTML**：封面 / 书名页 / 版权页 / 封底各成独立文件、不进目录，`body` 输出 `epub:type="cover" / "titlepage" / "copyright-page"`。
- **demo**：样式面板增加「依据」下拉（自动排除成环候选），工具条增加命名样式批量套用与清除格式。
- **已知边界**：仓库无 `exporter-docx`，不做 Word `styles.xml` 映射。
