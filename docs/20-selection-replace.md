# 20 编辑态「选区替换为」

> 涉及包：`@bibliotype/editor`（命令内核）、`@bibliotype/classical`（古籍容器封装）、
> `@bibliotype/vue`（浮动菜单）、`apps/demo`（目标注册表与工具条整合）
> 相关：[19 编辑工具条使用说明](19-editor-toolbar-usage.md) · [02 编辑器与插件](02-editor-and-plugins.md) · [03 古籍排版](03-classical-layout.md) · [06 Vue 集成](06-vue-integration.md) · [14 FAQ](14-faq.md)

选中一段文字后，在选区旁弹出标题为 **【替换为】** 的浮动菜单：点「双行注」等目标，
**选中的文字会被搬进目标容器**，而不是在段后新建一个空容器。本文说明交互、目标类型、
文本前后优化规则与 API。

---

## 一、语义分工：替换为 vs 插入空容器

编辑态有两条容易混淆的路径，现在明确分开：

| 路径 | 入口 | 是否消费选区 | 落点 | 典型命令 |
| --- | --- | --- | --- | --- |
| **替换为** | 选中文字后自动弹出的浮动菜单 | **是**：选中文字进入目标节点 | 选区所在位置 | `replaceSelectionWithContainer` / `replaceWithDoubleNote` 等 |
| **插入空容器（段后）** | 工具条第三行 | 否：选区保持不动 | 当前叶块之后 | `insertBlockAfterSelection` / `insertDoubleNote` 等 |
| **光标处原子插入** | 工具条「出校符号 / 印章 / 图片」 | 是：按原语义替换选区（会丢文字） | 光标处 | `insertAtomicNode` |

- 工具条第三行已加可见标签 **「插入空容器（段后）」**，并注明「不消费选区；选中文字请用『替换为』」。
- 原子插入（出校符号 / 印章 / 图片）在**非空选区**下会先弹确认框，避免像旧版那样静默吃掉选中文字。
- 空选区时 `replaceSelectionWithContainer` 默认退化为「段后插入空容器」（`insertWhenEmpty: false` 可关闭），保持旧插入行为。

---

## 二、交互

| 项 | 规则 |
| --- | --- |
| 触发 | 编辑器可编辑 + 文本选区非空时，去抖 **120ms** 自动弹出；只读 / 空选区 / 原子节点选区（图片等）/ 编辑器失焦时不弹 |
| 标题 | 固定 **「替换为」**，下方按「块类型 / 块级容器 / 行内容器」分组 |
| 定位 | 优先取 `window.getSelection()` 的可见选区矩形（连续画布与 paged 画布通用）；取不到时回退 `view.coordsAtPos()`；默认在选区上方，空间不足翻到下方，水平夹紧视口 |
| 不抢焦点 | 菜单根与菜单项均 `@mousedown.prevent`，点击时选区不塌陷 |
| 关闭 | `Esc` / 点击菜单外 / 选区塌陷 / 执行任一命令后；关闭后同一选区不再自动弹，选区变化后重置 |
| 直排 | 定位只用视口坐标，横排 / 直排同一套逻辑；菜单 `max-height` 滚动、按钮自动换行 |
| paged | 必须把 **BtEditor 插槽的 `slotBinding`** 传给菜单；其 `execute` 已包「先 flush 选区 → 执行 → 重排后还原光标」 |
| 只读 | `readonly=true` 时永不显示；工具条只读开关联动 |

---

## 三、目标类型

内容表达式以 `packages/classical/src/editor-specs.ts` 与 `packages/editor/src/core-node-specs.ts` 为准。

| 分组 | 目标 | 节点名 | 内容 | 选区要求 |
| --- | --- | --- | --- | --- |
| 块类型 | 正文 / H1 / H2 / H3 | `paragraph` / `heading` | `inline*` | 任意，整块生效 |
| 块类型 | 引用 | `quote` | `block+` | 整块或跨块 |
| 块类型 | 无序 / 有序 | `list` / `list-item` | `list_item+` / `block+` | 整块或跨块 |
| 块级容器 | 双行注 | `double-note` | `block+` | 同一父容器（同一章节） |
| 块级容器 | 眉批 / 跋文 / 校勘记 | `head-note` / `tail-note` / `collation-note` | `block+` | 同上 |
| 块级容器 | 牌记 / 题记 / 版框 | `imprint` / `colophon` / `border-frame` | `block+` | 同上 |
| 块级容器 | 脚注 / 尾注 / 边注 | `footnote` / `endnote` / `margin-note` | `block+` | 同上 |
| 行内容器 | 夹注 | `inline-note` | `inline*` | **同段** |
| 行内容器 | 异体字 / 避讳字 | `variant-char` / `taboo-char` | `inline*` | **同段** |

不纳入 v1：鱼尾 / 印章 / 出校符号 / 图片（原子节点会丢弃文字，不属于「转换」）；表格（语义不清）。

---

## 四、文本前后优化规则

设选区 `[from, to)`，目标块容器 `C`（`block+`）。所有操作在**一个 transaction** 内完成，
一次 `Mod-Z` 整体还原。

### 4.1 同一段落内

```text
原： [ A 前文 ][ S 选中 ][ B 后文 ]
后： <p>A 前文</p>  <C><p>S 选中</p></C>  <p>B 后文</p>
```

1. 按 `from` / `to` 切三段：`A`（段首→from）、`S`（from→to）、`B`（to→段尾）。
2. `S` 进入 `C`，保留行内标记（粗体 / 专名号等）与 `rawAttrs`。
3. `A` / `B` 非空 → 保留为独立段落；仅空白 / 无内容 → 删除（`dropEmptyFragments: false` 可保留）。
4. **整段选中**（`A`、`B` 都为空）→ 原段整体搬入 `C`，外层不留空段。
5. 删除空段导致父容器没有块 → 自动补一个空段落，保证仍可编辑。

### 4.2 跨多个同级段落

```text
原： [P1 前文|选中后半] [P2 整段] [P3 选中前半|后文]
后： <p>P1 前文</p>  <C><p>P1 选中后半</p><p>P2 整段</p><p>P3 选中前半</p></C>  <p>P3 后文</p>
```

1. 首块取 `[from → 块尾]`，尾块取 `[块首 → to]`，中间整块全部进入 `C`。
2. 首块剩余 `[块首 → from]`、尾块剩余 `[to → 块尾]` 作为前后段落保留（空则删）。
3. 选区必须落在**同一父容器的连续块**上；跨章节 / 跨结构容器直接返回 `false`，不产生半成品事务。

### 4.3 空白与标点

- 不擅自改标点、不自动加注号（`noteRef`）；内容保真优先。
- 选区首尾的纯空白不进入容器（留在外层或随空段删除），避免容器首尾空行。
- 不自动合并相邻同类型容器（后续可做可选开关）。

### 4.4 id 与 `rawAttrs`

> `tr.split` 会把原块 attrs 复制到拆分出的两半，直接拆会产生**重复 id**。本实现改为手工切
> `Fragment`，从根上避免，并在事务内做唯一性兜底。

- 原 textblock 的 `id` 保留给**文档序第一个存留片段**（`idOwner: 'first-surviving'`，默认）：
  - 有 `A` → `A` 保留原 id；无 `A`、有 `S` → 容器内段落保留；无 `A`、无 `S` → `B` 保留。
  - 跨段时每个被拆分块各自按上述规则保留；中间整块保留自己的 id。
- 其余拆分片段 `id: null`；新建容器 `id: null`（路径 id 兜底）。
- `rawAttrs` 原样保留；容器不继承原块的 `rawAttrs`。
- `idOwner: 'inner'` 可强制容器内段落保留 id；`'none'` 清空所有被搬移块的 id。

### 4.5 文本块规范化

容器内文本块默认**规范化为段落**（`normalizeTextblocks: true`）：标题被搬进注文时只保留行内内容，
不带标题样式 / 分页语义；`id` 与 `rawAttrs` 保留。列表 / 表格等非文本块原样保留。
`normalizeTextblocks: false` 可保留原块类型。

---

## 五、API

### 5.1 命令内核（`@bibliotype/editor`）

```ts
import { replaceSelectionWithContainer } from '@bibliotype/editor';

const command = replaceSelectionWithContainer('double-note', undefined, {
  dropEmptyFragments: true,   // 默认 true
  idOwner: 'first-surviving', // 默认
  insertWhenEmpty: true,      // 默认：空选区退化为段后插入空容器
  normalizeTextblocks: true,  // 默认：容器内文本块规范化为段落
});
command(editorState, (tr) => editor.dispatch(tr)); // => boolean
```

- 行内目标（`inline*`）委托 `insertInlineNodeWrapping`，仅同段选区。
- schema 未注册 / 目标非容器 / 内容表达式不兼容 / 跨父容器 → `false`，文档不变。

### 5.2 古籍封装（`@bibliotype/classical/editor`）

`replaceWithDoubleNote()` · `replaceWithHeadNote()` · `replaceWithTailNote()` ·
`replaceWithCollationNote()` · `replaceWithImprint()` · `replaceWithColophon()` ·
`replaceWithBorderFrame()`。

### 5.3 浮动菜单（`@bibliotype/vue`）

```vue
<script setup lang="ts">
import { BtSelectionReplaceMenu, type ReplaceTargetGroup } from '@bibliotype/vue';
import { REPLACE_TARGET_GROUPS } from './components/replace-targets.js';
</script>

<template>
  <BtEditor :editor="editor">
    <template #default="binding">
      <EditorToolbar :binding="binding" />
      <BtSelectionReplaceMenu :binding="binding" :groups="REPLACE_TARGET_GROUPS" />
    </template>
  </BtEditor>
</template>
```

| Props | 说明 |
| --- | --- |
| `binding` | 必填；**传插槽 `slotBinding`**（paged 感知） |
| `groups` | 必填；`ReplaceTargetGroup[]`（`label` + `items`） |
| `readonly?` | 只读时永不显示（默认 `false`） |
| `autoShow?` | 选区变化时自动弹出（默认 `true`） |

`ReplaceTargetItem`：`{ key, label, command: () => Command, disabled?(binding), active?(binding), hint? }`。

组合式与定位工具：

- `useSelectionReplace(binding, { autoShow?, readonly?, showDelay? })` → `{ visible, anchor, close, refresh }`；
- `placeFloating(anchor, menu, viewport, gap = 8, edge = 8)` → `{ top, left, placement }`（纯函数，可单测）。

目标注册表放在 `apps/demo/src/components/replace-targets.ts`：它同时引用 `editor` 与
`classical/editor`，而 `editor` 不能反向依赖 `classical`。

---

## 六、边界与降级

| 情况 | 行为 |
| --- | --- |
| schema 未注册目标 | 命令 `false`；弹窗不展示该项 |
| 目标内容表达式不接受块 | `false`；不产生半成品 |
| 跨父容器 / 跨章节选区 | `false`；弹窗内该项置灰并提示「需在同一章节内选择」 |
| 行内容器 + 跨段选区 | `false`；置灰并提示「仅同段选区」 |
| 选区仅空白 | 容器内给空段落 |
| 删除空段导致父容器无块 | 补空段落 |
| paged 态用了原始 `binding.execute` | 光标可能丢失；必须用插槽 `slotBinding` |
| 点击菜单时选区塌陷 | 菜单项 `mousedown.prevent` 已规避 |

---

## 七、测试

- `packages/editor/src/__tests__/selection-convert.test.ts`：段中 / 段首 / 整段 / 跨段、id 唯一、
  标记保留、跨父容器拒绝、空选区退化、文本块规范化、空白清理、一次撤销。
- `packages/classical/src/__tests__/editor-commands.test.ts`：古籍容器替换封装。
- `packages/vue/src/__tests__/selection-replace.test.ts`：`placeFloating` 翻转 / 夹紧、菜单显隐、
  点击执行并关闭、禁用态、`Esc`、只读、空选区。

验证限制：菜单真实位置、直排窄屏换行、paged 片段焦点依赖真实布局，需在 demo 浏览器手工确认；
happy-dom 覆盖显隐 / 命令执行 / 纯函数定位。

---

## 相关

- 工具条按钮语义与「点了没反应」速查：[19](19-editor-toolbar-usage.md)
- 编辑命令与 IR ⇄ PM：[02](02-editor-and-plugins.md)
- 古籍节点与容器：[03](03-classical-layout.md)
- 组件与插槽 binding：[06](06-vue-integration.md)
- paged 命令 / 光标还原：[14 第 10 条](14-faq.md)
