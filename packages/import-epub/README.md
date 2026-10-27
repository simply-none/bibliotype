# @bibliotype/import-epub

epub 导入：把 **`.epub`（OCF：zip + OPF + XHTML）** 转换为中枢数据形态 [`BookDocument`](../core/README.md)（`@bibliotype/core` 的 IR）。

链路：`.epub` 字节 →（fflate 解包 + `@xmldom/xmldom` 读结构）→ 读 OPF（`manifest` / `spine`）与**目录**（`nav.xhtml` / `toc.ncx`）→ 按目录层级与锚点切分、合并各 XHTML 的 `<body>` → 复用 [`@bibliotype/import`](../import/README.md) 的 HTML 通路（`htmlToBookDocument`）回收为 IR。本包**不重复实现**文档组装，只承担「解包 + 包结构解析 + 目录解析 + 正文结构重建」，并把 `fflate` / `@xmldom/xmldom` 隔离在叶子包——`editor` / `import` 均不引用它们。

## 安装

```bash
pnpm add @bibliotype/import-epub @bibliotype/import @bibliotype/core
```

> epub 解析含外部依赖，使用侧（浏览器应用）建议按需**动态 `import()`** 本包，以控首屏包体。

## 快速上手

```ts
import { buildEditorSchema } from '@bibliotype/editor';
import { epubToBookDocument, epubToHtml } from '@bibliotype/import-epub';

const schema = buildEditorSchema();
// metadata 由调用方注入（含 createdAt/updatedAt 等），保证确定性——包内不读当前时间
const metadata = { title: '论语', createdAt: '2026-01-01T00:00:00.000Z' };

// 浏览器：File.arrayBuffer()；Node：fs 读得的 Uint8Array
const bytes = new Uint8Array(await file.arrayBuffer());
const doc = epubToBookDocument(bytes, schema, metadata); // 同步

// 只需 DOM 无关的中间产物（浏览器 / Node 同构，可在无 DOM 环境调用）：
const html = epubToHtml(bytes); // 合并后的正文 HTML 片段
```

## API

| 导出 | 签名 | 说明 |
| --- | --- | --- |
| `epubToHtml` | `(input, options?) => string` | `.epub` 字节 → 正文 HTML 片段（**同构、无 DOM**，同步） |
| `epubToBookDocument` | `(input, schema, metadata, options?) => BookDocument` | `.epub` → BookDocument（HTML → import 通路，同步；`options` 透传给 `epubToHtml`） |
| `readToc` | `(files, opfPath) => TocPlan` | 解析目录（`nav.xhtml` 优先、`toc.ncx` 次之、均无则 `source: 'none'`） |
| `EpubToHtmlOptions`（类型） | `{ inlineImages?, onReport? }` | 图片内联开关与导入诊断回调 |
| `EpubImportReport`（类型） | `{ tocSource, tocEntries, missingFiles, unlocatedAnchors }` | 导入报告（经 `onReport` 透出） |
| `TocEntry` / `TocPlan`（类型） | — | 目录条目树 / 目录计划（含来源与未命中文件） |
| `EpubInput`（类型） | `ArrayBuffer \| Uint8Array` | epub 原始字节的统一入口 |

## 目录重建（nav.xhtml / toc.ncx → 卷 / 章 / 节）

正文结构**以 epub 自带目录为准**，spine 只回答「哪些文件算正文」：

| 目录源 | 定位方式 | 层级来源 |
| --- | --- | --- |
| EPUB 3 `nav.xhtml`（优先） | manifest 中 `properties` 含 `nav` 的 item；否则 `*nav.xhtml` | `<nav epub:type="toc">` 的嵌套 `ol > li > a`，任意深度 |
| EPUB 2 `toc.ncx`（次之） | manifest 中 `application/x-dtbncx+xml`；否则 `*.ncx` | `navPoint` 自身嵌套 |
| 均无 | — | 回退扁平抽取（由 reader 按 heading 建目） |

- **href 基准**：目录文件自身所在目录（两者都可能放在子目录）；锚点 URL 解码后与正文 `id` 对齐。
- **zip 条目查找**：精确 → 解码 → 忽略大小写三路回退，返回实际条目名；找不到的记入 `missingFiles`。
- **正文顺序**：目录先序首次出现顺序即阅读顺序；目录未收录的文档（封面 / 版权页 / 后记）插到 spine 前驱之后，不丢内容也不引入 spine 之外的文档。
- **一文件多章**：同一 XHTML 被多条目录项指向时，按锚点切分 `<body>` 顶层子节点，各归其条目。
- **层级 → 结构节点**：深度 0 / 1 / ≥2 → `div.bt-volume` / `div.bt-chapter` / `div.bt-section` 嵌套容器（带 `data-title`），经 schema `parseDOM` 回收为卷 / 章 / 节；根层无子条目的条目按章输出，深度 >3 继续用嵌套 `section`。

```ts
import { epubToBookDocument } from '@bibliotype/import-epub';

const doc = epubToBookDocument(bytes, schema, metadata, {
  onReport: (report) => {
    // { tocSource: 'nav', tocEntries: 42, missingFiles: [], unlocatedAnchors: [] }
    if (report.tocSource === 'none') console.warn('该书无目录，按标题建目');
  },
});
```

## 同构与 DOM 边界

- `epubToHtml` 全程 **不触碰浏览器 DOM**：fflate 解 zip、`@xmldom/xmldom` 读取 `container.xml`（定位 OPF）、OPF 的 `manifest`/`spine`（内容文档顺序）、逐个 XHTML 取 `<body>` 内层并序列化——均为纯 XML/字节操作，浏览器与 Node 一致可用。
- `epubToBookDocument` 的最后一步复用 `import.htmlToBookDocument`，需一个支持 `Element.matches()` 的 DOM（ProseMirror 解析规则依赖 CSS 选择器匹配）：浏览器用全局 `document`，Node / 测试在 happy-dom 等 DOM 环境运行。**这也是为何用 `@xmldom/xmldom` 而非直接喂 ProseMirror——PM 的 `DOMParser` 无法消费 xmldom 节点（缺 `matches`）**，故最终 HTML→IR 仍走真实 DOM。

## 约定与约束

- **确定性（红线 §四.6）**：`metadata` 一律由调用方注入，包内不调 `Date.now()` / 随机数（zip 内 mtime 等不参与产出内容）；
- **读取宽松**：容忍缺失的 spine 引用 / 无 `<body>` 的内容文档（跳过而非中断），但解包失败、缺 `container.xml`、spine 无内容、正文全空等，抛中文 `RangeError` 并给出修复指向；正文顺序由**目录**校正（无目录时按 spine）；
- **图片 / 结构**：正文中的图片、嵌套结构按 `import` 的 HTML→IR 规则回收（`image` 为块级原子、行内退化 alt，同 docx）；卷/章等 `<section>` 结构标签按通用块容器处理，正文内容不丢失；
- **依赖方向（§一矩阵）**：`import-epub → import / core`（`fflate` + `@xmldom/xmldom` 为外部依赖、`prosemirror-model` 仅作类型）；`editor`、`exporter-epub` 仅测试用（往返夹具），置于 `devDependencies`。

## 相关

- HTML → IR 通路：[`@bibliotype/import`](../import/README.md)（`htmlToBookDocument`）
- 往返夹具 / 对称导出：[`@bibliotype/exporter-epub`](../exporter-epub/README.md)（`exportEpub`）
- 数据形态：[`@bibliotype/core`](../core/README.md)（`BookDocument` / `BookMetadata`）
- 转换引擎：[`@bibliotype/editor`](../editor/README.md)（`buildEditorSchema` / `parseDOM`）
- 仓库主页：[bibliotype](../../README.md)
