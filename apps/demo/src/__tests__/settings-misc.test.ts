/**
 * 「其他」分区（滚动条样式 / PDF 导出方式）测试
 *
 * 覆盖：滚动条三套预设与预览卡、两张导出方式卡渲染与选中回显、切换 emit、
 * 默认值与容错守卫、UI 只暴露语义化名称（不出现实现层技术词）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref, type App, type Ref } from 'vue';
import SettingsMisc from '../components/settings/SettingsMisc.vue';
import {
  DEFAULT_PDF_EXPORT_MODE,
  DEFAULT_PDF_RASTER_SCALE,
  isPdfExportMode,
  isPdfRasterScale,
  type PdfExportMode,
  type PdfRasterScale,
} from '../composables/use-settings-snapshot.js';
import {
  DEFAULT_SCROLLBAR_STYLE,
  SCROLLBAR_STYLES,
  isScrollbarStyleKey,
  type ScrollbarStyleKey,
} from '../ui-skin.js';

/** 当前挂载实例（每个用例结束统一卸载） */
let mounted: { app: App; container: HTMLElement } | null = null;

afterEach(() => {
  mounted?.app.unmount();
  mounted?.container.remove();
  mounted = null;
});

/** 挂载「其他」分区，返回导出方式 / 清晰度 / 滚动条样式 ref 供回显断言 */
function mountMisc(
  initial: PdfExportMode,
  initialScale: PdfRasterScale = 2,
  initialScrollbar: ScrollbarStyleKey = DEFAULT_SCROLLBAR_STYLE,
): {
  container: HTMLElement;
  mode: Ref<PdfExportMode>;
  scale: Ref<PdfRasterScale>;
  scrollbar: Ref<ScrollbarStyleKey>;
} {
  const mode = ref<PdfExportMode>(initial);
  const scale = ref<PdfRasterScale>(initialScale);
  const scrollbar = ref<ScrollbarStyleKey>(initialScrollbar);
  const Host = defineComponent({
    render: () =>
      h(SettingsMisc, {
        pdfExportMode: mode.value,
        pdfRasterScale: scale.value,
        scrollbarStyle: scrollbar.value,
        'onUpdate:pdf-export-mode': (value: PdfExportMode) => {
          mode.value = value;
        },
        'onUpdate:pdf-raster-scale': (value: PdfRasterScale) => {
          scale.value = value;
        },
        'onUpdate:scrollbar-style': (value: ScrollbarStyleKey) => {
          scrollbar.value = value;
        },
      }),
  });

  const container = document.createElement('div');
  document.body.appendChild(container);
  const app = createApp(Host);
  app.mount(container);
  mounted = { app, container };
  return { container, mode, scale, scrollbar };
}

describe('SettingsMisc（「其他」分区）', () => {
  it('默认导出方式为应用内直出，合法值守卫拒绝脏数据', () => {
    expect(DEFAULT_PDF_EXPORT_MODE).toBe('in-app');
    expect(isPdfExportMode('browser-dialog')).toBe(true);
    expect(isPdfExportMode('pdfjs')).toBe(false);
    expect(isPdfExportMode('')).toBe(false);
    expect(isPdfExportMode(null)).toBe(false);
  });

  it('渲染两张导出方式卡，默认选中应用内直出', () => {
    const { container } = mountMisc('in-app');
    const cards = Array.from(container.querySelectorAll<HTMLButtonElement>('.panel__export-mode'));
    expect(cards).toHaveLength(2);
    expect(cards.map((card) => card.dataset.exportMode)).toEqual(['in-app', 'browser-dialog']);
    expect(cards[0]?.classList.contains('panel__export-mode--active')).toBe(true);
    expect(cards[1]?.classList.contains('panel__export-mode--active')).toBe(false);
  });

  it('点击切换 → emit 回流父级并回显选中态', async () => {
    const { container, mode } = mountMisc('in-app');
    const dialogCard = container.querySelector<HTMLButtonElement>(
      '.panel__export-mode[data-export-mode="browser-dialog"]',
    );
    if (!(dialogCard instanceof HTMLButtonElement)) throw new Error('未渲染浏览器对话框导出卡');
    dialogCard.click();
    await nextTick();

    expect(mode.value).toBe('browser-dialog');
    expect(
      container
        .querySelector('.panel__export-mode[data-export-mode="browser-dialog"]')
        ?.classList.contains('panel__export-mode--active'),
    ).toBe(true);
  });

  it('UI 只暴露语义化名称，不出现实现层技术词', () => {
    const { container } = mountMisc('in-app');
    const text = container.textContent ?? '';
    expect(text).toContain('应用内直出');
    expect(text).toContain('浏览器对话框导出');
    for (const jargon of ['pdf-lib', 'pdfjs', 'foreignObject', 'iframe', 'canvas']) {
      expect(text.toLowerCase()).not.toContain(jargon);
    }
  });

  it('清晰度四档：缺省选中标准 192dpi，守卫拒绝脏数据', () => {
    expect(DEFAULT_PDF_RASTER_SCALE).toBe(2);
    expect(isPdfRasterScale(3)).toBe(true);
    expect(isPdfRasterScale(0)).toBe(false);
    expect(isPdfRasterScale(5)).toBe(false);
    expect(isPdfRasterScale('2')).toBe(false);

    const { container, scale } = mountMisc('in-app');
    const tiers = Array.from(container.querySelectorAll<HTMLButtonElement>('.panel__raster-scale'));
    expect(tiers.map((tier) => tier.dataset.rasterScale)).toEqual(['1', '2', '3', '4']);
    expect(
      container
        .querySelector('.panel__raster-scale[data-raster-scale="2"]')
        ?.classList.contains('panel__raster-scale--active'),
    ).toBe(true);
  });

  it('点击清晰度档 → emit 回流父级并回显选中态', async () => {
    const { container, scale } = mountMisc('in-app');
    const tier = container.querySelector<HTMLButtonElement>(
      '.panel__raster-scale[data-raster-scale="3"]',
    );
    if (!(tier instanceof HTMLButtonElement)) throw new Error('未渲染高清档');
    tier.click();
    await nextTick();

    expect(scale.value).toBe(3);
    expect(
      container
        .querySelector('.panel__raster-scale[data-raster-scale="3"]')
        ?.classList.contains('panel__raster-scale--active'),
    ).toBe(true);
  });

  it('滚动条三套预设由注册表驱动，默认墨线选中，守卫拒绝脏数据', () => {
    expect(DEFAULT_SCROLLBAR_STYLE).toBe('ink');
    expect(isScrollbarStyleKey('bamboo')).toBe(true);
    expect(isScrollbarStyleKey('paper')).toBe(false);
    expect(isScrollbarStyleKey(null)).toBe(false);

    const { container } = mountMisc('in-app');
    const cards = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.panel__scrollbar-style'),
    );
    expect(cards.map((card) => card.dataset.scrollbarStyle)).toEqual(
      SCROLLBAR_STYLES.map((style) => style.key),
    );
    expect(cards[0]?.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelectorAll('.panel__scrollbar-preview')).toHaveLength(
      SCROLLBAR_STYLES.length,
    );
  });

  it('点击滚动条卡 → emit 回流父级并回显选中态', async () => {
    const { container, scrollbar } = mountMisc('in-app');
    const bamboo = container.querySelector<HTMLButtonElement>(
      '.panel__scrollbar-style[data-scrollbar-style="bamboo"]',
    );
    if (!(bamboo instanceof HTMLButtonElement)) throw new Error('未渲染竹简滚动条卡');
    bamboo.click();
    await nextTick();

    expect(scrollbar.value).toBe('bamboo');
    expect(bamboo.getAttribute('aria-pressed')).toBe('true');
    expect(
      container
        .querySelector('.panel__scrollbar-style[data-scrollbar-style="ink"]')
        ?.getAttribute('aria-pressed'),
    ).toBe('false');
  });
});
