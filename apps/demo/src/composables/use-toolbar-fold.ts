/**
 * 工具条触屏折叠（H5 UI 改造 B2）
 *
 * 近百个入口平铺在 375px 视口里既挤不进也靠不上悬浮说明，故命中触屏 / 窄屏时
 * 每行只直出高频动作，其余收进行尾「更多」，点开展开为单行横滚。
 *
 * 折叠只改「渲染哪些动作」，不改动作数据本身：`visibleActions` 的返回顺序、
 * `key`（按钮文字）与收起态白名单共同决定 v-for 的复用，二者都必须稳定。
 */
import { computed, ref, type ComputedRef } from 'vue';
import { useBreakpoint } from '@bibliotype/vue';
import type {
  ToolbarAction,
  ToolbarRow,
} from '../components/editor-toolbar/toolbar-action-types.js';

/**
 * 直出按钮白名单
 *
 * 清单要求「加粗 / 标题 / 注音保留为直出」，另把撤销 / 重做列入：
 * 这两枚是纠错入口，藏进「更多」后误操作的恢复代价远高于收益。
 */
export const PINNED_LABELS: ReadonlySet<string> = new Set(['撤销', '重做', 'B', 'H1', '注音']);

/** 行标题（折叠按钮的无障碍名称） */
export const ROW_LABELS: Readonly<Record<string, string>> = {
  doc: '正文与标记',
  classical: '古籍标记',
  insert: '插入',
};

/** 工具条折叠状态与判定 */
export function useToolbarFold(): {
  compactToolbar: ComputedRef<boolean>;
  isRowExpanded: (key: string) => boolean;
  toggleRow: (key: string) => void;
  visibleActions: (row: ToolbarRow) => readonly ToolbarAction[];
  hasFoldedActions: (row: ToolbarRow) => boolean;
} {
  const breakpoint = useBreakpoint();

  /** 紧凑模式：窄屏或粗指针（触屏没有 hover，悬浮说明也不可用） */
  const compactToolbar = computed(
    () => breakpoint.isMobile.value || breakpoint.coarsePointer.value,
  );

  /** 行展开态（按行 key；默认全部收起） */
  const expandedRows = ref<Record<string, boolean>>({});

  /** 某行是否已展开 */
  function isRowExpanded(key: string): boolean {
    return expandedRows.value[key] === true;
  }

  /** 切换某行展开态（换新对象，确保触发依赖收集） */
  function toggleRow(key: string): void {
    expandedRows.value = { ...expandedRows.value, [key]: !isRowExpanded(key) };
  }

  /** 当前应渲染的动作：收起态只留直出按钮 */
  function visibleActions(row: ToolbarRow): readonly ToolbarAction[] {
    if (!compactToolbar.value || isRowExpanded(row.key)) return row.actions;
    return row.actions.filter((action) => PINNED_LABELS.has(action.label));
  }

  /** 该行是否存在被收起的动作（决定是否常驻「更多」按钮） */
  function hasFoldedActions(row: ToolbarRow): boolean {
    return row.actions.some((action) => !PINNED_LABELS.has(action.label));
  }

  return { compactToolbar, isRowExpanded, toggleRow, visibleActions, hasFoldedActions };
}
