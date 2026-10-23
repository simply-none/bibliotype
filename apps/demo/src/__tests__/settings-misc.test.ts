/**
 * 「其他」分区（PDF 导出方式）测试
 *
 * 覆盖：两张导出方式卡渲染与选中回显、切换 emit、默认值与容错守卫、
 * UI 只暴露语义化名称（不出现实现层技术词）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref, type App, type Ref } from 'vue';
import SettingsMisc from '../components/settings/SettingsMisc.vue';
import {
  DEFAULT_PDF_EXPORT_MODE,
  isPdfExportMode,
  type PdfExportMode,
} from '../composables/use-settings-snapshot.js';

/** 当前挂载实例（每个用例结束统一卸载） */
let mounted: { app: App; container: HTMLElement } | null = null;

afterEach(() => {
  mounted?.app.unmount();
  mounted?.container.remove();
  mounted = null;
});

/** 挂载「其他」分区，返回导出方式 ref 供回显断言 */
function mountMisc(initial: PdfExportMode): { container: HTMLElement; mode: Ref<PdfExportMode> } {
  const mode = ref<PdfExportMode>(initial);
  const Host = defineComponent({
    render: () =>
      h(SettingsMisc, {
        pdfExportMode: mode.value,
        'onUpdate:pdf-export-mode': (value: PdfExportMode) => {
          mode.value = value;
        },
      }),
  });

  const container = document.createElement('div');
  document.body.appendChild(container);
  const app = createApp(Host);
  app.mount(container);
  mounted = { app, container };
  return { container, mode };
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
});
