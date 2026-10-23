/**
 * 开本适配（pageSizeMode）契约与折算测试
 *
 * 守护三件事：
 * 1. 取值表与默认值——缺省即「固定」，旧快照与既有主题字面量才不会改视觉；
 * 2. 脏值过滤——持久化主体是自由键值，非法取值必须回落默认而非参与后续判定；
 * 3. 两条机制分路——width / height 是视图缩放（几何原样不动、只算倍率：
 *    resolvePageFitScale 绑同名轴 / 限幅 / 量不到不覆盖），h5 才是真实重排（窄页
 *    单栏）；仿真版式两路一律不动；只有动了几何的折算才进度量签名。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME } from '@bibliotype/core';
import {
  DEFAULT_PAGE_SIZE_MODE,
  PAGE_SIZE_MODES,
  applyPageSizeMode,
  resolvePageFitScale,
  resolvePageSizeMode,
  type PageSizeMode,
} from '../page-size-mode.js';
import {
  CLASSICAL_LAYOUT_OPTIONS,
  DEFAULT_LAYOUT_OPTIONS,
  FACSIMILE_BASE_LAYOUT,
  mergeLayoutOptions,
  type LayoutOptions,
} from '../layout-options.js';
import { H5_PAGE_SIZE, PAGE_SIZES } from '../page-size.js';
import { computeMetricsSignature } from '../metrics-signature.js';

/** 给布局套上一个适配档位 */
function withMode(mode: PageSizeMode, base: LayoutOptions = DEFAULT_LAYOUT_OPTIONS): LayoutOptions {
  return mergeLayoutOptions(base, { pageSizeMode: mode });
}

describe('开本适配取值与默认', () => {
  it('四值齐备且默认为固定', () => {
    expect(PAGE_SIZE_MODES).toEqual({
      WIDTH: 'width',
      HEIGHT: 'height',
      H5: 'h5',
      FIXED: 'fixed',
    });
    expect(DEFAULT_PAGE_SIZE_MODE).toBe(PAGE_SIZE_MODES.FIXED);
  });

  it('三个布局预设都显式声明固定', () => {
    for (const layout of [DEFAULT_LAYOUT_OPTIONS, CLASSICAL_LAYOUT_OPTIONS, FACSIMILE_BASE_LAYOUT]) {
      expect(layout.pageSizeMode).toBe(PAGE_SIZE_MODES.FIXED);
    }
  });
});

describe('resolvePageSizeMode', () => {
  it('缺省读作固定（旧快照无该键）', () => {
    expect(resolvePageSizeMode({})).toBe(PAGE_SIZE_MODES.FIXED);
    expect(resolvePageSizeMode({ pageSizeMode: undefined })).toBe(PAGE_SIZE_MODES.FIXED);
  });

  it('合法值原样返回', () => {
    expect(resolvePageSizeMode({ pageSizeMode: PAGE_SIZE_MODES.WIDTH })).toBe(
      PAGE_SIZE_MODES.WIDTH,
    );
    expect(resolvePageSizeMode({ pageSizeMode: PAGE_SIZE_MODES.HEIGHT })).toBe(
      PAGE_SIZE_MODES.HEIGHT,
    );
    expect(resolvePageSizeMode({ pageSizeMode: PAGE_SIZE_MODES.H5 })).toBe(PAGE_SIZE_MODES.H5);
  });

  it('落盘脏值回落固定', () => {
    const persisted = { pageSizeMode: 'whatever' } as unknown as Pick<
      LayoutOptions,
      'pageSizeMode'
    >;
    expect(resolvePageSizeMode(persisted)).toBe(PAGE_SIZE_MODES.FIXED);
  });
});

describe('applyPageSizeMode 几何折算（只有 h5 动几何）', () => {
  it('固定与缺省：同一对象返回，不新建布局', () => {
    expect(applyPageSizeMode(DEFAULT_LAYOUT_OPTIONS, { width: 900, height: 600 })).toBe(
      DEFAULT_LAYOUT_OPTIONS,
    );
    const base = mergeLayoutOptions(DEFAULT_LAYOUT_OPTIONS, {});
    expect(applyPageSizeMode(base)).toBe(base);
  });

  it('width / height 不改几何：页框保持开本（倍率走 resolvePageFitScale）', () => {
    const stage = { width: 900, height: 600 };
    for (const mode of [PAGE_SIZE_MODES.WIDTH, PAGE_SIZE_MODES.HEIGHT]) {
      const withModeOptions = withMode(mode);
      /* 重排只会换行宽换字号观感，不是 PDF 缩放——绝不能再折页框 */
      expect(applyPageSizeMode(withModeOptions, stage)).toBe(withModeOptions);
      expect(applyPageSizeMode(withModeOptions)).toBe(withModeOptions);
      expect(withModeOptions.pageSize.width).toBe(PAGE_SIZES.A5.width);
    }
  });

  it('直排（经典预设）同样不动几何', () => {
    const classical = withMode(PAGE_SIZE_MODES.WIDTH, CLASSICAL_LAYOUT_OPTIONS);
    expect(applyPageSizeMode(classical, { width: 900, height: 600 })).toBe(classical);
    expect(classical.pageSize).toBe(CLASSICAL_LAYOUT_OPTIONS.pageSize);
  });

  it('h5 页宽落 340 + 单栏，页高仍铺舞台', () => {
    const out = applyPageSizeMode(withMode(PAGE_SIZE_MODES.H5), { width: 900, height: 600 });
    expect(out.pageSize.width).toBe(H5_PAGE_SIZE.width);
    expect(out.pageSize.height).toBe(600);
    expect(out.pageSize.name).toBe('H5　340×600');
    expect(out.columns).toBe(1);
  });

  it('h5 无容器实测落 340×560 手机页（确定值，SSR 也能算）', () => {
    const out = applyPageSizeMode(withMode(PAGE_SIZE_MODES.H5));
    expect(out.pageSize).toBe(H5_PAGE_SIZE);
    expect(out.columns).toBe(1);
    /* 舞台高恰为缺省值时复用常量，不新建页型对象 */
    expect(
      applyPageSizeMode(withMode(PAGE_SIZE_MODES.H5), { width: 900, height: 560 }).pageSize,
    ).toBe(H5_PAGE_SIZE);
  });

  it('仿真版式任何模式都不覆盖页型（版框 / 界行几何按固定开本）', () => {
    const facsimile = mergeLayoutOptions(FACSIMILE_BASE_LAYOUT, {
      facsimile: { preset: 'song-zhe', frame: 'double', rule: 'ink' },
      pageSizeMode: PAGE_SIZE_MODES.H5,
    });
    expect(applyPageSizeMode(facsimile, { width: 900, height: 600 })).toBe(facsimile);
  });

  it('只有动了几何的折算才进度量签名（width / height 不重排）', () => {
    const signature = (options: LayoutOptions) =>
      computeMetricsSignature({ tokens: DEFAULT_THEME, options });
    const fixed = signature(DEFAULT_LAYOUT_OPTIONS);
    const stage = { width: 900, height: 600 };
    /* 视图缩放档不改页框 → 签名不变 → 不重量尺（拖窗口只是重新缩放） */
    expect(signature(applyPageSizeMode(withMode(PAGE_SIZE_MODES.WIDTH), stage))).toBe(fixed);
    expect(signature(applyPageSizeMode(withMode(PAGE_SIZE_MODES.HEIGHT), stage))).toBe(fixed);
    /* h5 真重排：必须驱动重量尺，否则错页 */
    expect(signature(applyPageSizeMode(withMode(PAGE_SIZE_MODES.H5), stage))).not.toBe(fixed);
    /* 未折算（固定）与缺省实测下签名逐字符不变——旧配置零回归 */
    expect(signature(applyPageSizeMode(DEFAULT_LAYOUT_OPTIONS))).toBe(fixed);
  });
});

describe('resolvePageFitScale 视图缩放倍率（PDF 适宽 / 适高）', () => {
  it('width 档：倍率 = 舞台宽 / 页宽（允许 >1，字体随页整体放大）', () => {
    /* A5 页宽 559：900 / 559 = 1.610（保留三位小数） */
    expect(
      resolvePageFitScale(withMode(PAGE_SIZE_MODES.WIDTH), { width: 900, height: 600 }),
    ).toBeCloseTo(900 / PAGE_SIZES.A5.width, 3);
  });

  it('height 档：倍率 = 舞台高 / 页高', () => {
    /* A5 页高 794：600 / 794 = 0.756 */
    expect(
      resolvePageFitScale(withMode(PAGE_SIZE_MODES.HEIGHT), { width: 900, height: 600 }),
    ).toBeCloseTo(600 / PAGE_SIZES.A5.height, 3);
  });

  it('直排 16 开也绑同名轴（699 宽页 → 900/699）', () => {
    const scale = resolvePageFitScale(
      withMode(PAGE_SIZE_MODES.WIDTH, CLASSICAL_LAYOUT_OPTIONS),
      { width: 900, height: 600 },
    );
    expect(scale).toBeCloseTo(900 / PAGE_SIZES.FOLIO_16.width, 3);
  });

  it('固定 / h5 档不覆盖：undefined = 视图按自身 contain 适配', () => {
    const stage = { width: 900, height: 600 };
    expect(resolvePageFitScale(withMode(PAGE_SIZE_MODES.FIXED), stage)).toBeUndefined();
    expect(resolvePageFitScale(DEFAULT_LAYOUT_OPTIONS, stage)).toBeUndefined();
    expect(resolvePageFitScale(withMode(PAGE_SIZE_MODES.H5), stage)).toBeUndefined();
  });

  it('量不到同名轴不覆盖（SSR / 未挂载不用另一轴臆造倍率）', () => {
    expect(resolvePageFitScale(withMode(PAGE_SIZE_MODES.WIDTH))).toBeUndefined();
    expect(
      resolvePageFitScale(withMode(PAGE_SIZE_MODES.WIDTH), { width: 0, height: 600 }),
    ).toBeUndefined();
    expect(
      resolvePageFitScale(withMode(PAGE_SIZE_MODES.HEIGHT), { width: 900, height: 0 }),
    ).toBeUndefined();
  });

  it('倍率限幅 0.2~4（窄侧栏 / 带鱼屏都不失控）', () => {
    expect(
      resolvePageFitScale(withMode(PAGE_SIZE_MODES.WIDTH), { width: 100, height: 600 }),
    ).toBe(0.2);
    expect(
      resolvePageFitScale(withMode(PAGE_SIZE_MODES.WIDTH), { width: 3000, height: 600 }),
    ).toBe(4);
    expect(
      resolvePageFitScale(withMode(PAGE_SIZE_MODES.HEIGHT), { width: 900, height: 100 }),
    ).toBe(0.2);
  });

  it('仿真版式不覆盖（与几何折算同一守卫）', () => {
    const facsimile = mergeLayoutOptions(FACSIMILE_BASE_LAYOUT, {
      facsimile: { preset: 'song-zhe', frame: 'double', rule: 'ink' },
      pageSizeMode: PAGE_SIZE_MODES.WIDTH,
    });
    expect(resolvePageFitScale(facsimile, { width: 900, height: 600 })).toBeUndefined();
  });

  it('同舞台重算倍率稳定（三位小数收敛，不每帧新值白重渲染）', () => {
    const options = withMode(PAGE_SIZE_MODES.WIDTH);
    const stage = { width: 877, height: 631 };
    expect(resolvePageFitScale(options, stage)).toBe(resolvePageFitScale(options, stage));
  });
});

describe('布局补丁合并', () => {
  it('浅合并只改适配，不动开本与分栏', () => {
    const merged = mergeLayoutOptions(DEFAULT_LAYOUT_OPTIONS, { pageSizeMode: PAGE_SIZE_MODES.H5 });
    expect(merged.pageSizeMode).toBe(PAGE_SIZE_MODES.H5);
    expect(merged.pageSize).toBe(DEFAULT_LAYOUT_OPTIONS.pageSize);
    expect(merged.columns).toBe(DEFAULT_LAYOUT_OPTIONS.columns);
  });
});
