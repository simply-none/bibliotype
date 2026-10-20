# 30 文档统计与词表检查

> 涉及包：`@bibliotype/core`　·　相关：[01 数据模型](01-document-model.md)、[23 IR 校验、迁移与锚点](23-ir-validation-and-migration.md)、[24 标注](24-annotation.md)

写作辅助的**纯函数底座**：字数 / 词数 / 阅读时长 / 章节字数分布，以及按词表做的错别字、敏感词、术语检查。全部作用于 `BookDocument`，不依赖编辑器、DOM 或当前时间，可在编辑态、导出前校验、CLI 与阅读器中共用。

## 统计 `countDocumentStats`

```ts
import { countDocumentStats } from '@bibliotype/core';

const stats = countDocumentStats(document, {
  notes: 'separate',       // 注释口径：separate（默认）/ include / exclude
  charsPerMinute: 400,     // 阅读速度（默认 400 字/分）
  countPunctuation: false, // 字数是否含标点（默认 false）
});

stats.characters;      // 正文字符数（去空白，默认去标点）
stats.noteCharacters;  // 注释字符数（exclude 时为 0）
stats.totalCharacters; // 正文 + 注释
stats.words;           // 词数（CJK 逐字，拉丁连续串计 1 词）
stats.readingMinutes;  // 阅读时长（向上取整）
stats.blocks;          // 叶级块数量
stats.notes;           // { footnote, endnote, marginNote }
stats.structures;      // 卷 / 章 / 节 / 附录 / 前言 / 后记的字数分布
```

口径约定：

| 项 | 规则 |
| --- | --- |
| 字符 | 去空白；默认剔除标点与符号（`\p{P}` / `\p{S}`），`countPunctuation: true` 时保留 |
| 词 | CJK 逐字计 1，拉丁字母 / 数字连续串计 1 词，公式节点不计 |
| 注释 | `footnote` / `endnote` / `margin-note` 子树：单独统计、计入正文或忽略 |
| 阅读时长 | `ceil(正文 / charsPerMinute)`，`charsPerMinute <= 0` 或空文档为 0 |
| 结构分布 | 先序遍历卷 / 章 / 节等结构节点，`characters` 为该子树正文口径字数 |

## 词表检查 `checkWordList`

```ts
import { checkWordList } from '@bibliotype/core';

const matches = checkWordList(document, [
  { term: '即使', suggestion: '既使', kind: 'typo' },
  { term: '敏感词', kind: 'sensitive' },
], {
  caseSensitive: false, // 默认 false
  contextLength: 10,    // 摘录半径（默认 10）
  notes: true,          // 是否检查注释（默认 true）
});

matches[0]?.anchor;   // { type: 'text', nodeId, offset, length } —— 可直接建批注 / 高亮
matches[0]?.excerpt;  // 「……即使……」上下文摘录
```

- 只在**文本块内部**做字面匹配，不跨块、不跨行内节点；
- 命中结果按文档先序返回，同一块内多次命中全部返回；
- 词表由调用方提供，语义（错别字 / 敏感词 / 术语）通过 `kind` 原样回传，库内不做内置词库；
- 返回的 `anchor` 与 [23 锚点](23-ir-validation-and-migration.md) 同一契约，可直接交给 `@bibliotype/annotation` 建高亮 / 批注，或用于「跳到下一处」。

## 与写作辅助的边界

`countDocumentStats` 只回答「多少字、多久读完、哪一章最长」；术语一致性、错别字修正策略、批量替换交互属于上层：编辑器侧用 `findTextMatches` / `replaceAll`（见 [02 编辑器与插件](02-editor-and-plugins.md)），标注侧用脚注锚点落批注。
