---
"@bibliotype/vue": minor
---

H5 移动端改造（批 A–D）：

- 新增断点体系：`BT_BREAKPOINTS` / `BT_TOUCH_TARGET_MIN` / `resolveBreakpointName` 与
  `useBreakpoint()`（宽度、档位、粗指针、竖屏、`revision` 变更计数），宿主据此切换单列骨架并重排；
- 新增 `useScrollLock()`：模块级共享的计数锁，多层浮层叠加只锁一次，快照并还原 body 内联样式；
- 新增 `BtDrawer`：统一抽屉容器（`side` start / end / bottom、遮罩关闭、Esc、边缘手势呼出、
  `Teleport` + 锁滚），`snapHeights` 提供底部 sheet 拖拽吸附档位；
- `BtBookView`：单页模式下左右边缘 20% 点按翻页、中部 emit `tap-center`，与滑动翻页 / 文本选择互斥；
- `BtNotePreview`：触屏点按切换预览、点外部关闭；`BtSelectionReplaceMenu`：触摸选区重算落点；
  `BtTableSizePicker`：网格触点补到 44px；`BtEditor`：`visualViewport` 软键盘补偿；
- `BtSidebarResizer` 触屏隐藏、`BtSpreadLayout` 窄屏堆叠、`BtBookShelf` 窄屏两列。
