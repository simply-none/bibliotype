/**
 * 开本适配落地「生效层」测试（use-layout-tokens × 舞台实测盒）
 *
 * 守护五条，覆盖用户报的「点了保存不生效」：
 * 1. `fixed`（含旧快照缺省）完全不看舞台——页型始终等于声明的开本；
 * 2. `auto` 把页框铺到舞台实测盒，而面板回显仍是用户声明的开本（不被折算出的
 *    临时页型顶成「自定义」）；
 * 3. `h5` 落 340 页宽 + 单栏，页高仍铺舞台；
 * 4. 窄屏缺省只在用户没选过适配时生效——选过一次「固定」就回到开本尺寸，
 *    不再像旧的 H5 版式预设那样无条件压页宽；
 * 5. 仿真版式任何适配都不覆盖页型（界行几何按固定开本）。
 *
 * `useStyleSettings` 用到 `onBeforeUnmount`，故组合式必须在组件 setup 里起；
 * 适配补丁走「面板改草稿 → applyDraft 保存」的真实链路，同时检验回显与生效层。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, computed, defineComponent, h, ref, type App, type Ref } from 'vue';
import {
  PAGE_SIZES,
  PAGE_SIZE_MODES,
  type LayoutOptions,
  type StageBoxSize,
} from '@bibliotype/layout';
import { useLayoutTokens, type LayoutTokensApi } from '../composables/use-layout-tokens.js';
import {
  FACSIMILE_THEME,
  MODERN_THEME,
  type ThemeConfig,
} from '../composables/use-app-themes.js';

/** 舞台实测盒（桌面常见尺寸：宽 900 / 高 600） */
const STAGE: StageBoxSize = { width: 900, height: 600 };

/** 当前挂载实例（每个用例结束统一卸载） */
let mounted: { app: App; container: HTMLElement } | null = null;

afterEach(() => {
  mounted?.app.unmount();
  mounted?.container.remove();
  mounted = null;
});

/** 起一个版式层实例（主题 / 窄屏壳 / 舞台尺寸 / 布局补丁可按用例注入） */
async function setupTokens(options: {
  theme?: ThemeConfig;
  mobileShell?: boolean;
  stage?: StageBoxSize | null;
  patch?: Partial<LayoutOptions>;
} = {}): Promise<LayoutTokensApi> {
  let api!: LayoutTokensApi;
  const Host = defineComponent({
    setup: () => {
      const stageSize: Ref<StageBoxSize | null> = ref(options.stage ?? null);
      api = useLayoutTokens({
        theme: computed(() => options.theme ?? MODERN_THEME),
        night: ref(false),
        mobileShell: computed(() => options.mobileShell ?? false),
        stageSize,
        scheduleRemeasure: () => undefined,
        persistSnapshot: () => undefined,
      });
      return () => h('div');
    },
  });

  const container = document.createElement('div');
  document.body.appendChild(container);
  const app = createApp(Host);
  app.mount(container);
  mounted = { app, container };

  if (options.patch !== undefined) {
    /* 面板选一项→保存：先进草稿（panelLayout 此刻已可读），再烘焙进源状态 */
    api.styleApi.patchLayout({ ...options.patch });
    await api.styleApi.applyDraft();
  }
  return api;
}

describe('生效层按开本适配折算页型', () => {
  it('固定与缺省：舞台再宽也不动，页型恒等于开本', async () => {
    const fixed = await setupTokens({ stage: STAGE });
    expect(fixed.effectiveLayout.value.pageSize).toBe(MODERN_THEME.layout.pageSize);
    expect(fixed.effectiveLayout.value.pageSize.width).toBe(PAGE_SIZES.A5.width);

    const explicit = await setupTokens({
      stage: STAGE,
      patch: { pageSizeMode: PAGE_SIZE_MODES.FIXED },
    });
    expect(explicit.effectiveLayout.value.pageSize.width).toBe(PAGE_SIZES.A5.width);
  });

  it('auto：页框铺满舞台两轴，面板回显仍按声明的开本', async () => {
    const tokens = await setupTokens({
      stage: STAGE,
      patch: { pageSizeMode: PAGE_SIZE_MODES.AUTO },
    });
    const page = tokens.effectiveLayout.value.pageSize;
    expect(page.width).toBe(STAGE.width);
    expect(page.height).toBe(STAGE.height);
    /* 面板读声明层：开本下拉不该被「·适应版面」顶成自定义 */
    expect(tokens.panelLayout.value.pageSize.width).toBe(PAGE_SIZES.A5.width);
    expect(tokens.panelLayout.value.pageSizeMode).toBe(PAGE_SIZE_MODES.AUTO);
  });

  it('auto：舞台尚未量到时不臆造，回退声明的开本', async () => {
    const tokens = await setupTokens({
      stage: null,
      patch: { pageSizeMode: PAGE_SIZE_MODES.AUTO },
    });
    expect(tokens.effectiveLayout.value.pageSize).toBe(MODERN_THEME.layout.pageSize);
  });

  it('h5：页宽落 340 + 单栏，页高仍铺舞台', async () => {
    const tokens = await setupTokens({
      stage: STAGE,
      patch: { pageSizeMode: PAGE_SIZE_MODES.H5 },
    });
    const layout = tokens.effectiveLayout.value;
    expect(layout.pageSize.width).toBe(340);
    expect(layout.pageSize.height).toBe(STAGE.height);
    expect(layout.columns).toBe(1);
  });

  it('窄屏缺省 h5：用户选过一次就以用户为准（不再无条件压页宽）', async () => {
    const autoH5 = await setupTokens({ mobileShell: true, stage: STAGE });
    expect(autoH5.effectiveLayout.value.pageSize.width).toBe(340);
    expect(autoH5.effectiveLayout.value.columns).toBe(1);
    /* 缺省也落到面板回显，用户看得见「当前是按 H5 取形」 */
    expect(autoH5.panelLayout.value.pageSizeMode).toBe(PAGE_SIZE_MODES.H5);

    const chosen = await setupTokens({
      mobileShell: true,
      stage: STAGE,
      patch: { pageSizeMode: PAGE_SIZE_MODES.FIXED },
    });
    expect(chosen.effectiveLayout.value.pageSize.width).toBe(PAGE_SIZES.A5.width);
    expect(chosen.effectiveLayout.value.columns).toBe(MODERN_THEME.layout.columns);
  });

  it('仿真版式：任何适配都不覆盖页型（版框 / 界行按固定开本）', async () => {
    const tokens = await setupTokens({
      theme: FACSIMILE_THEME,
      stage: STAGE,
      patch: { pageSizeMode: PAGE_SIZE_MODES.AUTO },
    });
    expect(tokens.effectiveLayout.value.pageSize).toBe(FACSIMILE_THEME.layout.pageSize);
  });
});
