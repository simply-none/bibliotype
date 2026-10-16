# 项目长期约定（bibliotype）

## 编辑 / 保存链路（性能红线）

- **禁止在逐键路径调用 `BookEditor.getDocument()`**：它是 O(全文档) PM→IR 转换（实测 78 万字
  / 12623 块 ≈ 4.8 ms/次 + 等量对象分配）。高频路径一律用 `getSharedDocument()`（PM 结构共享，
  O(变更子树)，≈ 0.02 ms）。`BookEditor.emitChange()` 已按此口径广播，订阅方拿到的快照
  **视为只读**（未变子树与上次快照同引用），禁止原地修改。
- **整本落盘不得落在输入帧上**：`StorageAdapter.save` 是整本 `put`（结构化克隆 ≈ 文档体积量级，
  1.8 MB ≈ 27 ms）。策略统一用「节流合并 + 空闲时段（`requestIdleCallback`）+ 单飞去重 + 上限兜底」，
  参考实现 `apps/demo/src/composables/use-draft-autosave.ts`。
- **快照与保存基准必须同一同步帧**：取快照后立即 `markSaved()`，再 `await` 写库；否则 await 期间的
  新编辑会被误标「已保存」。写失败要保留脏标记并定时重试。
- **改包源码后 demo 不生效**：demo 从各包 `dist` 消费，须先 `pnpm --filter <pkg> build`。

## 性能排查方式

- 先用最小复现量出数字再改代码。可用脚本骨架：构造 N 段落 IR → `new BookEditor` → 订阅 `onChange`
  → 循环 `dispatch` 计时；对比「无订阅者」基线判断成本归属。
- Node 22 可直接跑 TS 校验脚本：`node --experimental-strip-types <file>.ts`（脚本内相对导入需写
  `.ts` 后缀）。适用于 demo 层（无 vitest）的组合式函数行为验证。

## 量尺与分页

- `extractBlocksIndexed` 的块序列与块 id 只由 IR 结构决定（`blockSizes` / `lineOffsets` / `lineSizes`
  仅影响尺寸字段），故同一文档的结构抽取结果可跨轮复用（`measurePagination` 的 `extracted` 入参）。
