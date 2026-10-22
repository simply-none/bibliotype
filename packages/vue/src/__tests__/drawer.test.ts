/**
 * 抽屉容器测试（A4 / B5 / D5）
 *
 * - 语义钩子：`role="dialog"` / `aria-modal` / `aria-label` / `data-side` / `data-open`；
 * - 关闭途径：遮罩、关闭按钮、Esc（`maskClosable=false` 时遮罩失效）；
 * - 滚动锁定：打开锁 body，关闭或卸载后恢复；
 * - 底部 sheet 吸附：拖拽把手上拉后 `data-snap` 升档，关闭后复位到最低档；
 * - 边缘呼出：关闭态从边缘向内滑发 `update:open`，`edgeSwipe=false` 时不响应。
 *
 * happy-dom 没有布局：`getBoundingClientRect()` 全 0，拖拽高度只按指针位移推算，
 * 因此断言看档位与 style 高度，不看像素位置。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import BtDrawer from '../components/BtDrawer.vue';

let wrapper: VueWrapper | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = '';
  document.body.removeAttribute('style');
});

function mountDrawer(props: Record<string, unknown> = {}): VueWrapper {
  return mount(BtDrawer, {
    props: { open: true, ...props },
    slots: { default: '<p class="probe">面板内容</p>' },
    attachTo: document.body,
  });
}

function query<T extends HTMLElement>(selector: string): T {
  const el = document.body.querySelector(selector);
  if (el === null) throw new Error(`未找到 ${selector}`);
  return el as T;
}

/** 造带 clientY 的指针事件（happy-dom 无 PointerEvent 构造器） */
function pointerEvent(type: string, clientY: number): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clientY', { value: clientY });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  return event;
}

/** 造单点触摸事件 */
function touchEvent(type: string, clientX: number, clientY = 400): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', { value: [{ clientX, clientY }] });
  Object.defineProperty(event, 'changedTouches', { value: [{ clientX, clientY }] });
  return event;
}

describe('BtDrawer 容器语义（A4 / D5）', () => {
  it('open=false 不渲染，open=true 暴露 dialog 语义', async () => {
    wrapper = mountDrawer({ open: false, title: '目录', side: 'start' });
    await nextTick();
    expect(document.body.querySelector('.bt-drawer')).toBeNull();

    await wrapper.setProps({ open: true });
    await nextTick();

    const root = query('.bt-drawer');
    expect(root.dataset.open).toBe('true');
    expect(root.dataset.side).toBe('start');
    expect(root.classList.contains('bt-drawer--start')).toBe(true);

    const panel = query('.bt-drawer__panel');
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-modal')).toBe('true');
    expect(panel.getAttribute('aria-label')).toBe('目录');
    expect(query('.probe').textContent).toBe('面板内容');
  });

  it('点遮罩 / 关闭按钮发 close 与 update:open', async () => {
    wrapper = mountDrawer({ title: '目录' });
    await nextTick();

    query('.bt-drawer__mask').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(wrapper.emitted('update:open')?.[0]).toEqual([false]);
    expect(wrapper.emitted('close')).toHaveLength(1);

    query('.bt-drawer__close').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(wrapper.emitted('close')).toHaveLength(2);
  });

  it('maskClosable=false 时点遮罩不关闭', async () => {
    wrapper = mountDrawer({ maskClosable: false });
    await nextTick();

    query('.bt-drawer__mask').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(wrapper.emitted('close')).toBeUndefined();
  });

  it('Esc 关闭', async () => {
    wrapper = mountDrawer();
    await nextTick();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await nextTick();
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('打开锁 body，关闭与卸载都恢复', async () => {
    wrapper = mountDrawer();
    await nextTick();
    expect(document.body.style.overflow).toBe('hidden');

    await wrapper.setProps({ open: false });
    await nextTick();
    expect(document.body.style.overflow).toBe('');

    await wrapper.setProps({ open: true });
    await nextTick();
    expect(document.body.style.overflow).toBe('hidden');

    wrapper.unmount();
    wrapper = null;
    expect(document.body.style.overflow).toBe('');
  });
});

describe('BtDrawer 底部 sheet 吸附（B5）', () => {
  it('拖拽把手上拉后升到下一档，关闭后复位', async () => {
    wrapper = mountDrawer({ side: 'bottom', snapHeights: ['48vh', '92vh'] });
    await nextTick();

    const panel = query('.bt-drawer__panel');
    const grabber = query('.bt-drawer__grabber');
    expect(panel.style.height).toBe('48vh');
    expect(grabber.getAttribute('data-snap')).toBe('0');

    // 向上拖动 680px：落在 92vh 档（happy-dom 视口高 768）
    grabber.dispatchEvent(pointerEvent('pointerdown', 700));
    grabber.dispatchEvent(pointerEvent('pointermove', 20));
    grabber.dispatchEvent(pointerEvent('pointerup', 20));
    await nextTick();

    expect(grabber.getAttribute('data-snap')).toBe('1');
    expect(panel.style.height).toBe('92vh');

    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true });
    await nextTick();
    expect(query('.bt-drawer__grabber').getAttribute('data-snap')).toBe('0');
  });

  it('未传 snapHeights 时不渲染把手', async () => {
    wrapper = mountDrawer({ side: 'bottom' });
    await nextTick();
    expect(document.body.querySelector('.bt-drawer__grabber')).toBeNull();
  });
});

describe('BtDrawer 边缘手势呼出（A4）', () => {
  it('关闭态从起点边缘向内滑发 update:open', async () => {
    wrapper = mountDrawer({ open: false, side: 'start' });
    await nextTick();

    document.dispatchEvent(touchEvent('touchstart', 10));
    document.dispatchEvent(touchEvent('touchmove', 90));
    await nextTick();

    expect(wrapper.emitted('update:open')?.[0]).toEqual([true]);
  });

  it('edgeSwipe=false 时不响应边缘手势', async () => {
    wrapper = mountDrawer({ open: false, side: 'start', edgeSwipe: false });
    await nextTick();

    document.dispatchEvent(touchEvent('touchstart', 10));
    document.dispatchEvent(touchEvent('touchmove', 90));
    await nextTick();

    expect(wrapper.emitted('update:open')).toBeUndefined();
  });

  it('打开态忽略边缘手势', async () => {
    wrapper = mountDrawer({ open: true, side: 'start' });
    await nextTick();

    document.dispatchEvent(touchEvent('touchstart', 10));
    document.dispatchEvent(touchEvent('touchmove', 90));
    await nextTick();

    expect(wrapper.emitted('update:open')).toBeUndefined();
  });
});
