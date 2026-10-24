/**
 * 设置面板「版面与页面」·开本适配行为测试
 *
 * 守护三条约定：
 * 1. 下拉落在「分栏」之后，四值齐备且缺省选中「固定」（旧快照无该键时的回显）；
 * 2. 选项文案固定不随书写方向变：「自适应宽度 / 自适应高度」并列共存，
 *    各绑同名轴算 PDF 式整页缩放倍率（页框与分页不动，字体随页等比缩放）；
 * 3. 改动只经 `api.patchLayout` 写进样式草稿，回显读草稿层，避免「点了不高亮」；
 *    草稿里不自带 `pageSize` / `columns`，页型折算与缩放倍率归生效层（见对侧 wiring 测试）。
 *
 * demo 未装 `@vue/test-utils`，沿用 `createApp` + `h` 的挂载范式（宿主把布局
 * 基准与草稿补丁现算成 props，模拟父级 panelLayout 的合并口径）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref, type App } from 'vue';
import { DEFAULT_THEME } from '@bibliotype/core';
import {
  CLASSICAL_LAYOUT_OPTIONS,
  PAGE_SIZE_MODES,
  WRITING_MODES,
  mergeLayoutOptions,
  resolvePageSizeMode,
  type LayoutOptions,
} from '@bibliotype/layout';
import { MemoryStyleStore } from '@bibliotype/adapter-indexeddb';
import SettingsPanel from '../components/SettingsPanel.vue';
import { useStyleSettings } from '../composables/use-style-settings.js';

/** 当前挂载实例（每个用例结束统一卸载） */
let mounted: { app: App; container: HTMLElement } | null = null;

afterEach(() => {
  mounted?.app.unmount();
  mounted?.container.remove();
  mounted = null;
});

/** 挂载设置面板并跳到「版面与页面」分区 */
async function mountLayoutSection(
  fitScale?: number,
): Promise<{
  container: HTMLElement;
  patchLayout: (patch: Record<string, unknown>) => void;
  draftLayout: () => Record<string, unknown>;
}> {
  const api = useStyleSettings({ bookId: ref('demo'), draft: true, store: new MemoryStyleStore() });

  const Host = defineComponent({
    render: () =>
      h(SettingsPanel, {
        api,
        layout: mergeLayoutOptions(
          CLASSICAL_LAYOUT_OPTIONS,
          api.panelLayoutPatch.value as Partial<LayoutOptions>,
        ),
        tokens: DEFAULT_THEME,
        night: false,
        uiSkin: 'paper',
        uiDensity: 'comfortable',
        uiMotion: 'auto',
        pdfExportMode: 'in-app',
        pdfRasterScale: 2,
        fitScale,
      }),
  });

  const container = document.createElement('div');
  document.body.appendChild(container);
  const app = createApp(Host);
  app.mount(container);
  mounted = { app, container };

  /* 切到版面分区：默认落在「功能样式」，得先点导航 */
  const navItem = Array.from(container.querySelectorAll('.panel__nav-item')).find(
    (node) => (node.textContent ?? '').includes('版面与页面'),
  );
  if (!(navItem instanceof HTMLButtonElement)) throw new Error('未渲染「版面与页面」导航项');
  navItem.click();
  await nextTick();

  return { container, patchLayout: api.patchLayout, draftLayout: () => api.panelLayoutPatch.value };
}

/** 取「开本适配」下拉（按分区内 label 文案定位，不依赖元素序号） */
function modeSelect(container: HTMLElement): HTMLSelectElement {
  const field = Array.from(container.querySelectorAll('.panel__field')).find(
    (node) => (node.querySelector('.panel__label')?.textContent ?? '').trim() === '开本适配',
  );
  const select = field?.querySelector('select');
  if (!(select instanceof HTMLSelectElement)) throw new Error('未渲染「开本适配」下拉');
  return select;
}

/** 切书写方向（草稿补丁），用于验证选项文案与方向解耦 */
async function setWritingMode(
  patchLayout: (patch: Record<string, unknown>) => void,
  writingMode: string,
): Promise<void> {
  patchLayout({ writingMode });
  await nextTick();
}

describe('设置面板「开本适配」', () => {
  it('下拉渲染四值且缺省选中固定', async () => {
    const { container, draftLayout } = await mountLayoutSection();

    const select = modeSelect(container);
    expect(Array.from(select.options).map((option) => option.value)).toEqual([
      PAGE_SIZE_MODES.WIDTH,
      PAGE_SIZE_MODES.HEIGHT,
      PAGE_SIZE_MODES.H5,
      PAGE_SIZE_MODES.FIXED,
    ]);
    expect(select.value).toBe(PAGE_SIZE_MODES.FIXED);
    /* 缺省态不落补丁：旧快照 / 未改动时草稿里没有该键 */
    expect('pageSizeMode' in draftLayout()).toBe(false);
  });

  it('文案不随书写方向变：宽 / 高两档并列，选哪轴听用户的', async () => {
    const { container, patchLayout } = await mountLayoutSection();

    const labels = () =>
      Array.from(modeSelect(container).options).map((option) => option.textContent?.trim());
    /* 基准是直排（CLASSICAL），两档也同时在场 */
    expect(labels()).toEqual(['自适应宽度', '自适应高度', '自适应 H5', '固定']);

    await setWritingMode(patchLayout, WRITING_MODES.HORIZONTAL_TB);
    expect(labels()).toEqual(['自适应宽度', '自适应高度', '自适应 H5', '固定']);
  });

  it('选「自适应 H5」写入草稿并保持选中', async () => {
    const { container, draftLayout } = await mountLayoutSection();

    const select = modeSelect(container);
    select.value = PAGE_SIZE_MODES.H5;
    select.dispatchEvent(new Event('change'));
    await nextTick();

    expect(draftLayout().pageSizeMode).toBe(PAGE_SIZE_MODES.H5);
    expect(modeSelect(container).value).toBe(PAGE_SIZE_MODES.H5);
    /* 面板只落意图：开本尺寸与分栏不因适配改动被顺手改写（折算发生在生效层） */
    expect(draftLayout().pageSize).toBeUndefined();
    expect(draftLayout().columns).toBeUndefined();
  });

  it('宽 / 高档回显生效倍率，量不到舞台时明示回退（消除静默失效）', async () => {
    /* 开本适配的提示行按文本定位（面板内还有页底溢出等同名 hint 元素） */
    const hintOf = (container: HTMLElement) =>
      Array.from(container.querySelectorAll('.panel__hint'))
        .map((node) => node.textContent?.trim())
        .find((text) => text?.includes('视图缩放') || text?.includes('固定开本显示'));

    const hinted = await mountLayoutSection(1.61);
    const select = modeSelect(hinted.container);
    select.value = PAGE_SIZE_MODES.WIDTH;
    select.dispatchEvent(new Event('change'));
    await nextTick();
    expect(hintOf(hinted.container)).toBe('视图缩放 ×1.610');

    /* 舞台未量到（fitScale undefined）：明示按固定开本显示，不静默假死 */
    const unhinted = await mountLayoutSection(undefined);
    const bare = modeSelect(unhinted.container);
    bare.value = PAGE_SIZE_MODES.HEIGHT;
    bare.dispatchEvent(new Event('change'));
    await nextTick();
    expect(hintOf(unhinted.container)).toBe('暂按固定开本显示（舞台尺寸未量到）');

    /* 其余档位不出现提示行 */
    bare.value = PAGE_SIZE_MODES.FIXED;
    bare.dispatchEvent(new Event('change'));
    await nextTick();
    expect(hintOf(unhinted.container)).toBeUndefined();
  });

  it('补丁里的脏值回显为固定（不被静默采纳）', async () => {
    const { container, patchLayout, draftLayout } = await mountLayoutSection();

    patchLayout({ pageSizeMode: 'whatever' });
    await nextTick();

    /* 脏值仍留在草稿里（面板不擅自回写用户数据），但生效值经 resolve 归一为固定 */
    expect(draftLayout().pageSizeMode).toBe('whatever');
    expect(resolvePageSizeMode(draftLayout() as Partial<LayoutOptions>)).toBe(
      PAGE_SIZE_MODES.FIXED,
    );
    expect(modeSelect(container).value).toBe(PAGE_SIZE_MODES.FIXED);
  });
});
