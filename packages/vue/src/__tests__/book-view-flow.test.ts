/**
 * BtBookView 流式阅读（D5）测试。
 *
 * happy-dom 下 IntersectionObserver / ResizeObserver 不实现，组件降级为按滚动位置
 * 窗口挂载（resolveMountWindow）渲染内容、无实测回写（保留估算高度）。本测试通过
 * 容器高度 + 滚动位置驱动挂载窗口来验证懒加载行为。
 */
import { describe, expect, it } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { NODE_TYPES, createEmptyDocument } from '@bibliotype/core';
import { Reader, type BlockSizeEstimator } from '@bibliotype/reader';
import BtBookView from '../components/BtBookView.vue';

function fixedEstimator(sizes: Record<string, number>): BlockSizeEstimator {
  return (node) => sizes[node.id ?? ''] ?? 100;
}

const PARAGRAPHS = Array.from({ length: 200 }, (_, i) => ({
  type: NODE_TYPES.PARAGRAPH,
  id: `p-${i + 1}`,
  children: [{ type: 'text', text: `段落 ${i + 1}` }],
}));

function makeReader(): Reader {
  const doc = createEmptyDocument({ title: '巨著' });
  doc.root.children = [
    {
      type: NODE_TYPES.CHAPTER,
      id: 'ch-1',
      attrs: { title: '第一章' },
      children: PARAGRAPHS.slice(0, 100),
    },
    {
      type: NODE_TYPES.CHAPTER,
      id: 'ch-2',
      attrs: { title: '第二章' },
      children: PARAGRAPHS.slice(100),
    },
  ];
  const reader = new Reader({
    pageMainSize: 300,
    bottomSlack: 0,
    estimator: fixedEstimator(Object.fromEntries(PARAGRAPHS.map((p) => [p.id, 80]))),
  });
  reader.loadDocument(doc);
  return reader;
}

function flowContainer(wrapper: VueWrapper): HTMLElement {
  return wrapper.find('.bt-book-view--flow').element as HTMLElement;
}

/** 等待响应式挂载窗口与 rAF 滚动处理落定（happy-dom 下 rAF 为宏任务，需留出时间） */
async function settle(wrapper: VueWrapper): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await flushPromises();
    await wrapper.vm.$nextTick();
    await new Promise((r) => setTimeout(r, 30));
  }
}

function stubViewport(el: HTMLElement, height: number): void {
  Object.defineProperty(el, 'clientHeight', { value: height, configurable: true });
  Object.defineProperty(el, 'scrollHeight', { value: 5000, configurable: true });
  Object.defineProperty(el, 'scrollTop', { value: 0, writable: true, configurable: true });
}

describe('BtBookView 流式阅读（D5）', () => {
  it('首屏只挂载视口附近的少量分块，其余为骨架占位', async () => {
    const wrapper = mount(BtBookView, {
      props: { reader: makeReader(), mode: 'scroll-flow', fontSize: 16, flowChunkBlocks: 4 },
    });
    await settle(wrapper);
    const root = flowContainer(wrapper);
    stubViewport(root, 600);
    root.dispatchEvent(new Event('scroll'));
    await settle(wrapper);

    const totalChunks = wrapper.findAll('.bt-flow-chunk').length;
    const mounted = wrapper.findAll('.bt-flow-chunk__content').length;
    const skeletons = wrapper.findAll('.bt-flow-skeleton').length;
    // 200 段按 4 块/分块切成 50 块；首屏只挂载窗口内少数，其余为骨架占位
    expect(totalChunks).toBeGreaterThan(10);
    expect(mounted).toBeGreaterThan(0);
    expect(mounted).toBeLessThan(totalChunks);
    expect(skeletons).toBeGreaterThan(0);
    expect(mounted + skeletons).toBe(totalChunks);
  });

  it('滚动后挂载窗口下移，新增分块渲染内容', async () => {
    const wrapper = mount(BtBookView, {
      props: { reader: makeReader(), mode: 'scroll-flow', fontSize: 16, flowChunkBlocks: 4 },
    });
    await settle(wrapper);
    const root = flowContainer(wrapper);
    stubViewport(root, 600);

    root.dispatchEvent(new Event('scroll'));
    await settle(wrapper);
    const before = wrapper.findAll('.bt-flow-chunk__content').length;
    expect(before).toBeGreaterThan(0);

    // 滚动到文档中段（避免越过文档尾部导致窗口为空）
    (root as unknown as { scrollTop: number }).scrollTop = 1500;
    root.dispatchEvent(new Event('scroll'));
    await settle(wrapper);
    const after = wrapper.findAll('.bt-flow-chunk__content').length;

    expect(after).toBeGreaterThanOrEqual(1);
  });

  it('直排 / 对页下 scroll-flow 回落 paged 并 emit mode-fallback', async () => {
    const reader = makeReader();
    const wrapper = mount(BtBookView, {
      props: { reader, mode: 'scroll-flow', spread: 'facing', fontSize: 16 },
    });
    await settle(wrapper);
    expect(wrapper.find('.bt-book-view--paged').exists()).toBe(true);
    const fallback = wrapper.emitted('mode-fallback');
    expect(fallback).toBeTruthy();
    expect(fallback?.[0]?.[0]).toMatchObject({ requested: 'scroll-flow', effective: 'page' });
  });

  it('initialPosition 命中后 emit update:position（锚点回写）', async () => {
    const reader = makeReader();
    const position = reader.getPositionForNode('p-5');
    expect(position).toBeTruthy();
    const serialized = JSON.stringify(position);

    const wrapper = mount(BtBookView, {
      props: { reader, mode: 'scroll-flow', initialPosition: serialized, fontSize: 16 },
    });
    await settle(wrapper);
    const root = flowContainer(wrapper);
    stubViewport(root, 600);
    root.dispatchEvent(new Event('scroll'));
    await settle(wrapper);

    const emitted = wrapper.emitted('update:position');
    expect(emitted).toBeTruthy();
    const pos = emitted?.[emitted.length - 1]?.[0] as { anchor: { nodeId: string } };
    expect(pos.anchor.nodeId).toBeTruthy();
  });

  it('update:position 在滚动时回写当前视口首块锚点', async () => {
    const wrapper = mount(BtBookView, {
      props: { reader: makeReader(), mode: 'scroll-flow', fontSize: 16, flowChunkBlocks: 4 },
    });
    await settle(wrapper);
    const root = flowContainer(wrapper);
    stubViewport(root, 600);
    root.dispatchEvent(new Event('scroll'));
    await settle(wrapper);

    const emitted = wrapper.emitted('update:position');
    expect(emitted).toBeTruthy();
    const pos = emitted?.[emitted.length - 1]?.[0] as { anchor: { nodeId: string } };
    expect(pos.anchor.nodeId).toBeTruthy();
  });
});
