/**
 * 滚动锁定测试（D5）
 *
 * - 加锁写入 body 的 fixed / overflow，解锁还原为原内联值；
 * - 计数锁：两把锁共存时先解一把不解锁，全部解完才恢复；
 * - 组件作用域销毁自动解锁（抽屉异常卸载不会把页面永久锁死）。
 *
 * 断言只看 `document.body.style` 与 `locked`，不依赖布局。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { useScrollLock, type UseScrollLock } from '../use-scroll-lock.js';

/** 在组件作用域内创建锁（onScopeDispose 需要宿主实例） */
function mountLock(): { wrapper: VueWrapper; api: UseScrollLock } {
  const holder: { api: UseScrollLock | null } = { api: null };
  const Probe = defineComponent({
    setup() {
      holder.api = useScrollLock();
      return () => h('div');
    },
  });
  const wrapper = mount(Probe);
  const api = holder.api;
  if (api === null) throw new Error('useScrollLock 未在 setup 中执行');
  return { wrapper, api };
}

afterEach(() => {
  document.body.removeAttribute('style');
});

describe('useScrollLock（D5）', () => {
  it('加锁固定 body，解锁还原', () => {
    const { wrapper, api } = mountLock();
    expect(api.locked.value).toBe(false);

    api.lock();
    expect(api.locked.value).toBe(true);
    expect(document.body.style.position).toBe('fixed');
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.body.style.overscrollBehavior).toBe('none');

    api.unlock();
    expect(api.locked.value).toBe(false);
    expect(document.body.style.position).toBe('');
    expect(document.body.style.overflow).toBe('');
    wrapper.unmount();
  });

  it('计数锁：全部解完才真正恢复滚动', () => {
    const first = mountLock();
    const second = mountLock();

    first.api.lock();
    second.api.lock();
    expect(document.body.style.overflow).toBe('hidden');

    // 先解一把：仍在锁定态
    first.api.unlock();
    expect(first.api.locked.value).toBe(false);
    expect(second.api.locked.value).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');

    second.api.unlock();
    expect(second.api.locked.value).toBe(false);
    expect(document.body.style.overflow).toBe('');

    first.wrapper.unmount();
    second.wrapper.unmount();
  });

  it('还原加锁前的内联样式，不污染宿主', () => {
    document.body.style.overflow = 'scroll';
    document.body.style.width = '90%';

    const { wrapper, api } = mountLock();
    api.lock();
    expect(document.body.style.overflow).toBe('hidden');

    api.unlock();
    expect(document.body.style.overflow).toBe('scroll');
    expect(document.body.style.width).toBe('90%');
    wrapper.unmount();
  });

  it('作用域销毁时自动解锁', () => {
    const { wrapper, api } = mountLock();
    api.lock();
    expect(document.body.style.overflow).toBe('hidden');

    wrapper.unmount();
    expect(api.locked.value).toBe(false);
    expect(document.body.style.overflow).toBe('');
  });
});
