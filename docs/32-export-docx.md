# 32 DOCX 导出

> 涉及包：`@bibliotype/exporter-docx`　·　相关：[05 版式与 HTML](05-layout-and-html.md)、[07 EPUB 导出](07-export-epub.md)、[31 注释](31-notes.md)

将 `BookDocument` 转换为 **Word `.docx`**（返回完整文件字节），面向传统出版投稿与
编辑部往返批注。浏览器与 Node 同构：不依赖 DOM 与文件系统，产物由调用方保存 / 下载。

设计取向与 EPUB 导出器一致：**适配层只消费 IR**；无法在 Word 里等价表达的语义
**不静默丢弃**，统一经问题码回传宿主（`onProblem` 与返回清单同源）。

## 基本用法

```ts
import { exportDocx, buildDocxDocument } from '@bibliotype/exporter-docx';

/* 只要字节 */
const bytes = await exportDocx(document);
// bytes: Uint8Array（application/vnd.openxmlformats-officedocument.wordprocessingml.document）

/* 浏览器：触发下载 */
const blob = new Blob([bytes], {
  type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
});
const url = URL.createObjectURL(blob);

/* Node：写文件 */
import { writeFileSync } from 'node:fs';
writeFileSync('book.docx', bytes);

/* 需要问题清单 / 二次定制文档对象 */
const { document: docxDocument, problems } = buildDocxDocument(document, options);
```

`exportDocx` 内部经 `docx` 的 `Packer.toBlob` 打包（`docx` 是 `dependencies`，不随宿主构建注入）。

## 导出选项（DocxExportOptions）

| 选项 | 说明 |
| --- | --- |
| `pageSize` | 页面尺寸（毫米），缺省 A4 210×297（`DEFAULT_PAGE_SIZE_MM`） |
| `margins` | 页边距（毫米），缺省四边 25（`DEFAULT_MARGINS_MM`） |
| `namedStyles` | 命名样式集合（`NamedStyleSet`）；IR `attrs.styleId` 查到才映射为 Word 段落样式 |
| `bodyFontFamily` | 正文字体，缺省「宋体」 |
| `bodyFontSizePt` | 正文字号（磅），缺省 12（小四） |
| `headingFontFamily` | 标题字体，缺省「黑体」 |
| `firstLineIndentChars` | 首行缩进字符数，缺省 2；`0` 表示不缩进 |
| `imageMaxWidthMm` | 图片最大宽度（毫米），缺省取版心宽度（`contentWidthMm`），上限 720 |
| `maxImageBytes` | 单张图片字节上限，缺省 8 MiB |
| `conditionContext` | 条件内容上下文（`condition.when` 求值用；缺省保留全部条件内容） |
| `revisionView` | 修订视图：`final`（缺省）/ `original` / `marked`，见下文 |
| `onProblem` | 问题回调（每条触发一次；与 `problems` 数组同源） |

```ts
const bytes = await exportDocx(document, {
  namedStyles: styleSet,
  pageSize: { width: 185, height: 260 }, // 16 开
  bodyFontSizePt: 10.5,                  // 五号
  onProblem: (problem) => console.warn(problem.code, problem.message),
});
```

## 链路与产物结构

```text
BookDocument
  └─ resolveOptions                缺省值归一（A4 / 25mm / 宋体 12pt / 首行缩进 2 字符）
       ├─ collectNotes             注块登记（footnote / endnote / sidenote 各自计数）
       ├─ collectReferencedNoteIds 预扫描全部 noteref，避免「注文先于引用」误判孤儿
       ├─ createExportContext      问题收集器（onProblem + problems 同源）
       ├─ buildBlocks              块级：标题 / 段落 / 列表 / 表格 / 图片 / 分页 / 条件
       │    └─ inlineChildren      行内：标记、链接、注音、注引（FootnoteReferenceRun）
       ├─ buildDocxStyles          命名样式表（styles.xml：正文 / 引文 / 图注 / 代码 / 注文 / 标题）
       └─ new Document({ sections }) ──▶ Packer.toBlob ──▶ .docx 字节
```

产物关键部件：

| 部件 | 内容 |
| --- | --- |
| `word/document.xml` | 正文流（标题 / 段落 / 表格 / 图片） |
| `word/styles.xml` | 内置标题 + `Bibliotype*` 命名样式 + 用户命名样式 |
| `word/footnotes.xml` | 脚注内容（由 `FootnoteReferenceRun` 自动生成，Word 负责编号与跳转） |
| `word/media/*` | data URI 解码后的图片资产 |
| `docProps/core.xml` | 标题 / 副标题 / 作者（`metadata`） |

## 结构映射

### 节点与容器

- **透明下钻**：`book` / `cover` / `title-page` / `copyright-page` / `back-cover` / `toc` / `section`；
- **另起页**：`volume` / `chapter` / `appendix` / `preface` / `postscript` 的首块前置分页符
  （首个内容块不另起页，避免封面后空白页）；
- **分页 / 分栏符**：`break`（`variant: 'page' | 'column'`）→ 下一个块前置分页；
  其余 `break`（含 `hr`）→ 带分隔底边框的空段落；
- **条件容器**：`condition.when` 经 `evaluateCondition` 求值，空 `when` 一律保留；
- **页眉 / 页脚节点**：不进入正文流（Word 页眉页脚需节属性，当前不映射）；
- **未知节点**：子内容按段落输出 + `unsupported-node`。

### 标题与段落

- `heading` → `Heading1..6`（`attrs.level` 缺省 1、夹紧 1~6）；
  Word 导航窗格 / 目录域据此生成层级。默认样式为标题字体、加粗、黑色、`keepNext` + `outlineLevel`；
- 正文段落：两端对齐、1.5 倍行距、首行缩进（按 `firstLineIndentChars`）；
- `quote`：引文样式（左右内缩、楷体可经命名样式覆盖）；
- `code-block`：代码样式（Consolas 等宽 + 底纹，行间以软换行分段）；
- `caption`：图注样式（居中、五号）；
- `list` / `list-item`：以 `• ` / `1. ` 前缀 + 左缩进表达（Word 原生编号域留待后续）；
- `styleId`：`attrs.styleId`（兼容 `attrs.rawAttrs.styleId`）→ `namedStyles` 查得到才写
  `pStyle`，查不到沿用途中样式，避免导出悬空样式引用。

### 行内标记

| IR | Word |
| --- | --- |
| `strong` | 加粗 |
| `emphasis` | 斜体 |
| `underline` | 下划线 |
| `strikethrough` | 删除线 |
| `highlight` | 黄色高亮 |
| `code` | Consolas + 灰底 |
| `link` | `ExternalHyperlink`（空地址 / `#` 开头不包装） |
| `ruby` | 降级「汉字（注音）」+ `ruby-degraded` |
| `noteref` | Word 脚注引用（见下节） |
| `deletion` / `insertion` | 按 `revisionView` 取舍（见下文） |

### 脚注 / 尾注

注块（`footnote` / `endnote` / `sidenote`）本身**不进入正文流**；`noteref` 标记经
`FootnoteReferenceRun(NoteContent)` 在引用处挂 Word 脚注，**注文自包含**——Word 打开后
自动编号、双击注码可跳转到页下注文：

- 注文段落挂内置 `FootnoteText` 样式（9pt）；
- 找不到目标注块的注引 → 上标纯文本兜底 + `note-orphan`；
- 未被任何注引指向的注块 → 按「注文」命名样式输出到原位置 + `note-unreferenced`；
- `attrs.marker` 优先作为注码来源，缺省按类型分别计数。

### 表格

- `colspan` / `rowspan` → `columnSpan` / `rowSpan`（缺省不写，避免无谓的网格声明）；
- 开头连续 `attrs.header === true` 的行：加粗 + 灰底 + `tableHeader`（跨页重复标题行）；
- 表格宽度 100% 版心，单元格内块内容递归转换（首段无首行缩进）。

### 图片与题注

- 仅接受 **data URI**（IR 自包含约定）：PNG / JPEG / GIF / BMP 按**魔术字节嗅探**，
  不信任 data URI 声明；
- 尺寸按 px@96dpi 换算，**只缩不放**，最大宽度取 `imageMaxWidthMm`、最大高度 180mm；
- `alt` 写入 `docProps`（`altText.name` 必填，空则用节点 id / 「图片」兜底）；
- `caption` 节点紧随图片即图注（导出器不自动成对，按 IR 原样输出）。

### 命名样式（styles.xml）

内置段落样式（`STYLE_IDS`）：

| id | 名称 | 用途 |
| --- | --- | --- |
| `BibliotypeBody` | 正文 | 缺省段落（两端对齐 / 1.5 行距 / 首行缩进） |
| `BibliotypeQuote` | 引文 | `quote` |
| `BibliotypeCaption` | 图注 | `caption` |
| `BibliotypeCode` | 代码块 | `code-block` |
| `BibliotypeNote` | 注文 | 未引用注块的兜底输出 |

`namedStyles` 中的每条 `NamedStyle` 映射为 Word 段落样式：id 经 `toWordStyleId` 清洗
（非 `[A-Za-z0-9_-]` 替换为 `-`、数字开头补 `S`），声明经 `declarationsToProps` 翻译：
`font-family` / `font-size` / `font-weight` / `font-style` / `color` / `background-color` /
`text-decoration` / `letter-spacing` / `text-align` / `text-indent` / `margin-*` / `line-height`。

## 修订视图

| 视图 | 行为 |
| --- | --- |
| `final`（缺省） | 终稿：删除内容不输出 |
| `original` | 原稿：插入内容不输出 |
| `marked` | 插入加下划线、删除加删除线（**视觉近似**） |

`marked` 不是 Word 原生修订（`w:ins` / `w:del`），不产生可接受 / 拒绝的修订记录，
需要真修订时后续接入 `InsertedTextRun` / `DeletedTextRun`。

## 问题码

| 码 | 触发条件 |
| --- | --- |
| `external-src` | 图片为外链（`http(s):` / `blob:`），未嵌入 |
| `relative-src` | 图片为相对路径 / 本地路径，无法随文件携带 |
| `unsupported-image` | data URI 非法、格式不受 Word 支持（SVG / WebP 等） |
| `oversize-src` | 图片字节超过 `maxImageBytes` |
| `unsupported-node` | 未知节点类型按段落降级 |
| `ruby-degraded` | 注音降级为「汉字（注音）」 |
| `math-degraded` | 公式降级为 TeX 源码文本 |
| `note-orphan` | 注引找不到目标注块（上标纯文本兜底） |
| `note-unreferenced` | 注块未被引用（按注文样式输出到原位置） |

## 局限与后续

- 不支持分栏 / 直排（Word 文档流为横排单栏；直排需求走 PDF 管线）；
- 页眉页脚、目录域、原生列表编号尚未映射（标题层级已为目录域预留 `outlineLevel`）；
- 公式 / 注音 / 外链图只降级不还原，投稿前应在宿主侧提示问题码；
- 字体内嵌不在导出器内完成（见 E3 字体内嵌任务）。

## 测试口径

`packages/exporter-docx/src/__tests__/export-docx.test.ts` 以 **mammoth 反向读回**做往返近似校验：

- 样例书稿：PK 头、`<h1>` / `<h2>` 层级、`<strong>`、脚注 `<sup><a href="#footnote-1">` +
  `<li id="footnote-1">`、表头 `<th>` 与 `<td colspan="2">`、`<img src="data:image/png;base64,`；
- 负例：问题码齐备、降级后文字保留、`onProblem` 与清单同源、超限图 `oversize-src`；
- 修订视图三态；样式声明映射与命名样式表；图片嗅探 / 尺寸；空文档与条件容器。

> mammoth 缺省样式表不映射下划线，测试以 `styleMap: ['u => u']` 补映射后再断言。
