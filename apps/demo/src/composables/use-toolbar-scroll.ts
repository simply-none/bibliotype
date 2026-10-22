/**
 * 工具栏鼠标交互（横向滚动 + 按住拖动）
 *
 * 顶栏按钮区在溢出时：纵向滚轮转横向滚动；鼠标 / 触控笔 / 触摸按住可拖动横滚。
 * 拖动后抑制一次点击（捕获阶段拦截），避免位移松手误触按钮。逻辑与组件无关，
 * 只依赖被操作容器 ref，故可被 EditorToolbar 等复用（禁止复制粘贴）。
 *
 * 「纵向转横向」的施力部分单独导出 `wheelScrollX`：编辑工具条是三个各自溢出的行容器，
 * 必须按 `event.currentTarget` 逐行接管，不能共用这里那个单一容器 ref，但折算规则同源。
 */
import { ref, type Ref } from 'vue';

/** 拖动阈值（px）：超过才视为拖动，避免误伤按钮点击 */
const DRAG_THRESHOLD = 5;

/** `deltaMode` 为「行」时每行的折算像素（约一行行高） */
const LINE_PIXELS = 16;

/**
 * 把纵向滚量施加为所在容器的横向滚动
 *
 * 只做「接管事件 + deltaMode 折算 + 施力」，不判溢出与手势主轴：各容器的阈值与让位
 * 条件不同（顶栏是 `scrollWidth <= clientWidth`，编辑工具条每行还留 1px 容差），
 * 故由调用方先行守卫再调用。`deltaMode` 为「行」时（少数桌面环境）按约一行 16px 折算。
 */
export function wheelScrollX(el: HTMLElement, event: WheelEvent): void {
  const delta =
    event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * LINE_PIXELS : event.deltaY;
  event.preventDefault();
  el.scrollLeft += delta;
}

/** 工具栏横向滚动交互（挂载容器 ref，返回事件处理与清理） */
export function useToolbarScroll(): {
  toolbarActionsRef: Ref<HTMLElement | null>;
  onToolbarWheel: (event: WheelEvent) => void;
  onToolbarPointerDown: (event: PointerEvent) => void;
  onToolbarClickCapture: (event: MouseEvent) => void;
  removeToolbarDragListeners: () => void;
} {
  /** 工具栏按钮区（横向滚动容器） */
  const toolbarActionsRef = ref<HTMLElement | null>(null);

  /** 纵向滚轮转横向滚动：无溢出、或横向手势（deltaX 主导）时不拦截 */
  function onToolbarWheel(event: WheelEvent): void {
    const el = toolbarActionsRef.value;
    if (el === null || el.scrollWidth <= el.clientWidth) return;
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    wheelScrollX(el, event);
  }

  /** 按住拖动状态（指针事件：鼠标 / 触控笔 / 触摸通用） */
  let drag: { pointerId: number; startX: number; startLeft: number; moved: boolean } | null = null;

  /** 拖动结束后的首次点击抑制标记 */
  let suppressClick = false;

  function removeToolbarDragListeners(): void {
    window.removeEventListener('pointermove', onWindowPointerMove);
    window.removeEventListener('pointerup', onWindowPointerUp);
    window.removeEventListener('pointercancel', onWindowPointerUp);
  }

  function endToolbarDrag(pointerId: number): void {
    if (drag === null || drag.pointerId !== pointerId) return;
    const moved = drag.moved;
    drag = null;
    toolbarActionsRef.value?.classList.remove('toolbar__actions--dragging');
    removeToolbarDragListeners();
    if (moved) suppressClick = true;
  }

  function onWindowPointerMove(event: PointerEvent): void {
    const el = toolbarActionsRef.value;
    if (drag === null || el === null || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startX;
    if (!drag.moved) {
      if (Math.abs(dx) < DRAG_THRESHOLD) return;
      drag.moved = true;
      el.classList.add('toolbar__actions--dragging');
    }
    el.scrollLeft = drag.startLeft - dx;
  }

  function onWindowPointerUp(event: PointerEvent): void {
    endToolbarDrag(event.pointerId);
  }

  /** 按下：记录起点（仅左键、存在横向溢出且不在滚动条区域时进入拖动候选） */
  function onToolbarPointerDown(event: PointerEvent): void {
    suppressClick = false;
    const el = toolbarActionsRef.value;
    if (el === null || event.button !== 0 || el.scrollWidth <= el.clientWidth) return;
    if (event.clientY >= el.getBoundingClientRect().top + el.clientHeight) return;
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startLeft: el.scrollLeft,
      moved: false,
    };
    window.addEventListener('pointermove', onWindowPointerMove);
    window.addEventListener('pointerup', onWindowPointerUp);
    window.addEventListener('pointercancel', onWindowPointerUp);
  }

  /** 拖动后抑制一次点击（捕获阶段拦截，防位移松手误触按钮） */
  function onToolbarClickCapture(event: MouseEvent): void {
    if (!suppressClick) return;
    suppressClick = false;
    event.stopPropagation();
    event.preventDefault();
  }

  return {
    toolbarActionsRef,
    onToolbarWheel,
    onToolbarPointerDown,
    onToolbarClickCapture,
    removeToolbarDragListeners,
  };
}
