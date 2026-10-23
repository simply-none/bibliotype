/**
 * 开本适配（pageSizeMode）契约与折算测试
 *
 * 守护三件事：
 * 1. 取值表与默认值——缺省即「固定」，旧快照与既有主题字面量才不会改视觉；
 * 2. 脏值过滤——持久化主体是自由键值，非法取值必须回落默认而非参与后续判定；
 * 3. 折算几何——auto 把页框铺到舞台盒（限幅 / 幂等 / 单轴回退）、h5 落窄页单栏，
 *    仿真版式一律不动版面；折算后的页宽 / 页高必须进入度量签名（否则改了适配
 *    不重排会错页）。
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
  it('三值齐备且默认为固定', () => {
    expect(PAGE_SIZE_MODES).toEqual({ AUTO: 'auto', H5: 'h5', FIXED: 'fixed' });
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
    expect(resolvePageSizeMode({ pageSizeMode: PAGE_SIZE_MODES.AUTO })).toBe(PAGE_SIZE_MODES.AUTO);
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

  it('auto 两轴都铺到舞台盒（缩放系数恰为 1，不裁切不留白）', () => {
    const out = applyPageSizeMode(withMode(PAGE_SIZE_MODES.AUTO), { width: 900, height: 600 });
    expect(out.pageSize.width).toBe(900);
    expect(out.pageSize.height).toBe(600);
    expect(out.pageSize.name).toContain('适应版面');
    expect(out.columns).toBe(DEFAULT_LAYOUT_OPTIONS.columns);
    /* 入参页型常量不被改写 */
    expect(DEFAULT_LAYOUT_OPTIONS.pageSize.width).toBe(PAGE_SIZES.A5.width);
  });

  it('auto 直排同样铺两轴（取轴不再随书写方向分叉）', () => {
    const out = applyPageSizeMode(withMode(PAGE_SIZE_MODES.AUTO, CLASSICAL_LAYOUT_OPTIONS), {
      width: 900,
      height: 600,
    });
    expect(out.pageSize.width).toBe(900);
    expect(out.pageSize.height).toBe(600);
  });

  it('auto 无容器实测（SSR / 未挂载）回退原开本', () => {
    const withAuto = withMode(PAGE_SIZE_MODES.AUTO);
    expect(applyPageSizeMode(withAuto)).toBe(withAuto);
    /* 单轴就绪就只铺那一轴 */
    const half = applyPageSizeMode(withAuto, { width: 0, height: 600 });
    expect(half.pageSize.width).toBe(withAuto.pageSize.width);
    expect(half.pageSize.height).toBe(600);
  });

  it('auto 限幅到可读区间（侧栏拖到底 / 带鱼屏都不爆炸）', () => {
    const stage = (width: number, height: number) => ({ width, height });
    const small = applyPageSizeMode(withMode(PAGE_SIZE_MODES.AUTO), stage(100, 100)).pageSize;
    expect(small.width).toBe(240);
    expect(small.height).toBe(240);
    const huge = applyPageSizeMode(withMode(PAGE_SIZE_MODES.AUTO), stage(4000, 4000)).pageSize;
    expect(huge.width).toBe(1600);
    expect(huge.height).toBe(1600);
  });

  it('auto 幂等：同一舞台重复折算不再新建页型、页名不累加后缀', () => {
    const stage = { width: 900, height: 600 };
    const once = applyPageSizeMode(withMode(PAGE_SIZE_MODES.AUTO), stage);
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
    expect(signature(applyPageSizeMode(withMode(PAGE_SIZE_MODES.AUTO), stage))).not.toBe(fixed);
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
