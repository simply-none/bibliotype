# @bibliotype/exporter-docx

## 26.10.25-rc.1

### Minor Changes

- P4 批 5（E5）：新增 DOCX 导出包 `@bibliotype/exporter-docx`。`exportDocx(book, options)` 产出 `.docx` 字节（`Packer.toBlob`，浏览器 / Node 同构），`buildDocxDocument` 返回 `Document` 与问题清单供调用方另存或断言。IR → WordprocessingML 覆盖：标题 1~6 级（outlineLevel 与命名标题样式）、正文 / 引文 / 代码块 / 题注 / 注文段落样式、`attrs.styleId` 命名样式反查（查不到沿用途中样式，不写悬空 pStyle）、脚注 / 尾注经 `FootnoteReferenceRun` 对接 Word 脚注部件（注文自包含、Word 自动编号与跳转）、表格 `colspan/rowspan → gridSpan/vMerge` 与表头行（重复标题行 + 加粗 + 底纹）、data URI 图片解码入 `word/media`（魔术字节嗅探格式、px@96dpi 尺寸只缩不放、alt 写入 docProps）、修订视图 `final/original/marked`（marked 为视觉近似）。不可等价表达的语义不抛错，转问题码（`external-src` / `relative-src` / `unsupported-image` / `oversize-src` / `unsupported-node` / `ruby-degraded` / `math-degraded` / `note-orphan` / `note-unreferenced`）经 `onProblem` 回调与返回清单同源透出。测试以 `mammoth` 反向读回做往返近似校验（标题层级、粗体、脚注引用与注文、表头与 colspan、base64 图片），并覆盖降级负例、修订视图、样式声明映射、图片嗅探与边界结构；回写 `docs/32`。
