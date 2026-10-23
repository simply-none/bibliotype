/**
 * 开本适配（pageSizeMode）契约与折算测试
 *
 * 守护三件事：
 * 1. 取值表与默认值——缺省即「固定」，旧快照与既有主题字面量才不会改视觉；
 * 2. 脏值过滤——持久化主体是自由键值，非法取值必须回落默认而非参与后续判定；
 * 3. 折算几何——width / height 显式绑轴等比折算（保持开本宽高比 / 限幅 / 幂等 /
 *    量不到同名轴不动）、h5 落窄页单栏，仿真版式一律不动版面；折算后的页宽 /
 *    页高必须进入度量签名（否则改了适配不重排会错页）。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME } from '@bibliotype/core';
import {
  DEFAULT_PAGE_SIZE_MODE,
  PAGE_SIZE_MODES,
  applyPageSizeMode,
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

describe('applyPageSizeMode 几何折算', () => {
  it('固定与缺省：同一对象返回，不新建布局', () => {
    expect(applyPageSizeMode(DEFAULT_LAYOUT_OPTIONS, { width: 900, height: 600 })).toBe(
      DEFAULT_LAYOUT_OPTIONS,
    );
    const base = mergeLayoutOptions(DEFAULT_LAYOUT_OPTIONS, {});
    expect(applyPageSizeMode(base)).toBe(base);
  });

  it('width 绑页宽：页宽取舞台值，页高按开本宽高比反推（不拉伸）', () => {
    const out = applyPageSizeMode(withMode(PAGE_SIZE_MODES.WIDTH), { width: 900, height: 600 });
    /* A5 559×794：页高 = 900×794/559，舞台多高都不参与 */
    expect(out.pageSize.width).toBe(900);
    expect(out.pageSize.height).toBe(1278);
    expect(out.pageSize.name).toContain('适应版面');
    expect(out.columns).toBe(DEFAULT_LAYOUT_OPTIONS.columns);
    /* 入参页型常量不被改写 */
    expect(DEFAULT_LAYOUT_OPTIONS.pageSize.width).toBe(PAGE_SIZES.A5.width);
  });

  it('height 绑页高：页高取舞台值，页宽按开本宽高比反推', () => {
    const out = applyPageSizeMode(withMode(PAGE_SIZE_MODES.HEIGHT), { width: 900, height: 600 });
    expect(out.pageSize.height).toBe(600);
    expect(out.pageSize.width).toBe(422); // 600×559/794
    expect(out.pageSize.name).toContain('适应版面');
  });

  it('width / height 任意舞台都不改开本宽高比（拉伸问题根源守护）', () => {
    const ratio = PAGE_SIZES.A5.width / PAGE_SIZES.A5.height;
    for (const mode of [PAGE_SIZE_MODES.WIDTH, PAGE_SIZE_MODES.HEIGHT]) {
      for (const stage of [
        { width: 900, height: 600 },
        { width: 1200, height: 2000 },
        { width: 420, height: 900 },
      ]) {
        const page = applyPageSizeMode(withMode(mode), stage).pageSize;
        expect(page.width / page.height).toBeCloseTo(ratio, 2);
      }
    }
  });

  it('直排同样显式绑轴（折算不分书写方向，方向只影响面板文案）', () => {
    const out = applyPageSizeMode(withMode(PAGE_SIZE_MODES.WIDTH, CLASSICAL_LAYOUT_OPTIONS), {
      width: 900,
      height: 600,
    });
    /* 16 开 699×983：页高 = 900×983/699 */
    expect(out.pageSize.width).toBe(900);
    expect(out.pageSize.height).toBe(1266);
  });

  it('量不到同名轴就不动（SSR / 未挂载不拿另一轴臆造）', () => {
    const widthMode = withMode(PAGE_SIZE_MODES.WIDTH);
    const heightMode = withMode(PAGE_SIZE_MODES.HEIGHT);
    expect(applyPageSizeMode(widthMode)).toBe(widthMode);
    expect(applyPageSizeMode(widthMode, { width: 0, height: 600 })).toBe(widthMode);
    expect(applyPageSizeMode(heightMode)).toBe(heightMode);
    expect(applyPageSizeMode(heightMode, { width: 900, height: 0 })).toBe(heightMode);
  });

  it('绑定轴限幅到可读区间（侧栏拖到底 / 带鱼屏都不爆炸）', () => {
    const small = applyPageSizeMode(withMode(PAGE_SIZE_MODES.WIDTH), { width: 100, height: 600 })
      .pageSize;
    expect(small.width).toBe(240); // 绑定轴钳到下限
    expect(small.height).toBe(341); // 240×794/559，反推轴随比例不单独限
    const huge = applyPageSizeMode(withMode(PAGE_SIZE_MODES.WIDTH), { width: 4000, height: 600 })
      .pageSize;
    expect(huge.width).toBe(1600);
    expect(huge.height).toBe(2273); // 1600×794/559
    const tall = applyPageSizeMode(withMode(PAGE_SIZE_MODES.HEIGHT), { width: 900, height: 4000 })
      .pageSize;
    expect(tall.height).toBe(1600);
    expect(tall.width).toBe(1126); // 1600×559/794
  });

  it('幂等：同一舞台重复折算不再新建页型、页名不累加后缀', () => {
    const stage = { width: 900, height: 600 };
    const once = applyPageSizeMode(withMode(PAGE_SIZE_MODES.WIDTH), stage);
    expect(applyPageSizeMode(once, stage)).toBe(once);
    expect(once.pageSize.name.match(/·适应版面/g)).toHaveLength(1);
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

  it('折算后的页型进入度量签名（驱动重排，不会错页）', () => {
    const signature = (options: LayoutOptions) =>
      computeMetricsSignature({ tokens: DEFAULT_THEME, options });
    const fixed = signature(DEFAULT_LAYOUT_OPTIONS);
    const stage = { width: 900, height: 600 };
    expect(signature(applyPageSizeMode(withMode(PAGE_SIZE_MODES.WIDTH), stage))).not.toBe(fixed);
    expect(signature(applyPageSizeMode(withMode(PAGE_SIZE_MODES.HEIGHT), stage))).not.toBe(fixed);
    expect(signature(applyPageSizeMode(withMode(PAGE_SIZE_MODES.H5), stage))).not.toBe(fixed);
    /* 未折算（固定）与缺省实测下签名逐字符不变——旧配置零回归 */
    expect(signature(applyPageSizeMode(DEFAULT_LAYOUT_OPTIONS))).toBe(fixed);
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
