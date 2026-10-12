# @bibliotype/exporter-epub

EPUB 3 导出：IR → 章节规划 → 语义 XHTML + OPF / nav → 打包为完整 `.epub` 字节。
零后端、浏览器与 Node 同构（不依赖 DOM 与文件系统），产物确定
（mimetype 按 OCF 规范以首条目、STORE 不压缩方式写入）。

## 安装

```bash
pnpm add @bibliotype/exporter-epub
```

## 快速上手

```ts
import { exportEpub } from '@bibliotype/exporter-epub';
import { CLASSICAL_LAYOUT_OPTIONS } from '@bibliotype/layout';

const bytes = exportEpub(document, {
  layout: CLASSICAL_LAYOUT_OPTIONS,   // 缺省 DEFAULT_LAYOUT_OPTIONS
  language: 'zh-Hant',                // 缺省 metadata.language → 'zh-Hans'
});

/* 浏览器：Blob 下载 */
const blob = new Blob([bytes], { type: 'application/epub+zip' });
// const url = URL.createObjectURL(blob); → <a download="book.epub">

/* Node：直接写盘 */
// import { writeFileSync } from 'node:fs';
// writeFileSync('book.epub', bytes);
```

## 选项（`EpubExportOptions`）

| 选项 | 说明 |
| --- | --- |
| `layout` | 布局选项（缺省 `DEFAULT_LAYOUT_OPTIONS`；古籍传 `CLASSICAL_LAYOUT_OPTIONS`） |
| `tokens` | 主题令牌表（缺省 `DEFAULT_THEME`；古籍传古典覆盖 + 扩展令牌） |
| `fontToken` | 正文字体令牌键（古籍传 `FONT_TOKENS.CLASSICAL_BODY`） |
| `language` | 语言标记（缺省 `metadata.language`，再缺省 `zh-Hans`） |
| `identifier` | 唯一标识符（缺省 `metadata.identifiers` 首项，再缺省从文档派生的确定性 URN） |
| `modified` | `dcterms:modified`（ISO 8601；缺省 `metadata.updatedAt / createdAt`） |
| `tagOverrides` | 节点类型 → 标签覆盖（用于插件节点定制序列化） |

## 导出链路

```text
BookDocument
  └─ planDocument（按结构节点切分章节）─▶ sections + anchors
       ├─ serializeNode（layout/html，与阅读器同源）─▶ 语义 XHTML
       ├─ buildNavItems / buildNavXhtml ───────────▶ nav.xhtml
       ├─ buildBookCss（layout/html）──────────────▶ style.css
       ├─ buildOpf ────────────────────────────────▶ content.opf
       └─ buildContainerXml ───────────────────────▶ META-INF/container.xml
                              fflate ▸ zipSync ──▶ .epub（Uint8Array）
```

底层模块均可单独使用（供深度定制）：`planDocument` / `buildNavItems` / `SECTION_TYPES`（章节规划）、
`buildNavXhtml`、`buildOpf`、`renderXhtmlDocument`、`buildContainerXml`、`EPUB_MIMETYPE`、
`buildDefaultIdentifier` / `fnv1a` / `resolveIdentifier`（标识符）。

## 相关

- 功能参考：[docs/07-export-epub.md](../../docs/07-export-epub.md)
- HTML 序列化：[docs/05-layout-and-html.md](../../docs/05-layout-and-html.md)
- 仓库主页：[bibliotype](../../README.md)
