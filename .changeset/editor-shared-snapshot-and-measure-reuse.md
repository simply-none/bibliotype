---
"@bibliotype/editor": minor
"@bibliotype/vue": patch
---

优化「编辑 → 保存」链路，大文档编辑不再掉帧：

- **`@bibliotype/editor`**：变更广播改用共享 IR 快照（`getSharedDocument()` 口径，O(变更子树)），逐键事务不再做全量 PM→IR 转换——实测 78 万字 / 12623 块文档单次广播 5.0 ms → 0.7 ms（其中全量转换部分 4.8 → 0.02 ms）。**行为收紧**：`onChange` 回调参数为共享只读快照，未变子树与上一次快照复用同一引用，不得原地修改（需独立可变副本时使用 `getDocument()`）。
- **`@bibliotype/vue`**：`measurePagination` 新增可选入参 `extracted`（复用调用方已抽好的块序列与节点索引），`buildPagedLayout` 每轮重排的全树抽块由三次降为两次（78 万字文档省约 6 ms/轮）。
