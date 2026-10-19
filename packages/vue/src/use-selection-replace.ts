/**
 * 选区「替换为」浮动菜单的状态与定位
 *
 * - 只在「编辑器可编辑 + TextSelection 非空」时显示；空选区 / 只读 / 原子节点选区隐藏；
 * - 定位优先取浏览器可见选区矩形（`window.getSelection()`），因此连续画布与 paged
 *   画布（PM 视图隐藏、真实文字在 PagedCanvas 片段里）都能拿到正确坐标；
 *   拿不到 DOM 选区时回退 `view.coordsAtPos()`；
 * - 去抖 120ms，避免拖选过程中菜单抖动；
 * - 滚动 / 窗口尺寸 / 编辑器事务版本变化时重算；
 * - `close()` 为手动关闭：同一选区不再自动弹出，选区变化后重置。
 */
import { onScopeDispose, ref, watch, type Ref } from 'vue';
import type { Command } from 'prosemirror-state';
import type { EditorBinding } from './use-editor.js';
import type { FloatingRect } from './floating-position.js';

/** 「替换为」单个目标 */
export interface ReplaceTargetItem {
  /** 唯一键（测试 / 埋点用） */
  key: string;
  /** 按钮文字 */
  label: string;
  /** 命令工厂（点击时经 binding.execute 执行） */
  command: () => Command;
  /** 是否禁用（入参为当前 binding，便于判断选区是否同段等） */
  disabled?: (binding: EditorBinding) => boolean;
  /** 当前块是否已是该类型（按钮激活态） */
  active?: (binding: EditorBinding) => boolean;
  /** 悬浮说明 / 禁用原因 */
  hint?: string;
}

/** 「替换为」分组 */
export interface ReplaceTargetGroup {
  key: string;
  label: string;
  items: readonly ReplaceTargetItem[];
}

/** 组合式选项 */
export interface UseSelectionReplaceOptions {
  /** 选区变化时是否自动弹出（默认 true） */
  autoShow?: boolean;
  /** 是否只读（只读时永不显示） */
  readonly?: () => boolean;
  /** 弹出延迟（ms，默认 120） */
  showDelay?: number;
}

/** 组合式返回 */
export interface SelectionReplaceState {
  /** 是否显示 */
  visible: Ref<boolean>;
  /** 选区矩形（视口坐标） */
  anchor: Ref<FloatingRect | null>;
  /** 手动关闭（同一选区不再自动弹出） */
  close: () => void;
  /** 立即重算（测试 / 外部触发） */
  refresh: () => void;
}

const DEFAULT_DELAY = 120;

/**
 * 当前文本选区签名；非文本块选区 / 空选区返回 null
 *
 * 用结构判定（`empty` + `$from.parent.isTextblock`）而非 `instanceof TextSelection`：
 * 跨包 / 跨模块实例时 `instanceof` 可能因 prosemirror-state 被重复解析而失效，
 * 表现为「明明选中了文字，菜单却不弹」。
 */
function selectionSignature(binding: EditorBinding): string | null {
  const selection = binding.editor.editorState.selection;
  if (selection.empty || !selection.$from.parent.isTextblock) {
    return null;
  }
  return `${selection.from}:${selection.to}`;
}

/** 编辑器根元素（连续画布与 paged 画布都在 .bt-editor 内） */
function editorRootOf(binding: EditorBinding): HTMLElement | null {
  const dom = binding.view.value?.dom ?? null;
  if (dom === null) {
    return null;
  }
  return (dom.closest('.bt-editor') as HTMLElement | null) ?? dom;
}

/** 浏览器可见选区矩形（连续 / paged 通用） */
function domSelectionRect(binding: EditorBinding): FloatingRect | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const selection = window.getSelection();
  if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }
  const range = selection.getRangeAt(0);
  const root = editorRootOf(binding);
  if (root !== null && !root.contains(range.commonAncestorContainer)) {
    return null;
  }
  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    return null;
  }
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}

/** 回退：PM 位置坐标（连续画布） */
function coordsRect(binding: EditorBinding, from: number): FloatingRect | null {
  const view = binding.view.value;
  if (view === null) {
    return null;
  }
  try {
    const coords = view.coordsAtPos(from);
    const height = Math.max(1, coords.bottom - coords.top);
    return { top: coords.top, left: coords.left, width: 1, height };
  } catch {
    return null;
  }
}

/**
 * 绑定编辑器的选区替换菜单状态
 *
 * @param binding BtEditor 插槽透传的 binding（paged 态请传 slotBinding）
 * @param options 自动弹出 / 只读 / 延迟
 */
export function useSelectionReplace(
  binding: EditorBinding,
  options: UseSelectionReplaceOptions = {},
): SelectionReplaceState {
  const visible = ref(false);
  const anchor = ref<FloatingRect | null>(null);
  const autoShow = options.autoShow !== false;
  const delay = options.showDelay ?? DEFAULT_DELAY;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let dismissed = false;
  let lastSignature: string | null = null;

  const isReadonly = (): boolean => options.readonly?.() === true;

  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const hide = (): void => {
    clearTimer();
    visible.value = false;
    anchor.value = null;
  };

  const refresh = (): void => {
    clearTimer();
    if (isReadonly() || !autoShow) {
      hide();
      return;
    }
    const signature = selectionSignature(binding);
    if (signature === null) {
      hide();
      return;
    }
    if (signature !== lastSignature) {
      dismissed = false;
      lastSignature = signature;
    }
    if (dismissed) {
      hide();
      return;
    }
    const selection = binding.editor.editorState.selection;
    const rect = domSelectionRect(binding) ?? coordsRect(binding, selection.from);
    if (rect === null) {
      hide();
      return;
    }
    anchor.value = rect;
    visible.value = true;
  };

  const schedule = (): void => {
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      refresh();
    }, delay);
  };

  const close = (): void => {
    dismissed = true;
    hide();
  };

  if (typeof document !== 'undefined') {
    document.addEventListener('selectionchange', schedule);
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
  }
  const stopVersionWatch = watch(() => binding.version.value, schedule);

  onScopeDispose(() => {
    clearTimer();
    stopVersionWatch();
    if (typeof document !== 'undefined') {
      document.removeEventListener('selectionchange', schedule);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
    }
  });

  // 挂载时若已有选区（如目录跳转后），补一次
  schedule();

  return { visible, anchor, close, refresh };
}
