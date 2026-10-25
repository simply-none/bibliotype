/**
 * 阅读形态三态循环
 *
 * 回归口径：
 * 1. `flowSupported` 只反映版式能力，与当前 viewMode 无关——单页态下也必须为 true，
 *    否则「单页 / 连续滚动」切换按钮会被误禁用（点击无效）；
 * 2. 横排循环为 单页 → 连续滚动 → 流式阅读 → 单页；
 * 3. 直排 / 仿真版式跳过流式，单页 ↔ 连续滚动，且流式态回落单页。
 */
import { computed, ref } from 'vue';
import { describe, expect, it } from 'vitest';
import { useViewMode } from '../composables/use-view-mode.js';

function setup(options: { vertical?: boolean; facsimile?: boolean } = {}) {
  const viewMode = ref<'page' | 'scroll' | 'scroll-flow'>('page');
  const verticalRail = computed(() => options.vertical === true);
  const facsimilePreset = computed<unknown>(() =>
    options.facsimile ? { id: 'siku' } : undefined,
  );
  return { viewMode, ...useViewMode({ viewMode, verticalRail, facsimilePreset }) };
}

describe('阅读形态切换', () => {
  it('横排：单页态可切换，循环 单页 → 连续滚动 → 流式 → 单页', () => {
    const { viewMode, flowSupported, cycleViewMode } = setup();
    expect(flowSupported.value).toBe(true);
    cycleViewMode();
    expect(viewMode.value).toBe('scroll');
    cycleViewMode();
    expect(viewMode.value).toBe('scroll-flow');
    cycleViewMode();
    expect(viewMode.value).toBe('page');
  });

  it('直排：跳过流式，单页 ↔ 连续滚动', () => {
    const { viewMode, flowSupported, cycleViewMode } = setup({ vertical: true });
    expect(flowSupported.value).toBe(false);
    cycleViewMode();
    expect(viewMode.value).toBe('scroll');
    cycleViewMode();
    expect(viewMode.value).toBe('page');
  });

  it('直排 / 仿真下流式态回落单页', () => {
    const { viewMode, effectiveViewMode } = setup({ vertical: true, facsimile: true });
    viewMode.value = 'scroll-flow';
    expect(effectiveViewMode.value).toBe('page');
  });
});
