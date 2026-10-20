---
"@bibliotype/editor": minor
---

新增 Markdown 快捷输入（input rules）：块首输入 `# ` / `> ` / `- ` / `1. ` / ` ```ts ` / `---` 即转换为标题、引用、列表、代码块与分隔符（保留块 `id`，分隔符位于末块时自动补空段落承接光标）；`createInputRulesPlugin` 以 `appendTransaction` 实现，无 `EditorView` 的 `BookEditor` 同样生效，并支持按种类关闭（`headings` / `quote` / `lists` / `codeBlock` / `horizontalRule`）；同时导出纯函数 `matchInputRule` / `applyInputRules` 与 `INPUT_RULE_KINDS` 等类型，默认插件集 `createBookEditorPlugins` 纳入该插件。
