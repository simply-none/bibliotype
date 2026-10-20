---
"@bibliotype/core": minor
---

新增文档统计与词表检查：`countDocumentStats`（正文字数、注释字数、词数、阅读时长、叶块数、结构节点字数分布，支持注释单独 / 计入 / 忽略与标点口径）、`checkWordList`（按调用方词表做错别字 / 敏感词 / 术语检查，返回块内偏移、摘录与文本锚点）；配套导出 `DEFAULT_READING_CHARS_PER_MINUTE`、`isStructureNode`、`structureLevelOf` 与相关类型。
