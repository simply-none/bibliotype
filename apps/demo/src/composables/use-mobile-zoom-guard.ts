/**
 * 触屏缩放守卫：预览区以外禁止双指放大
 *
 * viewport 故意不锁 `user-scalable` / `maximum-scale`（保留阅读区的无障碍缩放），
 * 代价是 H5 上在菜单 / 设置 / 抽屉里捏合也会整页放大：浮层被顶出可视区，退出又缩不
 * 回去。本守卫不改 viewport，只按命中区域分流：
 * - 触点落在预览区（`.app__stage`，阅读区与编辑画布共用）内：不拦截，交给阅读器自身
 *   的双指手势（调字号）与浏览器原生缩放；
 * - 触点落在预览区外：拦截多指 `touchstart` / `touchmove` 与 Safari 私有
 *   `gesturestart`（iOS 上仅拦 touchmove 拦不住整页缩放）。
 *
 * 双击缩放在样式侧一次性关掉（`body { touch-action: manipulation }`，见 styles/base.css），
 * 本模块只管双指。仅在触屏启用（H5 单列骨架或粗指针）；桌面捏合走 `wheel` 的 ctrl 分支，
 * 不经过这里。
 *
 * `preventDefault` 必须挂非 passive 监听，故注册 / 清理统一由 App.vue 的挂载钩子负责，
 * 本模块只返回处理器（与 `useAppLifecycle` 同构）。
 */
import type { Ref } from 'vue';

export interface MobileZoomGuardDeps {
  /** 是否启用守卫（H5 单列骨架或粗指针） */
  enabled: Ref<boolean>;
  /** 预览区元素；null（尚未挂载）按「区外」处理 */
  stage: Ref<HTMLElement | null>;
}

/** 触点是否落在预览区内（含预览区自身） */
function insideStage(stage: HTMLElement | null, target: EventTarget | null): boolean {
  if (stage === null || target === null) return false;
  return target instanceof Node && stage.contains(target);
}

/** 触屏缩放守卫处理器 */
export function useMobileZoomGuard(deps: MobileZoomGuardDeps): {
  onTouchStart: (event: TouchEvent) => void;
  onTouchMove: (event: TouchEvent) => void;
  onGestureStart: (event: Event) => void;
} {
  /** 该次手势是否放行（未启用，或触点落在预览区内） */
  function allowsZoom(target: EventTarget | null): boolean {
    return !deps.enabled.value || insideStage(deps.stage.value, target);
  }

  /** 双指按下：区外立即拦截，避免浏览器先进入缩放态再拦不住 */
  function onTouchStart(event: TouchEvent): void {
    if (event.touches.length < 2 || allowsZoom(event.target)) return;
    event.preventDefault();
  }

  /** 双指移动：区外持续拦截（部分浏览器只在移动阶段才真正缩放） */
  function onTouchMove(event: TouchEvent): void {
    if (event.touches.length < 2 || allowsZoom(event.target)) return;
    event.preventDefault();
  }

  /** Safari 私有手势事件：iOS 上整页缩放由它驱动，必须单独拦 */
  function onGestureStart(event: Event): void {
    if (allowsZoom(event.target)) return;
    event.preventDefault();
  }

  return { onTouchStart, onTouchMove, onGestureStart };
}
