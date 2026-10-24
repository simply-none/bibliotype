/**
 * 设置面板「界面外观」区行为测试（美化 P4）
 *
 * 守护四条约定：
 * 1. 皮肤卡由注册表驱动——注册几套渲染几张，顺序与 `UI_SKINS` 一致；
 * 2. 点卡片只 `emit('update:ui-skin')`，面板自己不改状态（皮肤是壳层偏好，
 *    不进样式草稿，落盘由父级快照负责）；
 * 3. `aria-pressed` 与父级回灌的 `uiSkin` 同步（选中态是唯一可访问信号）；
 * 4. 密度 / 动效走同一制式：选项各自 emit 自己的键，互不串台。
 *
 * demo 未装 `@vue/test-utils`，这里沿用 `createApp` + `h` 的挂载范式：
 * 宿主组件把 props 接在 ref 上，点击后由 ref 变化驱动重渲染，
 * 才能同时验到「emit 出去」和「aria-pressed 跟随」两件事。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref, type App, type Ref } from 'vue';
import { DEFAULT_THEME } from '@bibliotype/core';
import { CLASSICAL_LAYOUT_OPTIONS, mergeLayoutOptions } from '@bibliotype/layout';
import { MemoryStyleStore } from '@bibliotype/adapter-indexeddb';
import SettingsPanel from '../components/SettingsPanel.vue';
import { useStyleSettings } from '../composables/use-style-settings.js';
import { UI_SKINS, type UiDensity, type UiMotion, type UiSkinKey } from '../ui-skin.js';

/** 当前挂载实例（每个用例结束统一卸载） */
let mounted: { app: App; container: HTMLElement } | null = null;

afterEach(() => {
  mounted?.app.unmount();
  mounted?.container.remove();
  mounted = null;
});

/** 挂载设置面板并跳到「界面外观」分区 */
async function mountAppearance(): Promise<{
  container: HTMLElement;
  skin: Ref<UiSkinKey>;
  density: Ref<UiDensity>;
  motion: Ref<UiMotion>;
}> {
  const api = useStyleSettings({ bookId: ref('demo'), draft: true, store: new MemoryStyleStore() });
  const skin = ref<UiSkinKey>('paper');
  const density = ref<UiDensity>('comfortable');
  const motion = ref<UiMotion>('auto');

  const Host = defineComponent({
    render: () =>
      h(SettingsPanel, {
        api,
        layout: mergeLayoutOptions(CLASSICAL_LAYOUT_OPTIONS, {}),
        tokens: DEFAULT_THEME,
        night: false,
        uiSkin: skin.value,
        uiDensity: density.value,
        uiMotion: motion.value,
        pdfExportMode: 'in-app',
        pdfRasterScale: 2,
        'onUpdate:ui-skin': (value: UiSkinKey) => {
          skin.value = value;
        },
        'onUpdate:ui-density': (value: UiDensity) => {
          density.value = value;
        },
        'onUpdate:ui-motion': (value: UiMotion) => {
          motion.value = value;
        },
      }),
  });

  const container = document.createElement('div');
  document.body.appendChild(container);
  const app = createApp(Host);
  app.mount(container);
  mounted = { app, container };

  /* 切到外观分区：默认落在「功能样式」，得先点导航 */
  const navItem = Array.from(container.querySelectorAll('.panel__nav-item')).find(
    (node) => (node.textContent ?? '').includes('界面外观'),
  );
  if (!(navItem instanceof HTMLButtonElement)) throw new Error('未渲染「界面外观」导航项');
  navItem.click();
  await nextTick();

  return { container, skin, density, motion };
}

/** 取皮肤卡按钮（按注册表顺序） */
function skinCards(container: HTMLElement): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('[data-skin-option]'));
}

describe('设置面板「界面外观」（P4）', () => {
  it('导航项存在且皮肤卡由注册表驱动', async () => {
    const { container } = await mountAppearance();

    expect(container.querySelector('.panel__skins')).not.toBeNull();
    const cards = skinCards(container);
    expect(cards).toHaveLength(UI_SKINS.length);
    expect(cards.map((card) => card.dataset.skinOption)).toEqual(UI_SKINS.map((item) => item.key));
  });

  it('点皮肤卡 emit 新键，默认项以 aria-pressed 标记选中', async () => {
    const { container } = await mountAppearance();

    const cards = skinCards(container);
    expect(cards[0]?.getAttribute('aria-pressed')).toBe('true');

    const ink = cards.find((card) => card.dataset.skinOption === 'ink');
    if (!(ink instanceof HTMLButtonElement)) throw new Error('未渲染墨色皮肤卡');
    ink.click();
    await nextTick();

    expect(ink.getAttribute('aria-pressed')).toBe('true');
    expect(cards[0]?.getAttribute('aria-pressed')).toBe('false');
    /* 选中标记只有一份，避免出现两个「已选中」卡片 */
    expect(skinCards(container).filter((card) => card.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
  });

  it('密度与动效各走各的 emit，不改皮肤键', async () => {
    const { container, skin, density, motion } = await mountAppearance();

    const chips = Array.from(container.querySelectorAll<HTMLButtonElement>('.panel__chip'));
    const compact = chips.find((chip) => (chip.textContent ?? '').trim() === '紧凑');
    const motionOff = chips.find((chip) => (chip.textContent ?? '').trim() === '关闭');
    if (!(compact instanceof HTMLButtonElement) || !(motionOff instanceof HTMLButtonElement)) {
      throw new Error('未渲染密度 / 动效选项');
    }

    compact.click();
    motionOff.click();
    await nextTick();

    expect(density.value).toBe('compact');
    expect(motion.value).toBe('off');
    expect(skin.value).toBe('paper');
    expect(compact.getAttribute('aria-pressed')).toBe('true');
  });

  it('夜读纸色开关独立于皮肤：切夜间不影响皮肤卡选中态', async () => {
    const { container, skin } = await mountAppearance();

    const nightSwitch = container.querySelector<HTMLInputElement>('.panel__switch input');
    if (nightSwitch === null) throw new Error('未渲染夜读纸色开关');

    const ink = skinCards(container).find((card) => card.dataset.skinOption === 'ink');
    ink?.click();
    await nextTick();
    expect(skin.value).toBe('ink');

    nightSwitch.checked = true;
    nightSwitch.dispatchEvent(new Event('change'));
    await nextTick();

    expect(skin.value).toBe('ink');
    expect(ink?.getAttribute('aria-pressed')).toBe('true');
  });
});
