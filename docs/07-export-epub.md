# 07 EPUB 导出

> 涉及包：`@bibliotype/exporter-epub`　·　相关：[05 版式与 HTML](05-layout-and-html.md)、[08 PDF 与打印](08-export-pdf.md)

将 `BookDocument` 打包为 **EPUB 3**（返回完整文件字节，含 zip 容器）。浏览器与 Node
同构：不依赖 DOM 与文件系统，产物由调用方保存 / 下载。

## 基本用法

```ts
import { exportEpub } from '@bibliotype/exporter-epub';

const bytes = exportEpub(document);
// bytes: Uint8Array（application/epub+zip）

/* 浏览器：触发下载 */
const blob = new Blob([bytes], { type: 'application/epub+zip' });
const url = URL.createObjectURL(blob);

/* Node：写文件 */
import { writeFileSync } from 'node:fs';
writeFileSync('book.epub', bytes);
```

## 导出选项（EpubExportOptions）

| 选项 | 说明 |
| --- | --- |
| `layout` | 布局选项（缺省 `DEFAULT_LAYOUT_OPTIONS`；古籍传 `CLASSICAL_LAYOUT_OPTIONS`） |
| `tokens` | 主题令牌表（缺省 `DEFAULT_THEME`；古籍传古典主题合并后的令牌） |
| `fontToken` | 正文字体令牌键（缺省 `FONT_TOKENS.BODY`；古籍传 `FONT_TOKENS.CLASSICAL_BODY`） |
| `language` | 语言标记（缺省 `metadata.language`，再缺省 `zh-Hans`） |
| `identifier` | 唯一标识符（缺省 `metadata.identifiers` 首项，再缺省确定性 urn） |
| `modified` | `dcterms:modified`（缺省 `metadata.updatedAt` / `createdAt`，再缺省当前时间） |
| `tagOverrides` | 节点类型 → 标签覆盖（透传序列化器，用于插件节点定制） |

```ts
import { exportEpub } from '@bibliotype/exporter-epub';
import { CLASSICAL_LAYOUT_OPTIONS } from '@bibliotype/layout';
import { DEFAULT_THEME, FONT_TOKENS } from '@bibliotype/core';
import { CLASSICAL_THEME_OVERRIDES } from '@bibliotype/classical';

const bytes = exportEpub(document, {
  layout: CLASSICAL_LAYOUT_OPTIONS,
  tokens: { ...DEFAULT_THEME, ...CLASSICAL_THEME_OVERRIDES },
  fontToken: FONT_TOKENS.CLASSICAL_BODY,
});
```

## 链路与产物结构

```text
BookDocument
  └─ planDocument(root)          章节规划：结构节点 → sections + 锚点表（anchors）
       └─ serializeNode(节点)     与阅读器 / PDF 同源的 HTML 序列化
            └─ renderXhtmlDocument XHTML 文档（title / lang / 样式引用）
                 └─ buildOpf / buildNavXhtml   包描述与导航
                      └─ fflate zipSync         打包
```

产物条目：

| 路径 | 内容 |
| --- | --- |
| `mimetype` | `application/epub+zip`（OCF 要求：首条目、STORE 不压缩） |
| `META-INF/container.xml` | 指向 OPF（`buildContainerXml`） |
| `OEBPS/content.opf` | 包描述：identifier / metadata / manifest / spine |
| `OEBPS/nav.xhtml` | EPUB 3 导航文档（目录） |
| `OEBPS/style.css` | 书册样式（`buildBookCss` 产物） |
| `OEBPS/sec-N.xhtml` | 每节一个 XHTML（结构节点分节） |

## 章节规划与标题

- 按结构节点（卷 / 章 / 节 / 序 / 附录等）分节，每节生成独立 XHTML 并从 spine 串接；
- 节标题优先取首节点标题（`resolveNodeTitle`），退化为 `metadata.title`；
- 无 id 的节点由规划器生成锚点（`anchorIds`），使 nav 目录可跳转。

## 确定性

- 标识符缺省为确定性派生（`resolveIdentifier` / `buildDefaultIdentifier`），
  同一文档多次导出结果稳定；
- zip 条目时间取自 `modified`；无效值回退 `1980-01-01`（DOS 时间下限），
  不引入当前时间抖动。

```ts
import { EPUB_MIMETYPE, buildContainerXml } from '@bibliotype/exporter-epub';
EPUB_MIMETYPE;      // 'application/epub+zip'
buildContainerXml(); // OCF 容器描述 XML
```

## 模块级 API

除 `exportEpub` 外，各阶段的纯函数均可单独使用（便于定制管线、单测与增量处理）：

| 导出 | 说明 |
| --- | --- |
| `planDocument(root)` | 章节规划：结构节点分节 + 散块聚合，产出 `sections` 与锚点表 `anchors` |
| `buildNavItems(plan)` | 由规划结果生成导航项（`NavItem[]`：标题 + 跳转锚点 + 所属文件） |
| `SECTION_TYPES` | 独立成节 / 参与导航的结构节点类型集合（卷 / 章 / 节 / 附录 / 序 / 跋 / 目录） |
| `renderXhtmlDocument(input)` | 生成 XHTML 文档骨架（title / lang / 样式引用 / body） |
| `buildOpf(input)` | 生成 `OEBPS/content.opf`（identifier / metadata / manifest / spine） |
| `buildNavXhtml(input)` | 生成 `OEBPS/nav.xhtml`（EPUB 3 导航文档） |
| `buildContainerXml()` | 生成 `META-INF/container.xml`（OCF 容器描述） |
| `resolveIdentifier(metadata)` | 取元数据中首个非空标识符 |
| `buildDefaultIdentifier(document)` | 生成确定性缺省标识符（`urn:bibliotype:<hash>`，不含随机值） |
| `fnv1a(value)` | FNV-1a 32 位散列（8 位十六进制），确定性标识符的散列基础 |
| `EPUB_MIMETYPE` | `'application/epub+zip'` |

## 相关

- 包参考：[`@bibliotype/exporter-epub`](../packages/exporter-epub/README.md)
- 序列化与样式（共用）：[05 版式与 HTML](05-layout-and-html.md)
- 打印 / PDF：[08 PDF 与打印](08-export-pdf.md)
