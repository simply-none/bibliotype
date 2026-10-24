# 注码点击"刷新"修复——文档内锚点跳转

## 根因（两层）
1. **委托盲区**：导入的注码是 link 标记（`a.bt-mark-link[href="#n1"]`），`useNoteInteraction` 只认 noteref / backref / marker → 点击不消费 → 浏览器默认锚点导航 → "刷新"。
2. **源 id 丢失**：parseDOM 不读元素 `id` → 目标注文块无 id → 跨页定位无从解析（`reader.getPageOfNode` 已存在且 O(1)，只差目标块带 id）。

## 改动清单

### 1. `packages/editor/src/schema-registry.ts` — 集中保留源元素 id
- `buildSchema` 处为所有节点 parseDOM 规则包一层 `withSourceIdParsing`：克隆规则（不改动共享 spec），getAttrs 合并 `dom.getAttribute('id')`（已显式返回 id / style 规则字符串 dom / 返回 false 的情形均不动）。
- 效果：新导入的 HTML / docx / EPUB 中 `<a href="#…">` 的目标块（段落 / 列表项 / 标题等）带上源 id，`getPageOfNode` 可定位；顺带修复 bt-* 渲染产物 HTML 往返丢节点 id。spec 未声明 id 属性时 PM 忽略多余键，无需特判。

### 2. `packages/vue/src/use-note-interaction.ts` — onClick 增加文档内锚点分支
- 在既有 noteref / backref / marker 三分支之后新增：`closest(event.target, 'a[href^="#"]')` → stripHash 取目标 id。
- 同页目标（`container.querySelector('[id="…"]')` 命中）→ `preventDefault()` + `activateElement(target)`（复用既有高亮 + scrollIntoView）。
- 跨页目标 → `reader.getPageOfNode(targetId)`（既有 API）命中 → `preventDefault()` + `goToPage(page)` + `afterRender` 补高亮滚动（复用 goToNote 同款机制）。
- 目标解析不到 → **不拦截**（交宿主/浏览器默认），原则：只消费能兑现的跳转。
- reader 零改动；BtBookView / demo 零改动（行为自动生效）。

### 3. 测试
- editor：`<p id="n1">` 解析 → 节点 id 保留；`div.bt-paragraph id="p-1"` 往返 id 不丢（paste-html 测试环境）。
- vue：新测试文件（仿 book-view-tap 的 Reader mock）——跨页锚点：点击 `<a class="bt-mark-link" href="#n1">` 后 `update:page` 跳到目标页；同页锚点：目标元素加 `bt-note_active` 高亮且不翻页。

### 4. 文档与 changeset
- `docs/06` 注释交互小节：新增「文档内锚点链接跳转」说明；`docs/17` 导入篇：源元素 id 保留说明。
- changeset：`@bibliotype/editor` patch（导入保留源 id）+ `@bibliotype/vue` patch（锚点跳转）。注明**存量书需重新导入**（旧数据里源 id 已丢失，无法事后恢复）。

## 验证
- `pnpm build` + `pnpm test` + `pnpm typecheck` 全量。
- demo 手动：重新导入 EPUB → 点击注码 (1)(2)… 跳到注文（跨页翻页 + 高亮），Esc/滚动正常。

## 交付
提交文本：`fix(editor,vue): 导入保留源元素 id + 阅读视图文档内锚点链接跳转，修注码点击"刷新"`