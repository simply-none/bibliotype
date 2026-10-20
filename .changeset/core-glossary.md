---
"@bibliotype/core": minor
---

新增术语一致性比对：`checkGlossary(document, glossary, options?)` 按「规范写法 + 异写」分组统计——返回全部异写命中（含 `nodeId` / `offset` / 文本锚点 / `suggestion`）、逐术语的规范用量与异写用量、是否已统一 / 全文未出现；`validateGlossary(glossary)` 校验表本身（空写法 / 重复定义 / 异写等于规范写法）。匹配口径复用 `checkWordList`（文本块内字面匹配，默认含注释）。
