/**
 * 阅读视图模式（D5）：单页翻页 / 连续滚动多页 / 流式阅读
 *
 * 流式阅读在直排 / 仿真版式下不被支持，自动回落单页翻页（与 `BtBookView`
 * 的 flowSupported 口径一致）并提示用户一次。viewMode / pageTransition 源状态
 * 由 App 持有（供界面偏好快照共享），本块只负责派生与三态循环逻辑。
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue';

export interface ViewModeDeps {
  viewMode: Ref<'page' | 'scroll' | 'scroll-flow'>;
  verticalRail: ComputedRef<boolean>;
  facsimilePreset: ComputedRef<unknown>;
}

/** 视图模式派生态与切换动作 */
export function useViewMode(deps: ViewModeDeps) {
  const { viewMode, verticalRail, facsimilePreset } = deps;

  /** 流式阅读回落提示（非空时界面顶部展示一条说明条） */
  const modeFallbackHint = ref('');

  /**
   * 实际生效视图模式：流式阅读在直排 / 仿真版式下不被支持，自动回落单页翻页
   * （与 `BtBookView` 的 `flowSupported` 口径一致），并提示用户。
   */
  const effectiveViewMode = computed<'page' | 'scroll' | 'scroll-flow'>(() => {
    if (viewMode.value !== 'scroll-flow') return viewMode.value;
    if (verticalRail.value || facsimilePreset.value !== undefined) return 'page';
    return 'scroll-flow';
  });

  /** 滚动模式是否支持流式阅读（直排 / 仿真版式下回落分页，与 BtBookView 口径一致） */
  const flowSupported = computed(
    () => viewMode.value === 'scroll-flow' && !verticalRail.value && facsimilePreset.value === undefined,
  );

  /** 视图模式三态循环：page → scroll → scroll-flow → page（不支持的 scroll-flow 自动跳过） */
  function cycleViewMode(): void {
    const order = ['page', 'scroll', 'scroll-flow'] as const;
    const idx = order.indexOf(viewMode.value);
    for (let step = 1; step <= order.length; step += 1) {
      const next = order[(idx + step) % order.length]!;
      if (next === 'scroll-flow' && !flowSupported.value) continue;
      viewMode.value = next;
      return;
    }
    viewMode.value = 'page';
  }

  /** 视图模式展示名 */
  const viewModeLabel = computed(() => {
    if (viewMode.value === 'scroll-flow') return '流式阅读';
    if (viewMode.value === 'scroll') return '连续滚动';
    return '单页翻页';
  });

  /** 流式阅读不被当前版式支持，已回落分页：提示用户一次 */
  function onModeFallback(payload: { reason: string }): void {
    modeFallbackHint.value = payload.reason;
  }

  return { effectiveViewMode, modeFallbackHint, flowSupported, cycleViewMode, viewModeLabel, onModeFallback };
}
