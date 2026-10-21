/**
 * 翻页动效（D5）测试。
 *
 * 动效本身是 CSS 过渡，单测无法直接断言动画；这里验证：
 * - page 模式渲染了翻页过渡容器（`.bt-book-view__turn`），且分页内容正常；
 * - `usePrefersReducedMotion` 在减少动态效果 / 缺失能力下正确降级。
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { NODE_TYPES, createEmptyDocument } from '@bibliotype/core';
import { Reader, type BlockSizeEstimator } from '@bibliotype/reader';
import BtBookView from '../components/BtBookView.vue';
import { usePrefersReducedMotion } from '../prefers-reduced-motion.js';

function fixedEstimator(sizes: Record<string, number>): BlockSizeEstimator {
  return (node) => sizes[node.id ?? ''] ?? 100;
}

function makeReader(): Reader {
  const doc = createEmptyDocument({ title: '动效' });
  doc.root.children = [
    { type: NODE_TYPES.PARAGRAPH, id: 'p-1', children: [{ type: 'text', text: '甲' }] },
    { type: NODE_TYPES.PARAGRAPH, id: 'p-2', children: [{ type: 'text', text: '乙' }] },
    { type: NODE_TYPES.PARAGRAPH, id: 'p-3', children: [{ type: 'text', text: '丙' }] },
  ];
  const reader = new Reader({
    pageMainSize: 120,
    bottomSlack: 0,
    estimator: fixedEstimator({ 'p-1': 40, 'p-2': 40, 'p-3': 40 }),
  });
  reader.loadDocument(doc);
  return reader;
}

describe('BtBookView 翻页动效容器（D5）', () => {
  it('page 模式渲染翻页过渡容器且分页内容正常', async () => {
    const wrapper = mount(BtBookView, { props: { reader: makeReader(), mode: 'page', fontSize: 16 } });
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.bt-book-view__turn').exists()).toBe(true);
    expect(wrapper.find('.bt-reader-page').exists()).toBe(true);
  });

  it('scroll 模式不渲染翻页过渡容器', async () => {
    const wrapper = mount(BtBookView, { props: { reader: makeReader(), mode: 'scroll', fontSize: 16 } });
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.bt-book-view__turn').exists()).toBe(false);
    expect(wrapper.find('.bt-book-view--scroll').exists()).toBe(true);
  });
});

describe('usePrefersReducedMotion（D5）', () => {
  it('matchMedia 命中 reduce 时返回 true', () => {
    const mm = ((query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as (q: string) => MediaQueryList;
    const reduced = usePrefersReducedMotion({ matchMedia: mm });
    expect(reduced.value).toBe(true);
  });

  it('未命中时返回 false', () => {
    const mm = ((query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as (q: string) => MediaQueryList;
    const reduced = usePrefersReducedMotion({ matchMedia: mm });
    expect(reduced.value).toBe(false);
  });

  it('无 matchMedia 能力时回落 false（SSR / happy-dom）', () => {
    const reduced = usePrefersReducedMotion();
    expect(reduced.value).toBe(false);
  });
});
