# @bibliotype/import-docx

docx 导入：把 **`.docx`（OOXML）** 转换为中枢数据形态 [`BookDocument`](../core/README.md)（`@bibliotype/core` 的 IR）。

链路：`.docx` 字节 → `mammoth` 归一为标准 HTML → 复用 [`@bibliotype/import`](../import/README.md) 的 HTML 通路（`htmlToBookDocument`）回收为 IR。本包**不重复实现**文档组装，只承担「二进制 → HTML」这一段，并把 `mammoth` 这一外部重依赖**隔离在叶子包**——`editor` / `import` 均不引用 `mammoth`。

## 安装

```bash
pnpm add @bibliotype/import-docx @bibliotype/import @bibliotype/core
```

> `mammoth` 体积较大，且含 Node / 浏览器双实现。使用侧（如浏览器应用）建议按需**动态 `import()`** 本包，以控首屏包体。

## 快速上手

```ts
import { buildEditorSchema } from '@bibliotype/editor';
import { docxToBookDocument, docxToHtml } from '@bibliotype/import-docx';

const schema = buildEditorSchema();
// metadata 由调用方注入（含 createdAt/updatedAt 等），保证确定性——包内不读当前时间
const metadata = { title: '论语', createdAt: '2026-01-01T00:00:00.000Z' };

// 浏览器：File.arrayBuffer()；Node：fs 读得的 Uint8Array / Buffer 皆可
const file = await input.files[0]!.arrayBuffer();
const doc = await docxToBookDocument(file, schema, metadata);

// 只需中间产物 HTML 时：
const html = await docxToHtml(file); // '<h1>为政</h1><p>子曰：为政以德。</p>'
```

## API

| 导出 | 签名 | 说明 |
| --- | --- | --- |
| `docxToHtml` | `(input, options?) => Promise<string>` | `.docx` 字节 → 标准 HTML（mammoth 边界） |
| `docxToBookDocument` | `(input, schema, metadata, options?) => Promise<BookDocument>` | `.docx` → BookDocument（HTML → import 通路） |
| `DocxInput`（类型） | `ArrayBuffer \| Uint8Array` | docx 原始字节的统一入口 |
| `DocxToHtmlOptions`（类型） | `{ styleMap?; convertImage? }` | 样式映射与图片策略 |
| `DocxImageConverter`（类型） | mammoth 图片转换器 | 供注入自定义 `convertImage` |

## 双端输入约定

`mammoth` 依运行环境读取不同输入字段：Node 版只认 `buffer` / `path` / `file`，浏览器版只认 `arrayBuffer`，二者底层同为 JSZip，对 `Uint8Array` / `ArrayBuffer` 均可接收。本包**同时**提供 `arrayBuffer` 与 `buffer` 两个字段——Node 走 `buffer`、浏览器走 `arrayBuffer`，免去运行期环境探测。

## 约定与约束

- **确定性（红线 §四.6）**：`metadata` 一律由调用方注入，包内不调 `Date.now()` / 随机数；
- **图片（D4）**：内嵌图片默认退化为**空 `src` 占位**，不内联 base64、不阻断正文；需要 base64 内联传 `mammoth.images.dataUri`，自定义资源解析（图床 / 附件）传 `mammoth.images.imgElement(fn)`（资源钩子，TODO 后续接入）；
- **副作用隔离（§3.2）**：`docxToHtml` 为 mammoth 边界（二进制解析）；`docxToBookDocument` 经 import 复用其 HTML 通路，`htmlToBookDocument` 需 DOM——浏览器直接用全局 `document`，Node / 测试在 happy-dom 等 DOM 环境运行；
- **依赖方向（§一矩阵）**：`import-docx → import / core`（`prosemirror-model` 仅作类型、`mammoth` 为外部重依赖，均不出现在其它包）；`editor` 仅测试用（`buildEditorSchema`），故置于 `devDependencies`；
- **错误提示**：空字节、非合法 / 损坏 `.docx`、解析结果为空，均抛中文 `RangeError` 并给出修复指向。

## 相关

- HTML → IR 通路：[`@bibliotype/import`](../import/README.md)（`htmlToBookDocument`）
- 数据形态：[`@bibliotype/core`](../core/README.md)（`BookDocument` / `BookMetadata`）
- 转换引擎：[`@bibliotype/editor`](../editor/README.md)（`buildEditorSchema` / `parseDOM`）
- 仓库主页：[bibliotype](../../README.md)
