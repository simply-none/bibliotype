# 17 文档导入

> 涉及包：`@bibliotype/import`（Markdown / HTML）、`@bibliotype/import-docx`（docx）、`@bibliotype/import-epub`（epub）　·　相关：[01 数据模型](01-document-model.md)、[02 编辑器与插件](02-editor-and-plugins.md)、[07 EPUB 导出](07-export-epub.md)

把外部文档转成 **`BookDocument`（IR）**，与编辑器 / 阅读 / 导出共用同一数据模型。按「是否需要外部重依赖」分层：零依赖的文本类（Markdown / HTML）在基础包 `@bibliotype/import`，重格式（docx / epub）各拆独立叶子包，避免污染公共包并支持按需 `import()`。

所有转换函数都以 `(input, schema, metadata)` 形式产出 `BookDocument`：

- `schema` —— ProseMirror `Schema`，通常用与编辑器同款构造（如 demo 的 `buildClassicalEditorSchema()`）；IR 为纯数据，节点 / 标记集合一致即可安全载入 `BookEditor` / `Reader`。
- `metadata` —— `BookMetadata`，**一律由调用方注入**（含 `title` 及可选 `createdAt` / `updatedAt`）；包内不读当前时间，保证产出确定性（红线 §四.6）。

## 基础导入 `@bibliotype/import`（Markdown / HTML，零外部重依赖）

```ts
import { buildBookSchema } from '@bibliotype/editor'; // 或你的 schema 构造
import {
  markdownToBookDocument,
  htmlToBookDocument,
  detectImportFormat,
  importFromText,
} from '@bibliotype/import';

const schema = buildBookSchema();

/* Markdown → BookDocument */
const doc = markdownToBookDocument('# 学而\n\n子曰：学而时习之。', schema, { title: '论语' });

/* HTML → BookDocument（浏览器用全局 DOM；Node 可注入已解析的 container 元素） */
const doc2 = htmlToBookDocument('<h1>为政</h1><p>子曰……</p>', schema, { title: '为政' });

/* 按文件名 / MIME 判格式后分发（仅 markdown / html；docx / epub 抛错指向对应包） */
const format = detectImportFormat('note.md'); // 'markdown'
const doc3 = importFromText('# 标题', format, schema, { title: '标题' });
```

| API | 签名 | 说明 |
| --- | --- | --- |
| `nodesToBookDocument` | `(nodes: PmNode[], schema, metadata) => BookDocument` | 块节点合成合法 `book` 根 → IR（低层组装） |
| `markdownToBookDocument` | `(md: string, schema, metadata) => BookDocument` | 复用 `editor.markdownToNodes` |
| `htmlToBookDocument` | `(html: string, schema, metadata, container?) => BookDocument` | `DOMParser.fromSchema` 解析片段；可注入 `container` |
| `detectImportFormat` | `(nameOrMime: string) => ImportFormat` | `'markdown' \| 'html' \| 'docx' \| 'epub' \| 'unknown'` |
| `importFromText` | `(text, format, schema, metadata) => BookDocument` | 文本类分发；重格式抛错指向对应叶子包 |

## docx 导入 `@bibliotype/import-docx`（mammoth）

`.docx` → HTML（mammoth）→ 复用 `import` 的 HTML 通路 → `BookDocument`。`mammoth` 为外部重依赖，隔离在本叶子包；**浏览器与 Node 通用**（内部按环境提供 `arrayBuffer` / `buffer` 双通道）。建议使用侧按需 `import()` 动态加载以控包体。

```ts
import { docxToHtml, docxToBookDocument } from '@bibliotype/import-docx';

/* 仅取归一后的 HTML */
const html = await docxToHtml(arrayBufferOrBytes);

/* 直接得到 IR */
const doc = await docxToBookDocument(await file.arrayBuffer(), schema, { title: '来自 docx' });
```

- 输入 `DocxInput = ArrayBuffer | Uint8Array`。
- **图片策略（D4）**：内嵌图片默认退化为空 `src` 占位、不阻断正文；如需资源解析，经 `DocxToHtmlOptions.convertImage` 注入 `DocxImageConverter` 钩子（后续可扩展为 data-URI 或外链）。

## epub 导入 `@bibliotype/import-epub`（fflate + @xmldom/xmldom）

`.epub`（zip + OPF + XHTML）→ `BookDocument`。解包与结构读取（`container.xml` → `content.opf` 的 `<manifest>` / `<spine>` → 逐章节 XHTML `body`）用 `fflate` + `@xmldom/xmldom`，**浏览器与 Node 完全同构、不依赖 DOM**；最后的 XHTML → IR 复用 `import` 的 HTML 通路（ProseMirror 解析需真实 DOM，故端到端 `epubToBookDocument` 在浏览器 / happy-dom 环境运行）。

```ts
import { epubToHtml, epubToBookDocument } from '@bibliotype/import-epub';

/* DOM 无关：仅解出正文 XHTML 字符串（Node 亦可用） */
const xhtml = epubToHtml(bytes);

/* 端到端 → IR（需 DOM 环境） */
const doc = epubToBookDocument(await file.arrayBuffer(), schema, { title: '来自 epub' });
```

- 输入 `EpubInput = ArrayBuffer | Uint8Array`。
- 读入侧比导出更宽松：容忍缺 `nav`、缺图片引用等；章节按 `<spine>` 顺序回收。
- 与 [07 EPUB 导出](07-export-epub.md) 构成 **导出 ↔ 导入往返**（导出产物可直接作为导入夹具）。

## 环境要求

| 包 | 环境 | 说明 |
| --- | --- | --- |
| `import` | 浏览器 / Node（注入 container） | `htmlToBookDocument` 触 DOM；md 路径纯；详见 [15 SSR 与 Node 同构](15-ssr-and-node.md) |
| `import-docx` | 浏览器 / Node | mammoth 双通道输入；异步 |
| `import-epub` | 浏览器 / Node | `epubToHtml` 同构无 DOM；`epubToBookDocument` 端到端需 DOM |

> Demo 侧 `ImportPanel.vue` 演示了四格式统一入口：`detectImportFormat` 判格式 → 文本类走 `importFromText`，docx / epub 走动态 `import()` 懒加载对应叶子包。
