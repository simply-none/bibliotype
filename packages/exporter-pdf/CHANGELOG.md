# @bibliotype/exporter-pdf

## 26.10.25-rc.1

### Minor Changes

- 桌面宿主流式导出支持：书档内联图片去重令牌化 + 分段多文件导出（`renderPageRange`）。
  
  - **新增 `dedupeInlineImages(document, options?)`**：写时复制遍历书档，把 `attrs.src` 的 `data:image/…` 收敛为唯一令牌 `__bibliotype_asset_N__`（同一张图只保留一份、按首现顺序；未触及子树与原档共享引用，不整树深拷贝、不改入参）——EPUB / docx 导入把缺字图逐处内联，同一张图每出现一次就带一份完整 base64，千页级书籍的书档因此膨胀到数百 MB。
  - **新增 `rehydrateInlineImages(document, resolve)`**：就地把令牌 src 还原为真实 URL（宿主收到瘦身书档后调用，通常已把图片逐张落盘为相对路径）；未知令牌保持原值。
  - **`PrintPager` 新增 `renderPageRange(from, to)`**：输出只含区间内页面的独立 HTML 文档（外壳与 `renderDocument` 一致，全区间逐字节等于 `renderDocument`），供桌面宿主「分段打印、逐段落盘多文件」使用；auto 模式调用抛错。
  - 配套的渐离App 会话协议（begin → 逐张 asset → prepare 缓存分页器 → 工作台弹窗逐段 segment，每段独立打印落盘为 `书名_00x.pdf`，弹窗停留逐段显示状态与路径，可中止保留已完成）见该宿主 `electron/main/module/bibliotype.ts` 与其技能文档。
- PDF 光栅直出：清晰度四档 + 并发流水线 + Worker 离线程 JPEG 编码，清晰度与导出速度双优化。
  
  - **清晰度档位**：`RasterPdfOptions.scale` 从 `1 | 2` 放开为 `number`（clamp 1~4，非有限值回退 2 = 192dpi 标准）——1=96dpi 草稿 / 2=192dpi 标准 / 3=288dpi 高清 / 4=384dpi 印刷；像素量、编码耗时与文件体积按倍率平方增长。
  - **并发流水线**：新增 `concurrency` 选项（clamp 1~6，缺省 3）——光栅化按滑动窗口并发，SVG 解码 / Worker 编码与下一页序列化重叠；PDF 页序恒按页码嵌入，进度与中止语义不变（中止停止填入新页、排空在途页后抛 `AbortError`，已完成页计入进度）。
  - **Worker 离线程编码**（新增 `raster-worker.ts`）：主线程完成 SVG 解码与按 scale 矢量直绘（清晰度来源，不做先小后大缩放）后，`createImageBitmap` 位图 transfer 给 Worker 池（内联 Blob URL 源码，不依赖打包器 worker 插件；数量随 CPU 收敛，上限 4）做白底 + JPEG 编码，字节零拷贝回传——编码段多核并行且主线程只剩序列化与 pdf-lib 拼装。能力不全（旧浏览器 / Node / happy-dom）自动整体回退主线程 toBlob 路径；`rasterize` 注入时同样不启用 Worker 池。
  - **零延迟让出**：逐页让出从 `setTimeout(0)`（嵌套 ~4ms 钳制）改为 `MessageChannel` 宏任务，千页级导出省去纯让出开销数十秒；保留 setTimeout 回退。
  - demo 宿主侧（私有包）：「其他」分区新增「光栅清晰度」四档设置（`pdfRasterScale`，随界面偏好快照持久化，缺省标准 192dpi），仅对应用内直出生效。
- 新增「古籍仿真直排」：版框 / 界行 / 版心（书口）与六种古籍版式模板
  
  - `layout`：新增 `LayoutOptions.facsimile`（缺省 `undefined` = 不启用）、
    `FACSIMILE_PRESETS` 六模板、`resolveFacsimileGrid` 行款与几何纯函数；
    版心带宽进入主轴扣减与度量签名，版框 / 界行 / 颜色属纯绘制、不触发重排；
    `buildBookCss` 新增 `pageDecoration`（默认 `false`）与同源版心序列化。
  - `reader`：新增 `getPageGutterTexts` 与 `resolvePageGutterTexts`（书名 / 篇卷 / 叶次）。
  - `vue`：`BtBookView` / `PagedCanvas` 在带 `facsimile` 时开启装饰并注入版心。
  - `exporter-pdf`：`paged` 模式同步版框 / 界行 / 版心，打印与预览一致。
  
  兼容性：既有「古籍直排」与「现代横排」行为不变——未启用 `facsimile` 时样式表、
  版心尺寸与度量签名与改造前逐字符 / 逐数值相同（新增 `classical-isolation` 回归测试守护）。
- P2 能力批次（H3 书架 / H4 备份 / H5 加密 / C5 修订 / C7 历史）：
  
  - **H3 书架**：`DocumentSummary` 追加可选字段（`author` / `isbn` / `tags` / `coverThumbnail` / `wordCount` / `progress` / `lastOpenedAt`），旧记录经 `mergeDocumentSummary` 回退；新增可选端口 `BookLibraryStore`（`query`）与 `BookSummaryStore`（`updateSummary`），`StorageAdapter` 必选方法不变；`.btbook` 单书档（`packBookArchive` / `unpackBookArchive`，ZIP 经 `BookPackCodec` 端口由宿主注入）；`BtBookShelf` + `useBookLibrary`。
  - **H4 备份**：`buildLibraryBackupFiles` / `restoreLibrary`（`merge` / `overwrite` / `keep-both` 三策略、逐书校验、进度回调、失败清单不中断整批）；`BtBackupPanel`。
  - **H5 加密**：`deriveKeyPbkdf2` / `createStringCipher` / `createByteCipher`、存储与资产加密装饰器、注记独立密钥（`createEncryptedAnnotationStorage`）、导出脱敏（`redactDocument` / `redactAnnotations`）；`CryptoError` 稳定错误码，禁止静默降级为明文；`BtEncryptionPanel`。
  - **C5 修订**：新增 `insertion` / `deletion` / `format-change` 标记与 `createRevisionTrackingPlugin`（删除内容保留，拒绝可无损还原）；`acceptRevision` / `rejectRevision` / 全部接受拒绝、`setRevisionMode` / `setRevisionView` / `setRevisionAuthor`；序列化新增 `revisionView`（`marked` / `final` / `original`），EPUB / PDF / 站点导出缺省终稿；`BtRevisionSidebar`。
  - **C7 历史版本**：`createSnapshot` / `restoreSnapshot`（校验和 + `validateDocument` 双检）、`diffDocuments`（节点级 LCS + 字符级内联 diff）、保留策略；`DocumentVersionStore` 端口与 `IndexedDbVersionStore` / `MemoryVersionStore`；`BtVersionHistory`。
  - **兼容性**：三个适配器共用 `storage-contract.ts` 公共契约套件；HTTP 适配器的 `query` 在客户端过滤，不新增服务端端点，且不实现 `BookSummaryStore`。
  - **依赖**：生产依赖零新增；demo 的 `.btbook` codec 为仓库内零依赖 STORE 实现，未引入压缩库。
- P3 古籍能力批次（K3 句读 / 专名标注、K6 缺字兜底、K7 典籍元数据）：
  
  - **K3 句读 / 专名自动标注**：`classical` 新增 `suggestJudou` / `judouMarkerRange` / `JUDOU_SYMBOLS` / `EXISTING_PUNCTUATION`、`detectProperNames` / `BUILTIN_PROPER_NAME_TERMS`（内置人名字典）与 `ProperNameDetector` 模型端口、`buildAnnotationSuggestions` / `collectSuggestionBlocks` / `countSuggestions`（确定性 id、段内 UTF-16 偏移、同偏移去重）；新增 `judou` 标记（`attrs.symbol` / `source=auto` / `suggestionId` / `rule` / `confidence`，编辑画布与序列化同口径）；新增命令 `applyJudouSuggestions` / `applyProperNameSuggestions` / `removeSuggestionMarks` / `commitJudouAsText`（单事务、可一次撤销）。`vue` 新增 `useAnnotationSuggestions`（待处理 / 已接受 / 已拒绝 / 已落地状态机）与 `BtAnnotationSuggestions` 审阅面板；布局侧新增 `.bt-mark-judou::after` 候选符号样式。
  - **K6 缺字与字形回退**：`core` 新增 `parseIds` / `formatIds` / `countIdsLeaves`（U+2FF0–U+2FFB 全部 12 个运算符，组件不足 / 超深给中文 issue）、`resolveGlyphFallback`（主字体链 → IDS → 方框，`GlyphProbe` 缺省视为命中）、`collectGlyphIssues` / `summarizeGlyphIssues`（字符 / 码位 / IR 路径 / 上下文，可按字符去重）；`layout` 新增 `renderIdsSvg` / `renderIdsGlyphHtml`（纯字符串、零依赖、同描述逐字节一致）与 `serializeNode({ glyph })` 逐字替换、书册样式 `.bt-glyph`；`exporter-epub` 新增 `collectEpubGlyphProblems`（`warning` 级 `ValidationProblem[]`，不阻断导出），`exporter-pdf` 新增 `collectPdfGlyphProblems` / `summarizePdfGlyphProblems`。`vue` 新增 `useGlyphAudit` 与 `BtGlyphAuditPanel`。
  - **K7 典籍元数据规范**：`BookMetadata` 新增可选字段 `classicalCategory`（经 / 史 / 子 / 集 + 二级类）、`editionType`（刻本 / 抄本 / 活字本 / 稿本）、`repository`、`callNumber`，配套 `CLASSICAL_DIVISIONS` / `EDITION_TYPES` 与 `validateMetadata` / `isClassicalDivision` / `isEditionType`（中文 issue，非法值拦截）；新增 `toDublinCore` / `serializeDublinCore`（固定键序 JSON）与 `toCnmarc`（001 / 200 / 205 / 210 / 215 / 300 / 606 / 686 / 690 / 801 / 905 字段行）、`migrateLegacyMetadata`（旧 `extra` 提升，幂等、顶层优先）；`exporter-epub` 的 OPF 补 `dc:subject` / `dc:type` / `dc:source`。
  - **兼容性**：均为增量导出与可选字段，既有函数签名不变；`serializeNode` 仅在显式传入 `glyph` / `tagOverrides` 等新选项时改变输出，默认产物逐字节不变；OPF 新增 `dc:subject` / `dc:type` / `dc:source`（无对应元数据时省略）；`judou` 标记为新增，既有文档不受影响。生产依赖零新增，库内仍不写存储。
- P4 批 6（E8）：PDF 精排管线——对页镜像、出血 / 裁切线、图片 DPI 检查与 CMYK 印前提示。
  
  - **对页镜像**：`facing?: boolean | { gutter }`。`paged` 模式逐页打 `bt-page-recto / bt-page-verso`（第 1 页为右页），`.bt-page` padding 四边重写，`gutter` 加在内侧页边距；`auto` 模式走 `@page :right / :left`（Chromium 对页选择器不稳，生产建议 `paged`）。仿真版式书口带宽先并入物理边再叠中缝。
  - **出血与裁切线**：`bleed`（mm，单边）→ `resolveBleedPx`（96dpi 四舍五入），页面与 `.bt-page` 同步 +2b、padding 四边 +b，版心尺寸不变；`cropMarks` 在 `paged` 每页插入 `.bt-crop-marks`（四角 L 形，臂长 = 出血、线宽 0.5px）；`auto` 额外下发 `marks: crop cross` 与 `bleed` 说明符（Chromium 忽略，Prince / Vivliostyle 可用）。
  - **图片打印规则**：`imageRules` 输出 `max-width: 100%` + `max-height: 版心高` + `height: auto`——等比缩小、不裁切、不放大。
  - **图片检查**：`readImagePixelSize` 按文件头嗅探 PNG / JPEG / GIF / BMP；`collectPdfImageProblems(document, { layout, tokens, minDpi })` 输出 `IMAGE-OVERSIZE`（超出版心，>40MP 升 warning）、`IMAGE-LOW-DPI`（有效 DPI 低于阈值，含最大成品尺寸 mm）、`IMAGE-UNMEASURED`（外链 / 非 base64 / 非四种位图）；`summarizePdfImageProblems` 出单行摘要。只提示、不阻断导出。
  - **CMYK 提示**：`collectPrintColorAdvice(document, { target, hasIccProfile, rasterImageCount })` 输出 `PRINT-CMYK-UNSUPPORTED` / `PRINT-ICC-MISSING` / `PRINT-RGB-IMAGE`——浏览器打印管线只出 DeviceRGB，正式印刷需下游按 ICC 转 CMYK；`target: 'rgb'`（数字校样）返回空。
  - **后端评估**：Paged.js（MIT，polyfill 约 0.8MB）与 `reader` 预分页重叠且不改善 CMYK / 裁切；Vivliostyle（AGPL-3.0，CLI 依赖 Chromium）可经 `PdfExportAdapter` 由宿主接入——两者均不内置，库零新依赖。
  - **测试**：新增 `print-refinement.test.ts` 29 例（A4 对页镜像、出血尺寸换算、裁切标记注入、四类位图嗅探、超限 / 低 DPI / 无法测量、CMYK 三类提示与负例），`exporter-pdf` 合计 65 例；`docs/08` 已回写。
- PDF 导出新增「应用内直出」路径，并修复古籍直排打印分页：
  
  - 新增 `createPrintPager(book, options)`：打印分页器（Reader 构建、全量分页与 CSS 拼装缓存一次），暴露 `pageCount` / `renderPage(index)` / `documentCss` / `renderDocument()`；`renderPrintHtml` 改为基于 pager 实现，对外产物逐字节不变。
  - 新增 `exportRasterPdf(book, options)`（纯浏览器免打印对话框）：逐页 `<foreignObject>` 光栅化 → JPEG → pdf-lib（新依赖 `pdf-lib@^1.17.1`）拼装 PDF 直接下载；支持 `scale` / `quality` / `onProgress` / `signal`（中止）/ `rasterize`（注入式单页光栅化，Node 测试用）。产物为图片型 PDF；矢量文本仍走 `exportPdfBytes` 宿主适配器。
  - 直排修复：paged 模式内部打印分页 Reader 显式传 `axis`（竖排 → `'column'`）与 `tokens`，与屏幕量尺同口径——此前直排书的块推进量（列向宽度）被按横排行高解释，分页与跨页行切片错位（古籍直排导出后续页只剩版框空白的根因）。
  
  demo（私有包，不随版本发布）：设置面板新增「其他」分区，「PDF 导出方式」（`pdfExportMode: 'in-app' | 'browser-dialog'`，应用级偏好随界面偏好快照持久化，缺省 `in-app`）在应用内直出与打印对话框之间路由；Electron 宿主恒走矢量适配器；导出中按钮显示「导出中 N/M」，再次点击中止。
- ruby 行盒精修（B6）：注音行高按实测行盒判页，不再用均高近似。
  
  - `layout`：`MeasurableBlock.lineMainSizes`（逐行主轴尺寸）+ `lineCountOfBlock` / `lineMainSizeAt` /
    `lineRangeMainSize`；`paginate` 按行累加判页与结算片段，孤寡行 / keepWithNext 同口径；
    缺省 / 长度不符回退 `lineSize`，行为与旧版一致；
  - `vue`：量尺以基础文本矩形划行（排除 `<rt>` 注文误判为独立行），再把注音矩形按交叉轴并入所在行，
    产出 `MeasurePaginationResult.lineMainSizes`（直排为逐列列宽）；`buildPagedLayout` 增量合并 /
    陈旧项清理 / 片段尺寸同步；`ruby > rt` 增 `line-height: 1.2`（不继承正文大行距）；
  - `reader`：`ExtractBlocksOptions` / `ReaderOptions` / `RepaginateOptions` 新增 `lineMainSizes`，
    块携带逐行尺寸、行数取数组长度、均高取均值作回退；
  - `exporter-pdf`：`PrintDocumentOptions.lineMainSizes` 透传逐页分页，PDF 与屏幕分页一致。
- 竖排细节包（B7）：竖排标点 / 引号形态与数字分组。
  
  - `layout` 新增 `vertical-text.ts`：`VERTICAL_PUNCTUATION_FORMS`（`。︒` `、︑` `「﹁`
    `」﹂` 等 22 个竖排呈现形式）、`toVerticalPunctuation`、`toKanjiDigits`、
    `toFullwidthDigits`、`transformVerticalText`、`needsVerticalTextTransform`；
    转换逐字符一一对应，不改字符数 / 文本偏移；
  - `combine-upright` 新增 `longDigits: 'kanji'`（超长数字串转汉字数字直排），
    `segmentForVertical` / `combineUprightCss` 选项改为可部分传入；
  - `serializeNode` 新增 `SerializeNodeOptions.verticalText`（缺省不转换，交给浏览器
    `vert` 特性；代码块逐字输出不受影响）；
  - `exporter-pdf` 新增 `PrintDocumentOptions.verticalText`，`auto` / `paged` 两条
    打印路径透传。
- 直排排版引擎 v2 批 4（行款规则全链）：低格 / 抬头 / 提行的分页折算、导出同源与横排降级。
  
  - **分页折算**：`MeasurableBlock` 新增 `breakColumn`（列级断列）——段落行款
    `breakLine` / 平抬（`lift: 'newline'`）在 extractBlocks 时标注，paginator 在
    直排（axis column）下把当前列剩余空间弃用（usedMainSize 对齐列距），块从
    新列顶格起写；横排无操作（降级换段）。`defaultEstimator` 接入
    `lineRuleOverhead`：低格 / 挪抬使首行有效容量扣减，行数估算不再偏少
    （提行 / 平抬的断列空耗由实测路径承载，估算不折算）；
  - **导出同源**（exporter-pdf paged 直排）：段落 / 引文与预览共享
    `serializeVerticalFlow`（连排 / 双行夹注固定双列 / 低格与抬头标记），
    续排片段（fromLine>0）自动省略行款前缀；`serializeVerticalFlow` 新增
    `nodeOptions` 透传（tagOverrides / rewriteSrc / verticalText / revisionView），
    夹注子列内容改用 `sliceNodeByCharRange` 切片——夹注内的行内标记
    （专名号 / 着重等）随所在子列保留（批 2 纯文本简化的修正）；
  - **横排 / EPUB 降级**：book-css 新增行款属性选择器——段落 / 引文的
    `data-indent` 1~4 输出 `text-indent`（覆盖令牌缩进）、挪抬在无低格并存时
    补 1em（`:not([data-indent])` 门；并存时被吸收的口径差异记录于 docs/03）；
    无行款属性的段落不受影响（EPUB 老引擎 flatten 安全降级为令牌缩进）；
  - 古典基线第十八次重锁；docs/03 新增「行款规则」节、docs/08 导出同源说明。
- 直排排版引擎 v2 批 5（版面骨架扩展）：书耳 / 鱼尾扩展 / 眉栏 / 眉批旁批装饰位 / 两截本三截本。
  
  - **书耳（耳题）**：`facsimile.ear` 选项——版框外上角小方框竖排题本页篇名；
    `reader.getPageEarText`（章名 → 卷名 → 书名回退，封面不标）与
    `serializePageEar` 三端共用；预览（page / scroll / 对页）、编辑画布、打印
    paged 同步注入；
  - **鱼尾扩展**：数量枚举至三 / 四尾（多尾沿版心带均布、上下相向交替——偶数
    序尾垂直镜像）；新增 `fishTailStyle`（black / white / line / floral 四态），
    序列化输出 `data-fish-style`；
  - **眉栏**：`facsimile.eyebrow` 选项——版框上方天头横线区；
  - **眉批 / 旁批装饰位**：仿真直排下 `head-note` 分流到天头容器（多列小字）、
    `margin-note` 分流到界行外窄条（预览与打印 paged 同口径；编辑画布保持
    flow 原位可编辑）；
  - **两截本 / 三截本（两截楼）**：结构节点 `bands`（2|3，`bandRatio` 缺省
    0.4/0.6 与 0.25/0.35/0.4）+ 内容节点 `band` 归截——paginator 按截位分组、
    各截以「页容量 × 截高占比」独立装箱、页按序交错合并；渲染层
    `groupNodesByBand` 分组包 `.bt-bands` 分层容器（截间横线、各截独立连排），
    预览与打印 paged 同构。已知限制：与页底浮注并存未支持、`bandRatio` 自定义
    占比渲染读取待后续、编辑画布暂按平铺。
  - 花栏（竹节 / 博古 / 卍字栏）按计划低优先顺延；古典基线零变化（装饰仅
    facsimile 路径）。
- 直排排版引擎 v2 批 6（批点与套印）：墨色色层 / 单色模式 / 圈点双位 / 卷末总评样式。
  
  - **套印墨色**：core 新增 `INK_COLORS`（black / red / blue / yellow）；注 / 批
    类节点（footnote / endnote / margin-note / head-note / tail-note /
    collation-note / double-note / inline-note / general-review）与圈点标记的
    规格登记 `inkColor` 属性；命令 `setInkColor(color | null)` 作用于光标所在
    注 / 批节点（black / null 回归全墨）；
  - **渲染**：book-css 新增套印墨色规则——`data-ink` 属性选择器取
    `--bt-ink-*` 变量（朱 / 蓝 / 黄，主题可覆盖），预览 / EPUB / PDF 全路径
    输出（批点套印不限仿真书）；
  - **单色模式**：`buildBookCss({ monoInk })` 跳过色层规则（批注圈点回归全墨）；
    PDF / EPUB 导出选项 `monoInk` 透传——单色印刷交付；
  - **圈点双位**（§11.4）：句读标记居字右下（缺省）、文法符号经圈点标记
    `position: 'grammar'` 居字右（直排惯行，两类不争空间）；密度档受 CSS
    text-emphasis 能力限制顺延（style 实心 / 镂空二维替代，docs 记录）；
  - **卷末总评样式**：`.bt-general-review` 结构块（分隔线起首、注文色、小一号，
    补批 1 节点缺口）；注码圈码由 marker 字形（① ② …）内容层承担。
  - 古典基线第十九次重锁（套印与圈点规则为全路径输出）。
- 直排排版引擎 v2 批 7（图文与整叶收尾）：筒子叶版心交替 / 叶次 a/b 页码 / 插图版式。
  
  - **筒子叶版心交替**：`facsimile.gutter.alternate` 选项 + `facsimilePageOf`
    页级变体纯函数（奇数页翻转版心侧，耳框与内缩随页）——预览 BtBookView
    （page / scroll / 对页的版心、耳框、页框内缩）、编辑画布 PagedCanvas
    （页框内缩 + data-gutter-side 打标）、打印 paged（版心 / 耳框随页 +
    `.bt-page[data-gutter-side]` 镜像内缩 CSS）三端接入；分页与度量不分侧
    （带宽尺寸对称，页数与既有口径一致）。docs/22 已知限制 3「版心恒在左侧」
    自本批解除；
  - **叶次 a/b 页码**：`PAGE_NUMBER_STYLES.LEAF_AB`（`leaf-ab`）——一叶两半叶
    页码体系（奇数页「第 X 叶·上」、偶数页「第 X 叶·下」，中文叶数），与
    decimal / chinese / roman 并行；
  - **插图版式**：`image.attrs.layout`（editor 规格登记）——`embedded`（缺省
    嵌入正文）/ `full-width` 整幅独占版心宽 / `half-width` 半幅居中；
    序列化透传 `data-layout`、CSS 属性分支；复合版式（上图下文 / 左图右文 /
    双面连式）由结构层承担（两截本 bands / 对页）；
  - 图文对照阅读按计划列为可选未实现（平台功能非版式规则）。
  - 古典基线第二十次重锁（插图版式属性规则全路径输出）。

### Patch Changes

- P4 批 1（I9）：SSR/Node 矩阵。九个关键包新增 `src/__tests__/exports.test.ts`（node 环境导入包入口，断言关键导出存在且全程无 DOM 全局依赖）；CI `verify` job 改为 Node 20/22 双版本矩阵（`fail-fast: false`）；`docs/15` 补 import / import-epub / import-docx / exporter-site 的 SSR 可用性标注与冒烟护栏说明。
- PDF 导出样式与预览一致性修复（现代横排 / 古籍直排 / 古籍仿真直排）：
  
  - 光栅直出（`exportRasterPdf`）foreignObject 包装改为 XHTML `<body>`——此前包成
    `div` 使 `body {…}` 根规则与全部 `body .bt-*` 作用域规则失配，字体 / 颜色 /
    书写方向全丢（直排变横排）；
  - 打印 CSS 补根级 `text-indent`（容器段落 `inherit` 链不再断到 0，双行小注 /
    夹注首行缩进与预览一致）；
  - `page-border` 令牌（古籍直排双边版框）在 paged 模式逐页绘制，与预览页框
    inline 同值（分页口径本就扣除 border 宽度，此前不画框留空位）；仿真版式
    与令牌成对失效的闸门与预览一致；
  - 逐页分栏双通道：版面级（`layout.columns`）落 `.bt-page` 根级 `column-count`，
    块级（结构节点 `attrs.columns`）探测分页结果后包 `.bt-page__flow[data-columns]`
    下发分栏规则；paged 下 body 根规则不再分栏（避免把 `.bt-page` 序列当栏内容排）；
  - 页底浮注：`footnoteFloat` / `noteMaxRatio` 选项透传内部 Reader（与预览同源），
    每页渲染 `.bt-page-notes` 注区（含跨页续注标记）。
