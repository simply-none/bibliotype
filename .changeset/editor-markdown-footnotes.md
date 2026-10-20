---
"@bibliotype/editor": minor
---

Markdown 解析支持脚注语法：引用 `[^label]` 转为正文上标 + `noteref` 标记（`targetId` / `refId`），定义 `[^label]: 注文` 转为紧跟首次引用段落的 `footnote` 块；支持折行定义合并、同一标签多次引用（锚点递增、注文只插一次）、未引用定义落文末、未定义引用保留字面、围栏代码块内不解析。`looksLikeMarkdown` 同步识别脚注特征。
