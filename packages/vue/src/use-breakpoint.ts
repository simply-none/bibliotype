/**
 * 断点探测组合式（H5 UI 改造 D1）
 *
 * 统一 JS 侧的视口判定：移动 / 平板 / 桌面三档（阈值见 `breakpoints.ts`），
 * 外加粗指针（`pointer: coarse`）与横竖屏。组件与宿主共用同一入口，禁止在
 * 组件内手写宽度魔法数。
 *
 * SSR 口径：初始值固定为桌面（1024×768、细指针、横屏），首次渲染在服务端与
 * 客户端一致，不会产生 hydration mismatch；真实视口在 `onMounted` 后同步，
 * 其后由 resize / orientationchange 与媒体查询变化驱动更新。
 */
import {
  computed,
  onMounted,
  onScopeDispose,
  ref,
  type ComputedRef,
  type Ref,
} from 'vue';
import { BT_BREAKPOINTS, resolveBreakpointName, type BreakpointName } from './breakpoints.js';

/** 视口变化事件来源（测试可注入） */
export interface BreakpointHost {
  /** 视口宽度 */
  innerWidth: number;
  /** 视口高度 */
  innerHeight: number;
  /** 媒体查询（缺省 `window.matchMedia`） */
  matchMedia?: ((query: string) => MediaQueryList) | undefined;
  addEventListener?: ((type: string, listener: () => void) => void) | undefined;
  removeEventListener?: ((type: string, listener: () => void) => void) | undefined;
  /** 帧调度（缺省 rAF；缺失时退化为立即执行） */
  requestAnimationFrame?: ((callback: () => void) => number) | undefined;
  cancelAnimationFrame?: ((handle: number) => void) | undefined;
}

/** useBreakpoint 选项 */
export interface UseBreakpointOptions {
  /** 注入的窗口宿主（测试用；缺省全局 `window`） */
  host?: BreakpointHost;
}

/** useBreakpoint 返回值 */
export interface UseBreakpoint {
  /** 视口宽（px） */
  width: Ref<number>;
  /** 视口高（px） */
  height: Ref<number>;
  /** 断点档位 */
  name: ComputedRef<BreakpointName>;
  /** 移动档（< 768px）：H5 单列骨架 */
  isMobile: ComputedRef<boolean>;
  /** 平板档（768–1023px） */
  isTablet: ComputedRef<boolean>;
  /** 桌面档（≥ 1024px） */
  isDesktop: ComputedRef<boolean>;
  /** 粗指针（触屏）：触摸交互与 44px 触控目标的判定依据 */
  coarsePointer: Ref<boolean>;
  /** 竖屏（`orientation: portrait`） */
  portrait: Ref<boolean>;
  /** 视口变更计数：旋转 / 窗口尺寸变化后自增，宿主据此触发重排（D7） */
  revision: Ref<number>;
}

/** 服务端 / 无 window 环境的固定初值（桌面口径，保证 SSR 与首帧一致） */
const SSR_WIDTH = BT_BREAKPOINTS.lg;
const SSR_HEIGHT = 768;

/** 取默认窗口宿主（无 window 返回 undefined） */
function defaultHost(): BreakpointHost | undefined {
  if (typeof window === 'undefined') return undefined;
  return window as unknown as BreakpointHost;
}

/**
 * 创建断点探测
 *
 * @param options 见 {@link UseBreakpointOptions}
 */
export function useBreakpoint(options: UseBreakpointOptions = {}): UseBreakpoint {
  const host = options.host ?? defaultHost();

  const width = ref<number>(SSR_WIDTH);
  const height = ref<number>(SSR_HEIGHT);
  const coarsePointer = ref(false);
  const portrait = ref(false);
  const revision = ref(0);

  const name = computed(() => resolveBreakpointName(width.value));
  const isMobile = computed(() => name.value === 'mobile');
  const isTablet = computed(() => name.value === 'tablet');
  const isDesktop = computed(() => name.value === 'desktop');

  /** 媒体查询变更监听句柄（卸载时统一摘除） */
  const mediaHandles: Array<() => void> = [];
  let frame: number | undefined;
  let ticking = false;
  /** 首次同步不算「视口变更」：避免挂载瞬间触发宿主重排 */
  let initialized = false;

  /** 读取一次宿主状态（宽高 / 粗指针 / 竖屏） */
  function sync(): void {
    if (host === undefined) return;
    const nextWidth = host.innerWidth;
    const nextHeight = host.innerHeight;
    const sizeChanged = nextWidth !== width.value || nextHeight !== height.value;
    width.value = nextWidth;
    height.value = nextHeight;
    if (sizeChanged && initialized) revision.value += 1;
    initialized = true;
  }

  /** 让出的帧回调：合并同一帧内的多次 resize */
  function scheduleSync(): void {
    if (ticking) return;
    ticking = true;
    const run = (): void => {
      ticking = false;
      frame = undefined;
      sync();
    };
    if (typeof host?.requestAnimationFrame === 'function') {
      frame = host.requestAnimationFrame(run);
    } else {
      run();
    }
  }

  /** 监听一个媒体查询的变化，同步到目标 ref 并纳入清理 */
  function watchMedia(query: string, target: Ref<boolean>, onChange?: () => void): void {
    const matchMedia = host?.matchMedia;
    if (typeof matchMedia !== 'function') return;
    const mql = matchMedia(query);
    target.value = mql.matches;
    const listener = (): void => {
      target.value = mql.matches;
      onChange?.();
    };
    // Safari < 14 只有 addListener；现代浏览器走 addEventListener
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', listener);
      mediaHandles.push(() => mql.removeEventListener('change', listener));
    } else if (typeof (mql as unknown as { addListener?: unknown }).addListener === 'function') {
      const legacy = mql as unknown as { addListener: (cb: () => void) => void; removeListener?: (cb: () => void) => void };
      legacy.addListener(listener);
      mediaHandles.push(() => legacy.removeListener?.(listener));
    }
  }

  onMounted(() => {
    if (host === undefined) return;
    sync();
    watchMedia('(pointer: coarse)', coarsePointer);
    watchMedia('(orientation: portrait)', portrait, () => {
      revision.value += 1;
    });
    host.addEventListener?.('resize', scheduleSync);
    host.addEventListener?.('orientationchange', scheduleSync);
  });

  onScopeDispose(() => {
    host?.removeEventListener?.('resize', scheduleSync);
    host?.removeEventListener?.('orientationchange', scheduleSync);
    if (frame !== undefined) host?.cancelAnimationFrame?.(frame);
    frame = undefined;
    for (const dispose of mediaHandles) dispose();
    mediaHandles.length = 0;
  });

  return { width, height, name, isMobile, isTablet, isDesktop, coarsePointer, portrait, revision };
}
