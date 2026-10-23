/**
 * 开本适配（pageSizeMode）契约测试
 *
 * 守护三件事：
 * 1. 取值表与默认值——缺省即「固定」，旧快照与既有主题字面量才不会改视觉；
 * 2. 脏值过滤——持久化主体是自由键值，非法取值必须回落默认而非参与后续判定；
 * 3. 本轮边界——本字段不参与度量签名，切换适配不得触发重排（几何接线为后续批次，
 *    届时反向断言并把它纳入签名参与项）。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME } from '@bibliotype/core';
import {
  DEFAULT_PAGE_SIZE_MODE,
  PAGE_SIZE_MODES,
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
import { computeMetricsSignature } from '../metrics-signature.js';

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

describe('布局补丁合并与度量签名', () => {
  it('浅合并只改适配，不动开本与分栏', () => {
    const merged = mergeLayoutOptions(DEFAULT_LAYOUT_OPTIONS, { pageSizeMode: PAGE_SIZE_MODES.H5 });
    expect(merged.pageSizeMode).toBe(PAGE_SIZE_MODES.H5);
    expect(merged.pageSize).toBe(DEFAULT_LAYOUT_OPTIONS.pageSize);
    expect(merged.columns).toBe(DEFAULT_LAYOUT_OPTIONS.columns);
  });

  it('仅适配变化不改变度量签名（不触发重排）', () => {
    const base = computeMetricsSignature({ tokens: DEFAULT_THEME, options: DEFAULT_LAYOUT_OPTIONS });
    const modes: readonly PageSizeMode[] = [PAGE_SIZE_MODES.AUTO, PAGE_SIZE_MODES.H5];
    for (const mode of modes) {
      const options = mergeLayoutOptions(DEFAULT_LAYOUT_OPTIONS, { pageSizeMode: mode });
      expect(computeMetricsSignature({ tokens: DEFAULT_THEME, options })).toBe(base);
    }
  });
});
