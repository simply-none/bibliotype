# 07 EPUB 导出

> 涉及包：`@bibliotype/exporter-epub`　·　相关：[05 版式与 HTML](05-layout-and-html.md)、[08 PDF 与打印](08-export-pdf.md)

将 `BookDocument` 打包为 **EPUB 3**（返回完整文件字节，含 zip 容器）。浏览器与 Node
同构：不依赖 DOM 与文件系统，产物由调用方保存 / 下载。

设计基准是**外部阅读器兼容**（京东读书 / 微信读书 / Apple Books 等），而非仅自研
阅读器可读：导出链路内置媒体打包、体积兜底拆分与 epubcheck 规则子集校验，
三者都是「本地开着没问题、上传到平台打不开」类缺陷的对策。

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
| `layout` | 布局选项（缺省 `DEFAULT_LAYOUT_OPTIONS`；古籍可传 `CLASSICAL_LAYOUT_OPTIONS`） |
| `tokens` | 主题令牌表（缺省 `DEFAULT_THEME`；古籍传古典主题覆盖 + 扩展令牌） |
| `fontToken` | 正文字体令牌键（缺省 `FONT_TOKENS.BODY`；古籍传 `FONT_TOKENS.CLASSICAL_BODY`） |
| `language` | 语言标记（缺省 `metadata.language`，再缺省 `zh-Hans`） |
| `identifier` | 唯一标识符（缺省 `metadata.identifiers` 首项，再缺省确定性 urn；**裸 ISBN 自动归一为 `urn:isbn:`**） |
| `modified` | `dcterms:modified`（ISO 8601；缺省 `metadata.updatedAt` / `createdAt`，再缺省当前时间） |
| `tagOverrides` | 节点类型 → 标签覆盖（透传序列化器，用于插件节点定制） |
| `version` | OPF 版本（缺省 `'3.0'`；京东读书等 RMSDK 显式传 `'2.0'` 走兼容路径） |
| `maxSectionBytes` | 单内容文档未压缩字节上限（缺省 256KiB） |
| `validate` | 导出前校验开关（缺省 `true`；校验不中断导出） |
| `onValidation` | 校验结果回调（`ValidationProblem[]`，error 在前） |
| `endnoteGrouping` | 尾注聚合：`'keep'`（缺省，就地） / `'chapter'`（章末） / `'book'`（书末新增一章） |
| `endnoteTitle` | 聚合区标题（缺省「注释」；空串不加标题行） |
| `pageDirection` | 翻页方向：缺省按书写模式推导（直排 `vertical-rl` → `'rtl'`，其余 `'ltr'`）；仅 `'rtl'` 写进 `<spine page-progression-direction>` |

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
  └─ planDocument(root)          结构分组 + 锚点表（anchors）
       ├─ MediaCollector         img src 收集：data URI → OEBPS/media/*（rewriteSrc 接入序列化器）
       ├─ splitSections          体积兜底拆分（结构节点 / 顶层标题优先断点 + 256KiB 贪心装桶）
       │    └─ serializeNode(节点)   与阅读器 / PDF 同源的 HTML 序列化
       │         └─ renderXhtmlDocument XHTML 文档（EPUB3: XHTML5 壳 / EPUB2: XHTML1.1 壳）
       └─ buildNavItems / buildNavXhtml / buildNcx ──▶ nav.xhtml + toc.ncx（两路均输出）
            └─ buildOpf（EPUB 3 特性 / EPUB 2 兼容）
                 └─ validateEpub ──▶ 导出前校验（问题经 onValidation 透出，不中断导出）
                      └─ fflate zipSync ──▶ EPUB
```

产物条目：

| 路径 | 内容 |
| --- | --- |
| `mimetype` | `application/epub+zip`（OCF 要求：首条目、STORE 不压缩） |
| `META-INF/container.xml` | 指向 OPF（`buildContainerXml`） |
| `OEBPS/content.opf` | 包描述：identifier / metadata / manifest / spine |
| `OEBPS/toc.ncx` | EPUB 2 兼容目录（两路均输出；EPUB 2 为必需） |
| `OEBPS/nav.xhtml` | EPUB 3 导航文档（3.0 挂 `properties="nav"`） |
| `OEBPS/style.css` | 书册样式（`buildBookCss` 产物，**导出路径扁平化 CSS 变量**） |
| `OEBPS/media/img-*.{ext}` | 图片独立文件（data URI 解码入库，内容散列命名 + 去重） |
| `OEBPS/text/sec-N.xhtml` | 每节一个 XHTML |

## 三项兼容机制（为什么导出不是「能跑就行」）

### 1. 媒体打包（data URI → 独立文件）

导入侧 `inlineImages` 默认把包内图片内联为 data URI 写进 IR（IR 自包含）。
导出侧 `MediaCollector` 将其解码为 `OEBPS/media/` 独立文件、登记 manifest、
把内容文档里的引用改写为相对路径：

- **为什么**：base64 ≈ ×1.37 膨胀单文档体积；Adobe RMSDK 对 `data:` URI
  支持不可靠；InDesign / Sigil / Calibre 一律「媒体独立文件 + manifest 登记」。
- 外链（`http(s):`）零后端同构不下载，原样保留并告警；`blob:` / `file:`
  会话本地地址必然失效，告警；相对路径死链由校验器报 error。
- 媒体类型以**魔术字节嗅探**为准（data URI 声明可能缺失 / 错误，
  manifest 与字节不一致时严格阅读器拒载）。

### 2. 体积兜底拆分（splitSections）

导入型扁平文档（外部 EPUB 回收后只剩标题 + 段落）若无结构节点，会整体聚合为
**单 MB 级 XHTML**——京东读书（RMSDK）/ 微信读书解析超大单文档 + 中部锚点
定位直接失败（实测：335 篇原书导出成 1 个 1.5MB 文档即打不开）。
`splitSections` 在结构分组后按字节上限贪心拆桶：

- **优先断点**：顶层标题（h1/h2）强制开新桶——导入书的「篇 / 节」边界，
  切分结果与「一篇一文件」的正式 EPUB 同构（诗经实测 328 节，最大 31KB）；
- 超限结构节点按子节点边界递归拆（首桶保留 id，锚点继续有效；后续桶剥 id）；
- 只在元素之间断，不在元素内部断，保证每份产物格式良好。

### 3. 导出前校验（validateEpub）

epubcheck 规则子集（外部阅读器视角），产物经 `onValidation` 透出：

| 码 | 级别 | 检查 |
| --- | --- | --- |
| OCF-01/02 | error | mimetype 首条目 / 内容 |
| OCF-03..06 | error | container.xml 与 OPF 定位 |
| PKG-01..05 | error | 版本合法 / unique-identifier / manifest 死链 / spine 一致非空 |
| NAV-01..05 | error/warning | nav / ncx 存在性、dtb:uid 一致、跳转目标与锚点存在 |
| MEDIA-01..04 | error/warning | 图片死链（error）/ data URI 残留 / blob / 外链 |
| DOC-01/02 | error/warning | 单文档超 256KiB（error）/ 超半数（warning） |
| XML-01/02 | error | 轻量格式良好检查（标签配对 / 属性引号 / DTD 扫描）/ BOM |
| CSS-01/02 | warning | var() 残留（老引擎样式全丢）/ 直排无 `-webkit-` 前缀 |
| SIZE-01 | warning | 包总体积超平台常见上限（约 20MB） |

## 章节规划与标题

- 按结构节点（卷 / 章 / 节 / 序 / 附录等）分节，每节生成独立 XHTML 并从 spine 串接；
- 节标题优先取首节点标题（`resolveNodeTitle`），退化为 `metadata.title`；
- 无 id 的节点由规划器生成锚点（`anchorIds`），使 nav 目录可跳转。

## 尾注聚合（`endnoteGrouping`）

尾注在 IR 里与脚注一样是就地块，导出时可重排：

```ts
exportEpub(document, { endnoteGrouping: 'chapter' }); // 篇末注：每章末尾收拢
exportEpub(document, { endnoteGrouping: 'book', endnoteTitle: '注释' }); // 书末注
```

- `chapter`：各章末尾追加「注释」标题行（level 2）+ 该章尾注；嵌在节内的尾注上提到所属章；不在任何章内的尾注兜底排到书末；
- `book`：全部尾注抽到书末新增的一章（id 缺省 `endnotes`，冲突追加 `-2`），标题行 level 1；
- 聚合在导出期完成（`groupEndnotes` 返回新根，**不改动原文档**），节点 id 保持不变，正文 `noteref` 链接照旧可跳；
- 只处理 `endnote`：脚注（页底）与边注（旁栏）保持就地，抽走会破坏版式。

`groupEndnotes(root, { scope, title?, id? })` 也可单独调用（自定义管线 / 增量处理）。

## 翻页方向（`pageDirection`）

直排书在阅读器里必须从右往左翻，否则双页视图与滑动方向与阅读习惯相反：

```ts
exportEpub(document, { layout: CLASSICAL_LAYOUT_OPTIONS }); // 自动 page-progression-direction="rtl"
exportEpub(document);                                        // 横排缺省 ltr，不输出属性
exportEpub(document, { pageDirection: 'rtl' });              // 横排版式也可强制 rtl
```

- 缺省按 `layout.writingMode === 'vertical-rl'` 推导；
- `'ltr'` 是 EPUB 缺省值，不输出属性以保持既有产物稳定。

EPUB 2（`version: '2.0'`）另输出 `<guide>`：`toc` 指向 `nav.xhtml`、`text` 指向首个内容文档，
供不认 nav 的老阅读器找入口；EPUB 3 不输出（已由 nav / landmarks 取代）。

## 版本策略

| 特性 | EPUB 3（默认） | EPUB 2（`version: '2.0'`） |
| --- | --- | --- |
| 内容文档壳 | XHTML5（`<!DOCTYPE html>` + `meta charset`） | XHTML 1.1 + `http-equiv` |
| nav | `properties="nav"` | 普通 manifest 条目 |
| 修改时间 | `dcterms:modified` + `dc:date` | 仅 `dc:date` |
| 副标题 | `meta refines` | 不输出 |
| 封面 | manifest `properties="cover-image"` | `<meta name="cover">` |
| creator | 带 `opf:role`（MARC relator） | 无 role |
| toc.ncx | 仍输出（向后兼容推荐做法） | 必需 |

## 确定性

- 标识符缺省为确定性派生（`resolveIdentifier` / `buildDefaultIdentifier`），
  同一文档多次导出结果稳定；
- 媒体文件按内容散列命名，同图多处引用去重；
- zip 条目时间取自 `modified`；无效值回退 `1980-01-01`（DOS 时间下限），
  不引入当前时间抖动。

## 模块级 API

除 `exportEpub` 外，各阶段的纯函数均可单独使用（便于定制管线、单测与增量处理）：

| 导出 | 说明 |
| --- | --- |
| `planDocument(root)` | 结构分组 + 锚点表 |
| `splitSections(plan, { serialize, maxSectionBytes })` | 体积兜底拆分（含 `oversized` 告警列表） |
| `buildNavItems(sections, anchors)` | 导航项（标题 + 跳转锚点 + 所属文件） |
| `SECTION_TYPES` / `MAX_NAV_HEADING_LEVEL` / `DEFAULT_MAX_SECTION_BYTES` | 切分常量 |
| `MediaCollector` / `parseDataImageUri` / `sniffImageMediaType` | 媒体收集 |
| `validateEpub(entries, { version, maxSectionBytes })` / `checkWellFormedXml` | 导出前校验 |
| `buildNavXhtml` / `buildOpf` / `buildNcx` / `renderXhtmlDocument` | 各文档生成 |
| `collectEpubGlyphProblems(document, options)` | 导出前缺字报告（K6，`warning` 级，含码位与 IR 路径） |
| `contributorRoleCode` / `normalizeIdentifier` / `isIsbn` | 元数据工具 |
| `groupEndnotes(root, { scope, title?, id? })` | 尾注聚合（章末 / 书末，返回新根，不改原文档） |
| `buildContainerXml` / `EPUB_MIMETYPE` | OCF |

## 古籍元数据映射（K7）

`buildOpf` 在 OPF 的 `dc:*` 区补全三类信息，缺字段不输出、不编造：

| 元数据 | OPF 元素 |
| --- | --- |
| `classicalCategory`（四部 + 二级类） | `<dc:subject xml:lang="zh-Hant">经部</dc:subject>`、`<dc:subject …>四书类</dc:subject>` |
| `classification`（原书 / 馆藏分类号） | 追加一条 `<dc:subject>` |
| `edition`（底本 / 参校本） | `<dc:source>庚辰本，清乾隆五十六年</dc:source>` |
| 固定 | `<dc:type>Text</dc:type>` |

- `dc:subject` 每个主题一条，EPUB 2 / 3 都带 `xml:lang`（两版都合法）；
- 四部标签与版本项拼接与 `core` 的 `toDublinCore` 同口径，宿主无需二次加工；
- 完整 CNMARC / DC JSON 导出在 `core`：`toCnmarc` / `toDublinCore` / `serializeDublinCore`
  （字段与校验见 [01 数据模型](01-document-model.md#古籍编目字段k7)）。

## 导出前缺字报告（K6）

```ts
import { collectEpubGlyphProblems } from '@bibliotype/exporter-epub';

const problems = collectEpubGlyphProblems(document, {
  families: ['Songti SC', 'SimSun', 'serif'],
  probe: (char, family) => document.fonts.check(`12px ${family}`, char),
  idsFor: (char) => idsDictionary.get(char),
});
// [{ severity: 'warning', code: 'GLYPH-IDS' | 'GLYPH-MISSING',
//    message: '𫞩（U+2B7A9）缺字：可用 IDS 合成显示；位置 0.2.1，上下文「山𫞩水」', path: '0.2.1' }]
```

- 只产生 `warning`，**不阻断** `exportEpub`（补字是作者决策）；
- `GLYPH-IDS`：字体缺、但宿主提供了 IDS 描述，可用 `layout` 的 `renderIdsGlyphHtml` 合成；
- `GLYPH-MISSING`：无字形可回退，阅读器会显示豆腐块；
- PDF / 打印路径用 `collectPdfGlyphProblems`（返回 `GlyphIssue[]`）与
  `summarizePdfGlyphProblems`（一行中文摘要）。

## 已知边界

- **SVG 封面不入 IR**：部分外部 EPUB 的封面走 `<svg><image xlink:href>`，
  导入侧只内联 `<img>`，SVG 节点被 HTML 回收通路丢弃——此类书导出无封面声明
  （阅读器自行取首图或默认封面）。属导入侧能力缺口，不在导出链路兜底。
- **CSS 继承取舍**：导出样式由 `buildBookCss` 生成，不继承原书 CSS
  （含其 `res:///` 设备字体路径等噪声）。

## 相关

- 包参考：[`@bibliotype/exporter-epub`](../packages/exporter-epub/README.md)
- 序列化与样式（共用）：[05 版式与 HTML](05-layout-and-html.md)
- 打印 / PDF：[08 PDF 与打印](08-export-pdf.md)

## 评论导出（C6）

`exportEpub(doc, { includeComments: true, comments })`：评论经 `core` 的 `ExportComment` 契约传入（`anchor` / `body` / `author?` / `createdAt?`），导出期在书末追加「读者评论」章，不改动原文档；缺省 `includeComments: false`。导出器不依赖 `@bibliotype/annotation`。

## 校验命令行（E9）

`bt-validate-epub <file.epub> [--json] [--max-section-bytes=<n>]`：解包后复用 `validateEpub`（epubcheck 规则子集）。退出码 `0` 无 error、`1` 存在 error、`2` 用法 / 读取 / 解包失败。CI 在 build 后对合法样本与损坏文件各跑一次（见 [12](12-release-and-ci.md)）。

## 索引与附录（K4 / K2）

- **索引章**：文档含 `index-term` 标记时，`exportEpub` 缺省在书末追加
  「索引」章（`includeIndex: false` 关闭，`indexTitle` 改标题）。EPUB 无
  固定页码，条目以词条链接回跳正文锚点，跨文件地址由导出器按
  「块 id → XHTML 文件」映射生成。
- **印章**：EPUB 3 内联 SVG 印谱；EPUB 2 自动关闭 SVG
  （`inlineSealSvg: false`），退化为文字方框印章，不打包位图。
- **调用方附录**：`appendices: readonly BookNode[]` 可追加任意书末章节
  （如 `buildCollationSummary` 的校勘汇总表）；其中 `href="#id"` 锚点会被
  自动改写为 `text/sec-N.xhtml#id` 跨文件地址，未命中的保持原样。
  附录发生在导出期，不改动原文档。

## 分卷导出与前置页（E2 / E4）

- `exportEpubVolumes(doc, options)` 返回 `{ name, index, bytes }[]`：按顶层 `volume` 切分，每卷独立 OPF / nav / ncx / spine；卷后散块归入当前卷，首个卷前的封面 / 前置页只随首卷导出。
- 卷名取 `volume` 标题（缺省「卷 N」），书名写作「原书名·卷名」；各卷 `dc:identifier` 由基础标识符 + 卷序号确定性散列，重复导出一致。
- 无 `volume` 节点时返回单卷，字节与 `exportEpub` 完全一致；`exportEpub` 签名不变。
- 前置页（封面 / 书名页 / 版权页 / 封底）各成独立 XHTML（`FRONT_MATTER_TYPES`），spine 顺序保持原文档顺序，且不进 nav / ncx 目录；`body` 输出 `epub:type="cover" / "titlepage" / "copyright-page"`，封底不标注。
- 既有 EPUB 的文件数会因前置页独立而增加；正文序列化未变。

## 字体内嵌与子集化（E3）

古籍字体动辄 10MB 级，全量嵌入会让 EPUB 超出平台上传上限。E3 按**全书用字**
子集化字体，再以 `@font-face` 内嵌：80 万字文档（8 个唯一字）实测体积下降 ≥60%。

子集化是异步能力（后端可能是 wasm 或子进程），而导出器保持同步。因此拆成两段：

```ts
import { prepareFontBundle, type FontSubsetBackend } from '@bibliotype/fonts';
import { exportEpub } from '@bibliotype/exporter-epub';

/* 1) 宿主注入子集后端（示例：harfbuzz wasm 封装；也可用 fonttools 子进程） */
const subsetFont: FontSubsetBackend = {
  name: 'subset-font',
  async subset({ bytes, chars }) {
    const out = await subsetFontWasm(bytes, chars);
    return { bytes: out, missingChars: checkMissing(chars) };
  },
};

/* 2) 导出前准备字体包（用字统计 → 子集化 → @font-face / 许可 / 报告） */
const fonts = await prepareFontBundle(document, [
  {
    id: 'font-kai',
    family: 'Classical Kai',
    bytes: await readAsset('font-kai'),
    format: 'ttf',
    weight: 400,
    license: { name: 'SIL Open Font License 1.1', copyright: '© 2026 Example' },
  },
], {
  backend: subsetFont,
  fallbackStack: "'Classical Kai', 'Noto Serif SC', serif",
  fontDirectory: 'fonts/', // CSS url 前缀，缺省即 fonts/
});

/* 3) 同步导出（只消费结果） */
const bytes = exportEpub(document, {
  fonts,
  onValidation: (problems) => console.table(problems), // FONT-REPORT 告警
});
```

产物增量（不传 `fonts` 时零残留）：

| 路径 | 内容 |
| --- | --- |
| `OEBPS/style.css` | `@font-face` 声明前置（子集字体优先于主题字体栈），后接 `buildBookCss` 产物 |
| `OEBPS/fonts/bt-<族>-<字重><i>-<hash8>.<ext>` | 子集字体字节（内容散列命名，同输入产物逐字节一致） |
| `OEBPS/fonts/LICENSE.txt` | 许可声明（族名 / 许可 / 地址 / 版权；无任何许可时不写） |
| `OEBPS/content.opf` | manifest 增加 `font-N`（`font/woff2` 等）与 `font-license`（`text/plain`）；许可行写入 `dc:rights` |

要点与边界：

- **用字统计**：遍历 IR 文本节点（ruby / 标题 / 注文均在内），过滤控制符、保留空白与标点，去重升序后交给后端；`extraChars` 可并入 UI 文案等固定字符。
- **缺字回退**：后端返回 `missingChars` 时，告警按主题字体栈给出降级链
  （如「已按回退链降级：Noto Serif SC → serif」），与 [K6 缺字报告](#导出前缺字报告k6)
  同口径；后端未返回覆盖信息时提示「报告可能不完整」，不做假阴性判断。
- **告警透出**：缺后端 / 缺字 / 未声明许可均以 `code: 'FONT-REPORT'` 经
  `onValidation` 报告，**即使 `validate: false` 也报告**（缺字不能静默上线）。
  级别均为 `warning`，不阻断导出。
- **体积口径**：`bundle.report` 给出 `sourceBytes / subsetBytes / reduction /
  families[].missingChars / fallbackChain`，宿主可先看报告再决定是否导出。
- **EPUB 2**：字体 manifest 与 `dc:rights` 同样输出；不写任何 EPUB 3 专属 `meta`。
- **不内置二进制**：`@bibliotype/fonts` 只定义 `FontSubsetBackend` 端口，`subset-font` /
  `fonttools` 由宿主适配；无后端时导出仍可完成（原字节嵌入 + 告警）。

