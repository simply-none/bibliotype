/**
 * 开本适配落地「生效层」测试（use-layout-tokens × 舞台实测盒）
 *
 * 守护五条，覆盖用户报的「点了保存不生效」与「自适应时字体没跟着缩放」：
 * 1. `fixed`（含旧快照缺省）完全不看舞台——页型始终等于声明的开本；
 * 2. `width` / `height` 是 PDF 式视图缩放：页框保持开本（不重排），api 暴露的
 *    `fitScale` = 舞台同名轴 / 开本同名轴（允许 >1，字体随页整体缩放），
 *    而面板回显仍是用户声明的开本；
 * 3. `h5` 才是真实重排：落 340 页宽 + 单栏，页高仍铺舞台，不覆盖倍率；
 * 4. 窄屏缺省只在用户没选过适配时生效——选过一次「固定」就回到开本尺寸，
 *    不再像旧的 H5 版式预设那样无条件压页宽；
 * 5. 仿真版式任何适配都不覆盖页型与倍率（界行几何按固定开本）。
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

describe('生效层按开本适配折算页型与缩放倍率', () => {
  it('固定与缺省：舞台再宽也不动，页型恒等于开本且不覆盖倍率', async () => {
    const fixed = await setupTokens({ stage: STAGE });
    expect(fixed.effectiveLayout.value.pageSize).toBe(MODERN_THEME.layout.pageSize);
    expect(fixed.effectiveLayout.value.pageSize.width).toBe(PAGE_SIZES.A5.width);
    expect(fixed.fitScale.value).toBeUndefined();

    const explicit = await setupTokens({
      stage: STAGE,
      patch: { pageSizeMode: PAGE_SIZE_MODES.FIXED },
    });
    expect(explicit.effectiveLayout.value.pageSize.width).toBe(PAGE_SIZES.A5.width);
    expect(explicit.fitScale.value).toBeUndefined();
  });

  it('自适应宽度：页框不动 + fitScale 按舞台宽/页宽（PDF 适宽，字体跟着缩放）', async () => {
    const tokens = await setupTokens({
      stage: STAGE,
      patch: { pageSizeMode: PAGE_SIZE_MODES.WIDTH },
    });
    const page = tokens.effectiveLayout.value.pageSize;
    /* 几何绝不再被折成 900 宽重排：重排只会换行宽，字号仍按令牌落地 */
    expect(page.width).toBe(PAGE_SIZES.A5.width);
    expect(page.height).toBe(PAGE_SIZES.A5.height);
    expect(tokens.fitScale.value).toBeCloseTo(STAGE.width / PAGE_SIZES.A5.width, 3); // ≈1.61
    /* 面板读声明层：开本下拉不该被自适应顶成自定义 */
    expect(tokens.panelLayout.value.pageSize.width).toBe(PAGE_SIZES.A5.width);
    expect(tokens.panelLayout.value.pageSizeMode).toBe(PAGE_SIZE_MODES.WIDTH);
  });

  it('自适应高度：fitScale 按舞台高/页高，页框同样不动', async () => {
    const tokens = await setupTokens({
      stage: STAGE,
      patch: { pageSizeMode: PAGE_SIZE_MODES.HEIGHT },
    });
    expect(tokens.effectiveLayout.value.pageSize).toBe(MODERN_THEME.layout.pageSize);
    expect(tokens.fitScale.value).toBeCloseTo(STAGE.height / PAGE_SIZES.A5.height, 3); // ≈0.756
  });

  it('自适应两档：舞台尚未量到时不臆造，回退声明开本且倍率不覆盖', async () => {
    const widthTokens = await setupTokens({
      stage: null,
      patch: { pageSizeMode: PAGE_SIZE_MODES.WIDTH },
    });
    expect(widthTokens.effectiveLayout.value.pageSize).toBe(MODERN_THEME.layout.pageSize);
    expect(widthTokens.fitScale.value).toBeUndefined();

    const heightTokens = await setupTokens({
      stage: null,
      patch: { pageSizeMode: PAGE_SIZE_MODES.HEIGHT },
    });
    expect(heightTokens.fitScale.value).toBeUndefined();
  });

  it('h5：页宽落 340 + 单栏，页高仍铺舞台，不另加缩放倍率', async () => {
    const tokens = await setupTokens({
      stage: STAGE,
      patch: { pageSizeMode: PAGE_SIZE_MODES.H5 },
    });
    const layout = tokens.effectiveLayout.value;
    expect(layout.pageSize.width).toBe(340);
    expect(layout.pageSize.height).toBe(STAGE.height);
    expect(layout.columns).toBe(1);
    expect(tokens.fitScale.value).toBeUndefined();
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

  it('仿真版式：任何适配都不覆盖页型与倍率（版框 / 界行按固定开本）', async () => {
    const tokens = await setupTokens({
      theme: FACSIMILE_THEME,
      stage: STAGE,
      patch: { pageSizeMode: PAGE_SIZE_MODES.WIDTH },
    });
    expect(tokens.effectiveLayout.value.pageSize).toBe(FACSIMILE_THEME.layout.pageSize);
    expect(tokens.fitScale.value).toBeUndefined();
  });
});
