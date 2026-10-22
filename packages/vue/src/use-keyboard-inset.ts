/**
 * 软键盘遮挡高度（visualViewport inset）与光标可见性
 *
 * H5（B1）编辑链路基建：
 * - 遮挡高度 = `innerHeight - visualViewport.height - visualViewport.offsetTop`，
 *   超过阈值才判定为软键盘（地址栏收缩 / 工具条回弹等小幅变化不算）；
 * - 键盘弹出后连续两帧再滚光标（等键盘动画落定），滚动量按光标矩形与可视区
 *   底边的差值累加到容器 `scrollTop`，不动窗口滚动位置；
 * - 键盘收起后把窗口滚动位置还原到弹出前的值（iOS 会留下滚动偏移）；
 * - 无 `window.visualViewport`（桌面 / SSR / happy-dom 缺省）时恒为 0，不产生副作用。
 */
import { computed, onScopeDispose, ref, type ComputedRef, type Ref } from 'vue';

/** 判定软键盘的最小遮挡高度（px）：低于此值视为地址栏 / 视口抖动 */
const DEFAULT_MIN_INSET = 80;
/** 光标与可视区边缘的最小留白（px） */
const DEFAULT_MARGIN = 16;

/** 视口坐标下的光标矩形（只需上下沿） */
export interface CaretRect {
  top: number;
  bottom: number;
}

/** 组合式选项 */
export interface UseKeyboardInsetOptions {
  /** 取当前应滚动的容器（返回 null 时跳过光标定位） */
  scroller: () => HTMLElement | null;
  /** 取光标在视口坐标中的矩形（拿不到返回 null） */
  caretRect?: () => CaretRect | null;
  /** 判定软键盘的最小遮挡高度（px，缺省 80） */
  minInset?: number;
  /** 光标与可视区边缘的留白（px，缺省 16） */
  margin?: number;
}

/** 组合式返回 */
export interface KeyboardInsetState {
  /** 键盘遮挡高度（px，0 表示收起） */
  inset: Ref<number>;
  /** 键盘是否弹出 */
  open: ComputedRef<boolean>;
  /** 立即同步一次（测试 / 宿主手动触发） */
  sync: () => void;
}

/**
 * 取可视视口
 *
 * 旧浏览器 / happy-dom 可能未实现 `visualViewport`，统一在这里做一次存在性收窄。
 */
function visualViewportOf(): VisualViewport | null {
  if (typeof window === 'undefined') return null;
  const host = window as Window & { visualViewport?: VisualViewport };
  return host.visualViewport ?? null;
}

/**
 * 读取当前软键盘遮挡高度
 *
 * @param minInset 判定阈值（px）
 * @returns 遮挡高度（px，未达阈值返回 0）
 */
export function readKeyboardInset(minInset: number = DEFAULT_MIN_INSET): number {
  const viewport = visualViewportOf();
  if (viewport === null || typeof window === 'undefined') return 0;
  const raw = window.innerHeight - viewport.height - viewport.offsetTop;
  return Number.isFinite(raw) && raw > minInset ? Math.round(raw) : 0;
}

/**
 * 绑定软键盘遮挡状态与「光标滚入可视区」
 *
 * @param options 滚动容器 / 光标矩形来源 / 阈值 / 留白
 */
export function useKeyboardInset(options: UseKeyboardInsetOptions): KeyboardInsetState {
  const minInset = options.minInset ?? DEFAULT_MIN_INSET;
  const margin = options.margin ?? DEFAULT_MARGIN;
  const inset = ref(readKeyboardInset(minInset));
  const open = computed(() => inset.value > 0);
  /** 键盘弹出前的窗口滚动位置（收起后复位） */
  let pageScrollBeforeKeyboard = 0;
  /** 待执行的光标定位帧（键盘连续 resize 时只留最后一帧） */
  let rafId = 0;

  const cancelPending = (): void => {
    if (rafId !== 0 && typeof window !== 'undefined') {
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    }
  };

  /**
   * 把光标滚进可视区
   *
   * 只调整容器滚动（`scrollTop +=`），不改窗口滚动；光标已在可视区时不动，
   * 避免输入过程中视口抖动。
   */
  const scrollCaretIntoView = (): void => {
    const scroller = options.scroller();
    const rect = options.caretRect?.() ?? null;
    if (scroller === null || rect === null || typeof window === 'undefined') return;
    const viewport = visualViewportOf();
    const viewTop = viewport === null ? 0 : viewport.offsetTop;
    const viewBottom = viewport === null ? window.innerHeight : viewport.height + viewport.offsetTop;
    if (rect.bottom > viewBottom - margin) {
      scroller.scrollTop += Math.ceil(rect.bottom - (viewBottom - margin));
      return;
    }
    if (rect.top < viewTop + margin) {
      scroller.scrollTop -= Math.ceil(viewTop + margin - rect.top);
    }
  };

  /** 键盘动画约 250ms：连续两帧后再量光标，避免读到中间态 */
  const scheduleCaretIntoView = (): void => {
    if (typeof window === 'undefined') return;
    cancelPending();
    rafId = window.requestAnimationFrame(() => {
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        scrollCaretIntoView();
      });
    });
  };

  const sync = (): void => {
    const next = readKeyboardInset(minInset);
    const previous = inset.value;
    if (next === previous) return;
    if (previous === 0 && next > 0) {
      pageScrollBeforeKeyboard = typeof window === 'undefined' ? 0 : window.scrollY;
    }
    inset.value = next;
    if (next > 0) {
      scheduleCaretIntoView();
      return;
    }
    // 收起：视口复位（底部补偿随 CSS 变量归零，窗口滚动回到弹出前位置）
    cancelPending();
    if (typeof window === 'undefined') return;
    if (Math.abs(window.scrollY - pageScrollBeforeKeyboard) > 1) {
      window.scrollTo({ top: pageScrollBeforeKeyboard });
    }
  };

  const viewport = visualViewportOf();
  if (viewport !== null) {
    viewport.addEventListener('resize', sync);
    // iOS 键盘弹出期间滚动会让 offsetTop 变化，需重新计算遮挡高度
    viewport.addEventListener('scroll', sync);
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', sync);
    window.addEventListener('orientationchange', sync);
  }

  onScopeDispose(() => {
    cancelPending();
    if (viewport !== null) {
      viewport.removeEventListener('resize', sync);
      viewport.removeEventListener('scroll', sync);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', sync);
      window.removeEventListener('orientationchange', sync);
    }
  });

  return { inset, open, sync };
}
