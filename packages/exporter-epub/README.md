# @bibliotype/exporter-epub

EPUB 3 导出：IR → 章节规划 → 语义 XHTML + OPF / nav → 打包为完整 `.epub` 字节。
零后端、浏览器与 Node 同构（不依赖 DOM 与文件系统），产物确定
（mimetype 按 OCF 规范以首条目、STORE 不压缩方式写入）。

设计基准是**外部阅读器兼容**（京东读书 / 微信读书 / Apple Books）：导出链路内置
**媒体打包**、**体积兜底拆分**、**导出前校验**（epubcheck 规则子集）三项机制，
对策「自研阅读器能开、平台打不开」类缺陷。

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
  onValidation: (problems) => {       // 导出前校验（error 在前，不中断导出）
    for (const p of problems) console[p.severity === 'error' ? 'error' : 'warn'](p.code, p.message);
  },
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
| `identifier` | 唯一标识符（缺省 `metadata.identifiers` 首项，再缺省从文档派生的确定性 URN；裸 ISBN 归一 `urn:isbn:`） |
| `modified` | `dcterms:modified`（ISO 8601；缺省 `metadata.updatedAt / createdAt`） |
| `tagOverrides` | 节点类型 → 标签覆盖（用于插件节点定制序列化） |
| `version` | OPF 版本（缺省 `'3.0'`；京东读书等 RMSDK 显式传 `'2.0'`） |
| `maxSectionBytes` | 单内容文档未压缩字节上限（缺省 256KiB） |
| `validate` | 导出前校验开关（缺省 `true`） |
| `onValidation` | 校验结果回调（`ValidationProblem[]`，error 在前） |

## 导出链路

```text
BookDocument
  └─ planDocument（结构分组 + 锚点）─▶ sections + anchors
       ├─ MediaCollector（img src：data URI → OEBPS/media/*）─▶ media 条目 + src 改写
       ├─ splitSections（标题优先断点 + 256KiB 贪心装桶）─▶ 多内容文档
       │    └─ serializeNode（layout/html，与阅读器同源）─▶ 语义 XHTML
       ├─ buildNavItems / buildNavXhtml / buildNcx ──▶ nav.xhtml + toc.ncx
       ├─ buildBookCss（layout/html，导出路径扁平化变量）─▶ style.css
       ├─ buildOpf ──────────────────────────────────▶ content.opf
       ├─ validateEpub（epubcheck 规则子集）──────────▶ onValidation
       └─ buildContainerXml ─────────────────────────▶ META-INF/container.xml
                              fflate ▸ zipSync ──▶ .epub（Uint8Array）
```

底层模块均可单独使用（供深度定制）：`planDocument` / `splitSections` /
`buildNavItems` / `SECTION_TYPES` / `DEFAULT_MAX_SECTION_BYTES`（章节规划）、
`MediaCollector` / `parseDataImageUri` / `sniffImageMediaType`（媒体）、
`validateEpub` / `checkWellFormedXml`（校验）、
`buildNavXhtml`、`buildOpf`、`renderXhtmlDocument`、`buildContainerXml`、`EPUB_MIMETYPE`、
`buildDefaultIdentifier` / `fnv1a` / `resolveIdentifier` / `normalizeIdentifier` / `isIsbn` /
`contributorRoleCode`（标识符与元数据）。

## 相关

- 功能参考：[docs/07-export-epub.md](../../docs/07-export-epub.md)
- HTML 序列化：[docs/05-layout-and-html.md](../../docs/05-layout-and-html.md)
- 仓库主页：[bibliotype](../../README.md)
