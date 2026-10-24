# 17 文档导入

> 涉及包：`@bibliotype/import`（Markdown / HTML / TXT）、`@bibliotype/import-docx`（docx）、`@bibliotype/import-epub`（epub）　·　相关：[01 数据模型](01-document-model.md)、[02 编辑器与插件](02-editor-and-plugins.md)、[07 EPUB 导出](07-export-epub.md)

把外部文档转成 **`BookDocument`（IR）**，与编辑器 / 阅读 / 导出共用同一数据模型。按「是否需要外部重依赖」分层：零依赖的文本类（Markdown / HTML）在基础包 `@bibliotype/import`，重格式（docx / epub）各拆独立叶子包，避免污染公共包并支持按需 `import()`。

所有转换函数都以 `(input, schema, metadata)` 形式产出 `BookDocument`：

- `schema` —— ProseMirror `Schema`，通常用与编辑器同款构造（如 demo 的 `buildClassicalEditorSchema()`）；IR 为纯数据，节点 / 标记集合一致即可安全载入 `BookEditor` / `Reader`。
- `metadata` —— `BookMetadata`，**一律由调用方注入**（含 `title` 及可选 `createdAt` / `updatedAt`）；包内不读当前时间，保证产出确定性（红线 §四.6）。

## 基础导入 `@bibliotype/import`（Markdown / HTML / TXT，零外部重依赖）

```ts
import { buildBookSchema } from '@bibliotype/editor'; // 或你的 schema 构造
import {
  markdownToBookDocument,
  htmlToBookDocument,
  txtToBookDocument,
  detectImportFormat,
  importFromText,
} from '@bibliotype/import';

const schema = buildBookSchema();

/* Markdown → BookDocument */
const doc = markdownToBookDocument('# 学而\n\n子曰：学而时习之。', schema, { title: '论语' });

/* HTML → BookDocument（浏览器用全局 DOM；Node 可注入已解析的 container 元素） */
const doc2 = htmlToBookDocument('<h1>为政</h1><p>子曰……</p>', schema, { title: '为政' });

/* TXT → BookDocument（空行分段 + 第X章 / 卷X 起章） */
const doc4 = txtToBookDocument('第一章 学而\n\n子曰：学而时习之。', schema, { title: '论语' });

/* 按文件名 / MIME 判格式后分发（markdown / html / text；docx / epub 抛错指向对应包） */
const format = detectImportFormat('note.md'); // 'markdown'
const doc3 = importFromText('# 标题', format, schema, { title: '标题' });
```

| API | 签名 | 说明 |
| --- | --- | --- |
| `nodesToBookDocument` | `(nodes: PmNode[], schema, metadata) => BookDocument` | 块节点合成合法 `book` 根 → IR（低层组装） |
| `markdownToBookDocument` | `(md: string, schema, metadata) => BookDocument` | 复用 `editor.markdownToNodes` |
| `htmlToBookDocument` | `(html: string, schema, metadata, container?) => BookDocument` | `DOMParser.fromSchema` 解析片段；可注入 `container` |
| `txtToBookDocument` | `(text, schema, metadata, options?) => BookDocument` | 空行分段、`第X章` / `卷X` 起章、hard-wrap 合并、确定性 id |
| `detectImportFormat` | `(nameOrMime: string) => ImportFormat` | `'markdown' \| 'html' \| 'text' \| 'docx' \| 'epub' \| 'unknown'` |
| `importFromText` | `(text, format, schema, metadata, options?) => BookDocument` | 文本类分发（`options` 仅 TXT 使用）；重格式抛错指向对应叶子包 |

### 纯文本（TXT）规则

| 行为 | 规则 |
| --- | --- |
| 分段 | 空行分段；段内硬换行合并（中文直接拼接，西文相邻字母 / 数字补一个空格） |
| 起章 | 行首命中 `第X章 / 回 / 节 / 卷 / 部 / 篇` 或 `卷X`（`DEFAULT_TXT_CHAPTER_PATTERN`） |
| 章前内容 | 首个章节标记之前的文字自成无标题章，不丢内容 |
| 无章节标记 | 段落直接挂在 `book` 根下，不虚构章节点 |
| id | `idPrefix`（默认 `txt`）+ 序号，如 `txt-chapter-1` / `txt-p-1`；同输入结果稳定 |

自定义示例：

```ts
const doc = txtToBookDocument(text, schema, { title: '诗集' }, {
  chapterPattern: /^【[一二三四五六七八九十]+】/,   // 【一】起章
  chapterType: 'volume',                            // 拆到卷级
  idPrefix: 'poem',
});
```

- TXT 为纯文本，不解析 Markdown 标记（需要加粗 / 标题层级请先转 Markdown 再导入）；
- `importFromText` 第 5 个参数是 `TxtImportOptions`，其它格式忽略。

### Markdown 脚注语法

```md
子曰：学而时习之[^1]。

[^1]: 习，鸟数飞也。
```

- 引用 `[^label]` → 正文上标文本 + `noteref` 标记（`targetId` 指向注文块、`refId` 为回跳锚点），
  与编辑器 `insertFootnote` 的产物同构；
- 定义 `[^label]: 注文`（紧随其后的缩进行并入同一条注文，供折行长注）；
- 注文块插在**首次引用所在段落之后**，多段重复引用同一标签时只插一次，后续引用用 `ref-footnote-1-2` 之类的独立锚点；
- 未被引用的定义落到文末，未定义的引用按字面文本保留（不吞内容）；
- 围栏代码块里的 `[^x]:` 视为代码，不解析。

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
- 段落内 `<img>` 经 HTML 通路（含 html / docx 导入，行为同源）解析为块级 `image`、
  段落被切开，原生 `width` / `height` 属性保留进 IR attrs——缺字替代图（小尺寸字形图）
  配合 `normalizeGlyphImages`（见 [05 字图内联](05-layout-and-html.md)）自动识别并归并
  回相邻段落；不确定形态保守保留并写报告，不丢数据。
- 与 [07 EPUB 导出](07-export-epub.md) 构成 **导出 ↔ 导入往返**（导出产物可直接作为导入夹具）。

## 环境要求

| 包 | 环境 | 说明 |
| --- | --- | --- |
| `import` | 浏览器 / Node（注入 container） | `htmlToBookDocument` 触 DOM；md 路径纯；详见 [15 SSR 与 Node 同构](15-ssr-and-node.md) |
| `import-docx` | 浏览器 / Node | mammoth 双通道输入；异步 |
| `import-epub` | 浏览器 / Node | `epubToHtml` 同构无 DOM；`epubToBookDocument` 端到端需 DOM |

> Demo 侧 `ImportPanel.vue` 演示了五格式统一入口：`detectImportFormat` 判格式 → 文本类（md / html / txt）走 `importFromText`，docx / epub 走动态 `import()` 懒加载对应叶子包。

## Markdown 全量语法（F6）

| 语法 | 行为 |
| --- | --- |
| 嵌套列表 | 缩进（空格或 tab）触发子列表，最多 8 层；超出降级为同级段落 |
| 松散列表 | 项间空行不结束列表；项内空行 + 缩进续行产生多段落 |
| GFM 表格 | 表头 + `| --- |` 分隔行；支持 `:--` / `:-:` / `--:` 对齐、`\|` 转义；列数以表头为准，缺列补空、多列截断 |
| 图片题注 | `![alt](src "题注")` 的 title，或图片下一行整行斜体（`*图一*`），产出 `image` + `caption` |
| front-matter | 开头 `---` 包裹的 YAML 子集：`title` / `subtitle` / `author(s)` / `language` / `date` / `publisher` / `isbn` / `volumeCount` 等；未知标量进 `metadata.extra` |

front-matter 只在 `markdownToBookDocument` 中解析并剥离，编辑器粘贴 Markdown 不解析；调用方显式 `metadata` 优先（书名为空时才用 front-matter 补位）。

## DOCX 图片 / 样式 / 脚注（F5）

- **图片**：`docxToHtml` 缺省用 `mammoth.images.dataUri` 内联 base64；传 `convertImage` 可改为图床 / 附件钩子（返回空 `src` 即占位）。
- **命名样式**：`parseDocxStyleInfo` 解包 `word/styles.xml`，把段落样式映射为 `ns-docx-*`（中文名保留、`w:basedOn` → `basedOn`），只映射常用子集：加粗 / 斜体 / 下划线 / 字号 / 颜色 / 首行缩进 / 行距 / 段前段后 / 对齐。
  - 只返回正文实际引用的样式及其祖先，避免 Word 内置样式污染样式面板。
  - 段落经 mammoth `styleMap` 输出 `docx-style-*` 类，HTML→IR 时回收为 `rawAttrs.styleId`。
- **脚注**：`docxToHtml` 把 mammoth 的「上标链接 + 文末列表」归一为 `a.bt-mark-noteref` + `div.bt-footnote`（`data-id` / `data-marker` / `data-ref-id`），再由 `noteref` 标记与 `footnote` 节点的 parseDOM 规则回收。
- **API**：`docxToBookDocumentWithStyles(...)` 返回 `{ document, namedStyles }`；原 `docxToBookDocument` 签名不变。
- **依赖**：`import-docx` 复用工作区既有 `fflate` / `@xmldom/xmldom`（非新生态依赖）。
