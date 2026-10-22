/**
 * 断点体系测试（D1）
 *
 * - `resolveBreakpointName` 在 md / lg 阈值上的分档边界；
 * - `useBreakpoint` 读取注入宿主（宽高 / 粗指针 / 竖屏）；
 * - resize 后宽度、档位、revision 同步（首次同步不算「视口变更」）；
 * - 宿主缺 matchMedia / rAF 时不崩（SSR 与轻量环境口径）。
 *
 * 断言依赖公开返回值，不触碰内部 ref；宿主由测试注入，避免依赖真实窗口。
 */
import { describe, expect, it } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { BT_BREAKPOINTS, resolveBreakpointName } from '../breakpoints.js';
import { useBreakpoint, type BreakpointHost, type UseBreakpoint } from '../use-breakpoint.js';

/** 假窗口宿主：尺寸由测试改写，监听器自行收集与派发 */
interface FakeHost {
  /** 传给组合式的宿主 */
  host: BreakpointHost;
  /** 改视口尺寸并派发一次 resize */
  resize: (width: number, height?: number) => void;
}

/**
 * 造一个假宿主
 *
 * @param width 初始视口宽（px）
 * @param height 初始视口高（px）
 * @param media 媒体查询命中表（缺省只命中 `(pointer: coarse)`）
 */
function createHost(
  width: number,
  height = 812,
  media: (query: string) => boolean = (query) => query === '(pointer: coarse)',
): FakeHost {
  let innerWidth = width;
  let innerHeight = height;
  const listeners = new Map<string, Array<() => void>>();

  const host: BreakpointHost = {
    get innerWidth(): number {
      return innerWidth;
    },
    get innerHeight(): number {
      return innerHeight;
    },
    matchMedia(query: string): MediaQueryList {
      // 只要 matches 与增删监听可用即可，其余成员按 MediaQueryList 形状占位
      return {
        matches: media(query),
        media: query,
        onchange: null,
        addEventListener: (): void => {},
        removeEventListener: (): void => {},
        addListener: (): void => {},
        removeListener: (): void => {},
        dispatchEvent: (): boolean => false,
      } as unknown as MediaQueryList;
    },
    addEventListener(type: string, listener: () => void): void {
      const list = listeners.get(type);
      if (list === undefined) listeners.set(type, [listener]);
      else list.push(listener);
    },
    removeEventListener(type: string, listener: () => void): void {
      const list = listeners.get(type);
      if (list === undefined) return;
      const index = list.indexOf(listener);
      if (index >= 0) list.splice(index, 1);
    },
    // 帧调度同步执行：断言无需等待 rAF
    requestAnimationFrame(callback: () => void): number {
      callback();
      return 0;
    },
    cancelAnimationFrame(): void {},
  };

  return {
    host,
    resize(nextWidth: number, nextHeight = innerHeight): void {
      innerWidth = nextWidth;
      innerHeight = nextHeight;
      for (const listener of [...(listeners.get('resize') ?? [])]) listener();
    },
  };
}

/**
 * 挂载探针组件并取回组合式结果
 *
 * `useBreakpoint` 依赖 onMounted / onScopeDispose，必须在组件作用域内调用。
 *
 * @param host 注入的假宿主
 */
function mountProbe(host: BreakpointHost): { wrapper: VueWrapper; api: UseBreakpoint } {
  const holder: { api: UseBreakpoint | null } = { api: null };
  const Probe = defineComponent({
    setup() {
      holder.api = useBreakpoint({ host });
      return () => h('div');
    },
  });
  const wrapper = mount(Probe);
  const api = holder.api;
  if (api === null) throw new Error('useBreakpoint 未在 setup 中执行');
  return { wrapper, api };
}

describe('resolveBreakpointName（D1）', () => {
  it('按 md / lg 阈值分三档', () => {
    expect(BT_BREAKPOINTS.md).toBe(768);
    expect(resolveBreakpointName(375)).toBe('mobile');
    expect(resolveBreakpointName(BT_BREAKPOINTS.md - 1)).toBe('mobile');
    expect(resolveBreakpointName(BT_BREAKPOINTS.md)).toBe('tablet');
    expect(resolveBreakpointName(BT_BREAKPOINTS.lg - 1)).toBe('tablet');
    expect(resolveBreakpointName(BT_BREAKPOINTS.lg)).toBe('desktop');
  });
});

describe('useBreakpoint（D1）', () => {
  it('移动视口 + 粗指针 → isMobile / coarsePointer', () => {
    const { host } = createHost(375);
    const { wrapper, api } = mountProbe(host);

    expect(api.width.value).toBe(375);
    expect(api.height.value).toBe(812);
    expect(api.name.value).toBe('mobile');
    expect(api.isMobile.value).toBe(true);
    expect(api.isTablet.value).toBe(false);
    expect(api.coarsePointer.value).toBe(true);
    wrapper.unmount();
  });

  it('resize 更新档位并使 revision 自增（首次同步不计）', () => {
    const fake = createHost(375);
    const { wrapper, api } = mountProbe(fake.host);
    expect(api.revision.value).toBe(0);

    fake.resize(900, 812);
    expect(api.width.value).toBe(900);
    expect(api.name.value).toBe('tablet');
    expect(api.revision.value).toBe(1);

    fake.resize(1280, 800);
    expect(api.isDesktop.value).toBe(true);
    expect(api.revision.value).toBe(2);
    wrapper.unmount();
  });

  it('竖屏媒体查询写入 portrait', () => {
    const { host } = createHost(375, 812, (query) => query === '(orientation: portrait)');
    const { wrapper, api } = mountProbe(host);

    expect(api.portrait.value).toBe(true);
    expect(api.coarsePointer.value).toBe(false);
    wrapper.unmount();
  });

  it('宿主缺 matchMedia / rAF 时按桌面口径不崩', () => {
    const { wrapper, api } = mountProbe({ innerWidth: 1024, innerHeight: 768 });

    expect(api.isDesktop.value).toBe(true);
    expect(api.portrait.value).toBe(false);
    expect(api.coarsePointer.value).toBe(false);
    wrapper.unmount();
  });
});
