# 31 注释（脚注 / 尾注 / 边注）

> 涉及包：`@bibliotype/core` / `@bibliotype/editor` / `@bibliotype/layout` / `@bibliotype/exporter-epub`　·　相关：[01 数据模型](01-document-model.md)、[02 编辑器与插件](02-editor-and-plugins.md)、[07 EPUB 导出](07-export-epub.md)、[30 文档统计](30-document-stats.md)

注释在这套 IR 里是**块级容器**（与段落平级），不是行内引用：注文就是文档树里的一个块，编辑、分页、导出全走同一条链路，不需要为「脚注」再造一套行内数据结构。

| 类型 | 语义 | EPUB 3 `epub:type` |
| --- | --- | --- |
| `footnote` | 页底注，随文就近 | `footnote` |
| `endnote` | 篇末 / 书末注，集中排布 | `endnote` |
| `margin-note` | 边注，版心外侧 | `sidebar` |

边注在 EPUB 结构语义词汇里没有独立词条，映射为 `sidebar`（旁栏内容），既贴近读者预期，也不会让 epubcheck 报未知词汇。

## core：类型归属、注码与编号

```ts
import {
  NOTE_NODE_TYPES,   // ['footnote', 'endnote', 'margin-note']
  NOTE_ROLES,        // { FOOTNOTE: 'footnote', ENDNOTE: 'endnote', MARGIN_NOTE: 'sidebar' }
  NOTE_LABEL_STYLES, // { ARABIC: 'arabic', CIRCLED: 'circled', CHINESE: 'chinese' }
  isNoteNodeType,
  isNoteNode,
  noteRoleOf,        // 'footnote' → 'footnote' | 'endnote' | 'sidebar'
  formatNoteLabel,   // 序号 + 样式 → 显示注码
  collectNotes,      // 全书扫描 + 编号
  nextNoteIndex,     // 下一个可用序号
} from '@bibliotype/core';
```

注码格式：

```ts
formatNoteLabel(3);                                    // '3'
formatNoteLabel(3, NOTE_LABEL_STYLES.CIRCLED);         // '③'（21 起回退 '(21)'）
formatNoteLabel(21, NOTE_LABEL_STYLES.CHINESE);        // '二十一'
formatNoteLabel(0);                                    // '1'（非法序号按 1 处理）
```

全书扫描：

```ts
const entries = collectNotes(document.root, { labelStyle: NOTE_LABEL_STYLES.CIRCLED });
// [{ node, type, role, index, id, label }, ...]

entries[0]?.id;    // 节点自带 id，否则 `note-footnote-1`（可直接做跳转锚点）
entries[0]?.label; // 节点 `attrs.marker` 优先（作者手写注码），否则按序号格式化
```

口径：

- **按类型分别编号**：脚注 1、2、3… 与尾注 1、2、3… 互不干扰；
- 注释内部不再下钻（注释不嵌套，避免计数器错乱）；
- 手写注码（`attrs.marker`）只影响显示，序号照常递增，后续注码不会错位。

## editor：插入命令与自动编号

```ts
import {
  insertFootnote,
  insertEndnote,
  insertMarginNote,
  insertNote,
  insertNoteRef,
} from '@bibliotype/editor';

insertFootnote({ text: '习，鸟数飞也。' });
insertFootnote({ text: '第二条', labelStyle: 'circled' }); // 自动编号为 ②
insertEndnote({ text: '篇末注。' });                       // 尾注独立编号，从 1 起
insertMarginNote({ text: '旁批' });
insertNote(NODE_TYPES.FOOTNOTE, { marker: '*' });          // 手写注码
insertFootnote({ text: '只插注文', withRef: false });       // 不写正文引用
insertNoteRef({ targetId: 'note-footnote-1' });            // 为已有注释补引
```

行为：

- 位置：插在**当前块之后**，光标随即落入注文段落，可直接输入；
- 编号：按文档内**同类现存注释数量 + 1** 自动递增，与光标位置无关，删掉中间一条也不会重号；
- 引用：缺省在光标处同时写入上标注引用（`noteref` 标记），正文与注文靠 `targetId` / `refId` 成对关联；`withRef: false` 只插注文；
- id 生成：`note-<type>-<序号>` 与 `ref-<type>-<序号>`，冲突时追加 `-2`、`-3`…；
- 光标已在注文内时，新注释插在该注释**之后**（不嵌套注文）；
- `insertNote` 收到非注释类型、schema 未注册该节点、或光标位于文档根（`depth === 0`）时返回 `false`。

schema 侧：三种注释节点的规格带 `marker`（显示注码）与 `refId`（回跳锚点）属性（`NOTE_NODE_ATTRS`），缺省 `null`，IR 往返时省略、不污染 `attrs`。

## noteref：正文上标与双向跳转

注引用是**标记**（`MARK_TYPES.NOTE_REF`）而不是行内节点：它只承载「指向哪个注释」这层关系，不构成结构，随文字移动 / 删除，也避免在分页与文本抽取里为行内原子节点另开特例。

```ts
// IR 形态
{ type: 'text', text: '1', marks: [{ type: 'noteref', attrs: { targetId: 'note-footnote-1', refId: 'ref-1' } }] }
```

- `targetId`：注释块 id（`href="#…"` 的目标）；
- `refId`：本条引用自己的锚点 id，注文末的 `↩` 回跳链接指向它；
- `inclusive: false`（同 link）：引用后继续输入不会继承该标记。

## layout：序列化与样式

```ts
import { serializeNode } from '@bibliotype/layout/html';

serializeNode(footnote);
// <aside id="fn-1" class="bt-footnote"><p class="bt-paragraph"><span class="bt-note-marker">1</span>注文</p></aside>

serializeNode(footnote, { epubSemantics: true });
// <aside id="fn-1" class="bt-footnote" epub:type="footnote">…<a class="bt-note-backref" href="#ref-1">↩</a></aside>
```

- 注码提为真实 `<span class="bt-note-marker">` 并**注入首个段落内部**，与注文同起一行（若与段落平级，块级段落会把注码挤到单独一行）；
- `epub:type` 只在 `epubSemantics: true` 时输出：EPUB 导出开启，站点导出 / PDF 打印稿保持关闭，不输出 HTML 规范外的属性；
- `marker` / `refId` 不再重复输出成 `data-*`；
- 注引用输出为 `<a id="ref-1" class="bt-mark-noteref" href="#note-footnote-1" epub:type="noteref">1</a>`；无 `targetId` 时退化为不带 href 的 `<a>`；
- 注文 `attrs.refId` 存在时，块末追加 `<a class="bt-note-backref" href="#ref-1">↩</a>` 回跳链接（纯 HTML 与 EPUB 都输出，EPUB 2 不带 `epub:type`）；
- 样式：`.bt-footnote` / `.bt-endnote` / `.bt-margin-note` 沿用注文字号与颜色令牌，`.bt-note-marker` 管注码与注文间距，`.bt-mark-noteref` 做正文上标（颜色继承正文，不做成蓝色链接），`.bt-note-backref` 管回跳符号。

## exporter-epub：语义输出

`exportEpub` 在 EPUB 3（默认）路径上自动开启 `epubSemantics`，章节壳已声明 `xmlns:epub`；EPUB 2（`version: '2.0'`，京东读书等 RMSDK）不输出该属性。

```ts
exportEpub(document);                    // 注释块带 epub:type
exportEpub(document, { version: '2.0' }); // 不带 epub:type
```

## 限制与后续

- 目前是**块级注释**：注文排在其在文档中的位置（脚注就近、尾注集中靠作者手排），没有「正文上标 + 页底浮注」的自动分栏排版（能力清单 B5「脚注浮注」仍未做）；
- 尾注尚未按章聚合到篇末 / 书末（`sections.ts` 无 NOTE 处理），当前与脚注同样就地排版；
- 编号只在插入时写入 `attrs.marker`，批量重排（删注后全局重编）需要按 `collectNotes` 结果回写，暂未提供命令。
