/**
 * 减少动态效果探测（D5）
 *
 * 封装 `matchMedia('(prefers-reduced-motion: reduce)')`，用于翻页动效 / 骨架
 * 淡入的降级决策。无 `window` / `matchMedia`（SSR、happy-dom 未实现）时回落
 * `false`，不抛错、不读 `window` 顶层——首次访问放到 `onMounted` 之后即可。
 */
import { onScopeDispose, ref, type Ref } from 'vue';

/** usePrefersReducedMotion 选项 */
export interface UsePrefersReducedMotionOptions {
  /** 自定义媒体查询（缺省 `(prefers-reduced-motion: reduce)`） */
  query?: string;
  /**
   * 注入的 `matchMedia`（缺省全局 `window.matchMedia`）
   *
   * 测试可传 stub；省略且运行期无 `matchMedia` 时直接回落 `false`。
   */
  matchMedia?: (query: string) => MediaQueryList;
}

/**
 * 返回是否开启「减少动态效果」
 *
 * 返回的 ref 在媒体查询结果变化时自动同步；组件作用域销毁时移除监听。
 * 非浏览器环境（SSR / happy-dom）一律返回 `false`。
 */
export function usePrefersReducedMotion(
  options: UsePrefersReducedMotionOptions = {},
): Readonly<Ref<boolean>> {
  const query = options.query ?? '(prefers-reduced-motion: reduce)';
  const reduced = ref(false);

  let mql: MediaQueryList | undefined;
  let listener: ((event: MediaQueryListEvent) => void) | undefined;

  const getMatchMedia = (): ((q: string) => MediaQueryList) | undefined => {
    if (options.matchMedia !== undefined) return options.matchMedia;
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      return (q: string) => window.matchMedia(q);
    }
    return undefined;
  };

  const mm = getMatchMedia();
  if (mm !== undefined) {
    mql = mm(query);
    reduced.value = mql.matches;
    listener = (event: MediaQueryListEvent) => {
      reduced.value = event.matches;
    };
    // Safari < 14 用 addListener；现代浏览器用 addEventListener
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', listener);
    } else if (typeof (mql as unknown as { addListener?: unknown }).addListener === 'function') {
      (mql as unknown as { addListener: (cb: typeof listener) => void }).addListener(listener);
    }
  }

  onScopeDispose(() => {
    if (mql !== undefined && listener !== undefined) {
      if (typeof mql.removeEventListener === 'function') {
        mql.removeEventListener('change', listener);
      } else if (typeof (mql as unknown as { removeListener?: unknown }).removeListener === 'function') {
        (mql as unknown as { removeListener: (cb: typeof listener) => void }).removeListener(listener);
      }
    }
  });

  return reduced;
}
