# @bibliotype/import

基础文档导入：把 **Markdown / HTML** 转换为中枢数据形态 [`BookDocument`](../core/README.md)（`@bibliotype/core` 的 IR）。
零外部重依赖——文本 → PM 结构的解析复用 [`@bibliotype/editor`](../editor/README.md)（`markdownToNodes` 与扩充后的 `parseDOM`），本包只做**文档级组装**（块节点合成 `book` 根 + 注入 `metadata`）与**格式分发**。

二进制格式按依赖足迹隔离在对应叶子包：docx 见 [`@bibliotype/import-docx`](../import-docx/README.md)、epub 见 [`@bibliotype/import-epub`](../import-epub/README.md)。

## 安装

```bash
pnpm add @bibliotype/import @bibliotype/editor @bibliotype/core
```

## 快速上手

```ts
import { buildEditorSchema } from '@bibliotype/editor';
import { markdownToBookDocument, htmlToBookDocument, detectImportFormat, importFromText } from '@bibliotype/import';

const schema = buildEditorSchema();
// metadata 由调用方注入（含 createdAt/updatedAt 等），保证确定性——包内不读当前时间
const metadata = { title: '论语', createdAt: '2026-01-01T00:00:00.000Z' };

const doc = markdownToBookDocument('# 学而\n\n子曰：**学而时习之**，不亦说乎？', schema, metadata);

// 浏览器：直接传 HTML 字符串；Node / SSR / epub 复用：注入已解析的 container 元素
const doc2 = htmlToBookDocument('<h2>为政</h2><p>子曰：为政以德。</p>', schema, metadata);

// 按文件名 / MIME 分发（markdown / html 走本包，docx / epub 抛明确指向）
const format = detectImportFormat('chapter.md'); // 'markdown'
const doc3 = importFromText('# 标题', format, schema, metadata);
```

## API

| 导出 | 签名 | 说明 |
| --- | --- | --- |
| `nodesToBookDocument` | `(nodes, schema, metadata) => BookDocument` | 块节点合成 `book` 根 → IR（纯函数） |
| `markdownToBookDocument` | `(markdown, schema, metadata) => BookDocument` | Markdown → BookDocument（复用 editor 转换层） |
| `htmlToBookDocument` | `(html, schema, metadata, container?) => BookDocument` | HTML → BookDocument；缺省用全局 `document`，可注入 `container` |
| `detectImportFormat` | `(nameOrMime) => ImportFormat` | 按扩展名 / MIME 判定格式 |
| `importFromText` | `(text, format, schema, metadata) => BookDocument` | 文本格式分发（仅 markdown / html） |
| `ImportFormat`（类型） | `'markdown' \| 'html' \| 'docx' \| 'epub' \| 'unknown'` | 可识别格式联合 |

## 约定与约束

- **确定性（红线 §四.6）**：`metadata` 一律由调用方注入，包内不调 `Date.now()` / 随机数；
- **副作用隔离（§3.2）**：包内仅 `htmlToBookDocument` 触碰 DOM，其余为纯函数；Node 环境请注入 `container` 或在 happy-dom 下运行；
- **Markdown 子集 / 图片限制**：与 editor 一致——`image` 为块级原子节点，行内图片退化为其 alt 文本，不支持嵌套列表；
- **依赖方向**：`import → editor / core`，不反向、不越层；docx / epub 的重依赖只出现在各自叶子包。

## 相关

- 用法参考：[docs/17 文档导入](../../docs/17-document-import.md)（md / html / docx / epub → BookDocument 全链路）
- 转换引擎：[`@bibliotype/editor`](../editor/README.md)（`markdownToNodes` / `pmNodeToIr` / `parseDOM`）
- 数据形态：[`@bibliotype/core`](../core/README.md)（`BookDocument` / `BookMetadata`）
- 仓库主页：[bibliotype](../../README.md)
