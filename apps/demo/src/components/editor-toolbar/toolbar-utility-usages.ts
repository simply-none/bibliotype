/**
 * 右端实用区三个手写按钮的悬浮说明
 *
 * 这三个入口（查找替换 / 只读 / 还原样册）在模板里直接写 —— 它们带 emit 与组件内部
 * 开关状态，不是 `ToolbarAction`，故按按钮文字索引，由模板取用传给 `ToolbarUsageTip`。
 */
import type { ToolbarUsage } from '../toolbar-usage.js';

/** 键 = 按钮文字（与模板中的索引字面量同源，改名两处同步） */
export const UTILITY_USAGES: Readonly<Record<string, ToolbarUsage>> = {
  查找替换: {
    use: '展开编辑画布内的查找替换面板',
    where: '命中处即选中并滚动到视口；替换直接改写文档',
    limit: '作用于 ProseMirror 文档，与阅读态 SearchPanel 的检索结果互不影响',
  },
  只读: {
    use: '切换只读 / 可编辑',
    where: '只读下所有写操作按钮置灰、输入与粘贴被拒，工具条与查找面板仍可展开',
    limit: '只读仅是视图层 editable=false，程序化事务（含自动保存恢复）仍可派发',
  },
  还原样册: {
    use: '把编辑器内容重置为内置样册',
    require: '非只读态可用',
    where: '整篇文档替换，光标回到篇首',
    limit: '丢弃当前修改且不保留撤销栈，执行前请确认已保存',
  },
};
