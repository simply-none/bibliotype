---
"@bibliotype/exporter-epub": minor
---

新增尾注聚合：`groupEndnotes(root, { scope, title?, id? })` 与导出选项 `endnoteGrouping: 'keep' | 'chapter' | 'book'`、`endnoteTitle`。

- `chapter`：每章末尾追回「注释」标题行 + 该章尾注（嵌在节内的尾注上提到所属章，无章可归的兜底排到书末）；
- `book`：全部尾注集中到书末新增一章（id 缺省 `endnotes`，冲突自动追加 `-2`）；
- 导出期深拷贝重排，不改动原文档；节点 id 不变，正文 `noteref` 链接照旧可跳；
- 只处理 `endnote`，脚注与边注保持就地。
