# @bibliotype/import-epub

epub 导入：把 **`.epub`（OCF：zip + OPF + XHTML）** 转换为中枢数据形态 [`BookDocument`](../core/README.md)（`@bibliotype/core` 的 IR）。

链路：`.epub` 字节 →（fflate 解包 + `@xmldom/xmldom` 读结构）→ 按 spine 顺序取各 XHTML 的 `<body>` → 合并为标准 HTML 片段 → 复用 [`@bibliotype/import`](../import/README.md) 的 HTML 通路（`htmlToBookDocument`）回收为 IR。本包**不重复实现**文档组装，只承担「解包 + 包结构解析 + 正文抽取」，并把 `fflate` / `@xmldom/xmldom` 隔离在叶子包——`editor` / `import` 均不引用它们。

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
| `epubToHtml` | `(input) => string` | `.epub` 字节 → 合并正文 HTML 片段（**同构、无 DOM**，同步） |
| `epubToBookDocument` | `(input, schema, metadata) => BookDocument` | `.epub` → BookDocument（HTML → import 通路，同步） |
| `EpubInput`（类型） | `ArrayBuffer \| Uint8Array` | epub 原始字节的统一入口 |

## 同构与 DOM 边界

- `epubToHtml` 全程 **不触碰浏览器 DOM**：fflate 解 zip、`@xmldom/xmldom` 读取 `container.xml`（定位 OPF）、OPF 的 `manifest`/`spine`（内容文档顺序）、逐个 XHTML 取 `<body>` 内层并序列化——均为纯 XML/字节操作，浏览器与 Node 一致可用。
- `epubToBookDocument` 的最后一步复用 `import.htmlToBookDocument`，需一个支持 `Element.matches()` 的 DOM（ProseMirror 解析规则依赖 CSS 选择器匹配）：浏览器用全局 `document`，Node / 测试在 happy-dom 等 DOM 环境运行。**这也是为何用 `@xmldom/xmldom` 而非直接喂 ProseMirror——PM 的 `DOMParser` 无法消费 xmldom 节点（缺 `matches`）**，故最终 HTML→IR 仍走真实 DOM。

## 约定与约束

- **确定性（红线 §四.6）**：`metadata` 一律由调用方注入，包内不调 `Date.now()` / 随机数（zip 内 mtime 等不参与产出内容）；
- **读取宽松**：容忍缺失的 spine 引用 / 无 `<body>` 的内容文档（跳过而非中断），但解包失败、缺 `container.xml`、spine 无内容、正文全空等，抛中文 `RangeError` 并给出修复指向；
- **图片 / 结构**：正文中的图片、嵌套结构按 `import` 的 HTML→IR 规则回收（`image` 为块级原子、行内退化 alt，同 docx）；卷/章等 `<section>` 结构标签按通用块容器处理，正文内容不丢失；
- **依赖方向（§一矩阵）**：`import-epub → import / core`（`fflate` + `@xmldom/xmldom` 为外部依赖、`prosemirror-model` 仅作类型）；`editor`、`exporter-epub` 仅测试用（往返夹具），置于 `devDependencies`。

## 相关

- HTML → IR 通路：[`@bibliotype/import`](../import/README.md)（`htmlToBookDocument`）
- 往返夹具 / 对称导出：[`@bibliotype/exporter-epub`](../exporter-epub/README.md)（`exportEpub`）
- 数据形态：[`@bibliotype/core`](../core/README.md)（`BookDocument` / `BookMetadata`）
- 转换引擎：[`@bibliotype/editor`](../editor/README.md)（`buildEditorSchema` / `parseDOM`）
- 仓库主页：[bibliotype](../../README.md)
