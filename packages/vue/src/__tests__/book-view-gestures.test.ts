/**
 * BtBookView 手势与键盘测试（D4）
 *
 * - 双指缩放：手势 → 字号 emit（含区间夹紧）；
 * - 滚动模式：PageDown / 空格滚动一屏，带修饰键不拦截。
 */
import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { NODE_TYPES, createEmptyDocument } from '@bibliotype/core';
import { Reader, type BlockSizeEstimator } from '@bibliotype/reader';
import BtBookView from '../components/BtBookView.vue';

function fixedEstimator(sizes: Record<string, number>): BlockSizeEstimator {
  return (node) => sizes[node.id ?? ''] ?? 100;
}

function makeReader(): Reader {
  const doc = createEmptyDocument({ title: '手势' });
  doc.root.children = [
    {
      type: NODE_TYPES.CHAPTER,
      id: 'ch-1',
      attrs: { title: '第一章' },
      children: [
        { type: NODE_TYPES.PARAGRAPH, id: 'p-1', children: [{ type: 'text', text: '正文一' }] },
        { type: NODE_TYPES.PARAGRAPH, id: 'p-2', children: [{ type: 'text', text: '正文二' }] },
      ],
    },
  ];
  const reader = new Reader({
    pageMainSize: 300,
    bottomSlack: 0,
    estimator: fixedEstimator({ 'p-1': 100, 'p-2': 100 }),
  });
  reader.loadDocument(doc);
  return reader;
}

function touchEvent(type: string, points: { x: number; y: number }[]): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const touches = points.map((point) => ({ clientX: point.x, clientY: point.y }));
  Object.defineProperty(event, 'touches', { value: touches });
  Object.defineProperty(event, 'changedTouches', { value: touches });
  return event;
}

describe('BtBookView 双指缩放（D4）', () => {
  it('间距放大 1.5 倍 → 字号 24', async () => {
    const wrapper = mount(BtBookView, { props: { reader: makeReader(), fontSize: 16 } });
    const stage = wrapper.find('.bt-book-view--paged');
    stage.element.dispatchEvent(
      touchEvent('touchstart', [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ]),
    );
    stage.element.dispatchEvent(
      touchEvent('touchmove', [
        { x: 0, y: 0 },
        { x: 150, y: 0 },
      ]),
    );
    expect(wrapper.emitted('update:fontSize')?.[0]?.[0]).toBe(24);
  });

  it('超出上限夹紧到 32', async () => {
    const wrapper = mount(BtBookView, { props: { reader: makeReader(), fontSize: 16 } });
    const stage = wrapper.find('.bt-book-view--paged');
    stage.element.dispatchEvent(
      touchEvent('touchstart', [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ]),
    );
    stage.element.dispatchEvent(
      touchEvent('touchmove', [
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
      ]),
    );
    expect(wrapper.emitted('update:fontSize')?.[0]?.[0]).toBe(32);
  });

  it('单指不触发字号变更', () => {
    const wrapper = mount(BtBookView, { props: { reader: makeReader(), fontSize: 16 } });
    const stage = wrapper.find('.bt-book-view--paged');
    stage.element.dispatchEvent(touchEvent('touchstart', [{ x: 0, y: 0 }]));
    stage.element.dispatchEvent(touchEvent('touchmove', [{ x: 40, y: 0 }]));
    expect(wrapper.emitted('update:fontSize')).toBeUndefined();
  });
});

describe('BtBookView 对页（B4）', () => {
  function makeMultiPageReader(): Reader {
    const doc = createEmptyDocument({ title: '对页' });
    doc.root.children = [
      {
        type: NODE_TYPES.CHAPTER,
        id: 'ch-1',
        attrs: { title: '第一章' },
        children: [1, 2, 3, 4].map((n) => ({
          type: NODE_TYPES.PARAGRAPH,
          id: `p-${n}`,
          children: [{ type: 'text', text: `正文${n}` }],
        })),
      },
    ];
    const sizes: Record<string, number> = { 'p-1': 200, 'p-2': 200, 'p-3': 200, 'p-4': 200 };
    const reader = new Reader({ pageMainSize: 300, bottomSlack: 0, estimator: (node) => sizes[node.id ?? ''] ?? 200 });
    reader.loadDocument(doc);
    return reader;
  }

  it('facing 模式一次渲染两页', () => {
    const wrapper = mount(BtBookView, {
      props: { reader: makeMultiPageReader(), spread: 'facing' },
    });
    expect(wrapper.findAll('.bt-reader-page')).toHaveLength(2);
  });

  it('single 模式仅渲染一页', () => {
    const wrapper = mount(BtBookView, {
      props: { reader: makeMultiPageReader(), spread: 'single' },
    });
    expect(wrapper.findAll('.bt-reader-page')).toHaveLength(1);
  });
});

describe('BtBookView 滚动键盘（D4）', () => {
  it('PageDown 滚动一屏', async () => {
    const wrapper = mount(BtBookView, { props: { reader: makeReader(), mode: 'scroll' } });
    const scroller = wrapper.find('.bt-book-view--scroll').element as HTMLElement;
    Object.defineProperty(scroller, 'clientHeight', { value: 500, configurable: true });
    const scrollBy = vi.fn();
    scroller.scrollBy = scrollBy;

    const event = new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true, cancelable: true });
    scroller.dispatchEvent(event);

    expect(scrollBy).toHaveBeenCalledWith({ left: 0, top: 500 });
    expect(event.defaultPrevented).toBe(true);
  });

  it('带 Ctrl 的组合键不拦截', () => {
    const wrapper = mount(BtBookView, { props: { reader: makeReader(), mode: 'scroll' } });
    const scroller = wrapper.find('.bt-book-view--scroll').element as HTMLElement;
    Object.defineProperty(scroller, 'clientHeight', { value: 500, configurable: true });
    const scrollBy = vi.fn();
    scroller.scrollBy = scrollBy;

    const event = new KeyboardEvent('keydown', {
      key: 'PageDown',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    scroller.dispatchEvent(event);

    expect(scrollBy).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});
