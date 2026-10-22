/**
 * BtBookView 点按分区测试（A3）
 *
 * happy-dom 没有布局，`getBoundingClientRect()` 固定返回 0 宽 —— 分区比例算不出来。
 * 这里把分页容器 mock 成 300px 宽，才能验证「左 / 右边缘 20% 翻页、中部 tap-center」。
 */
import { describe, expect, it } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import { NODE_TYPES, createEmptyDocument } from '@bibliotype/core';
import { Reader, type BlockSizeEstimator } from '@bibliotype/reader';
import BtBookView from '../components/BtBookView.vue';

/** mock 出的阅读区宽度 */
const PAGE_WIDTH = 300;

function makeReader(): Reader {
  const doc = createEmptyDocument({ title: '点按' });
  doc.root.children = [
    {
      type: NODE_TYPES.CHAPTER,
      id: 'ch-1',
      attrs: { title: '第一章' },
      children: [1, 2, 3, 4].map((index) => ({
        type: NODE_TYPES.PARAGRAPH,
        id: `p-${index}`,
        children: [{ type: 'text', text: `正文${index}` }],
      })),
    },
  ];
  const estimator: BlockSizeEstimator = () => 100;
  const reader = new Reader({ pageMainSize: 100, bottomSlack: 0, estimator });
  reader.loadDocument(doc);
  return reader;
}

/**
 * 挂载并把阅读区尺寸 mock 成 PAGE_WIDTH
 *
 * @param page 进入后先跳到的页（0 起）
 */
function mountView(page = 1): { wrapper: VueWrapper; reader: Reader; stage: HTMLElement } {
  const reader = makeReader();
  const wrapper = mount(BtBookView, { props: { reader } });
  reader.goToPage(page);

  const stage = wrapper.find('.bt-book-view--paged').element as HTMLElement;
  stage.getBoundingClientRect = (): DOMRect =>
    ({
      left: 0,
      top: 0,
      width: PAGE_WIDTH,
      height: 400,
      right: PAGE_WIDTH,
      bottom: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  return { wrapper, reader, stage };
}

/**
 * 在阅读区横坐标处点一下
 *
 * @param stage 分页容器
 * @param clientX 视口横坐标
 */
function tap(stage: HTMLElement, clientX: number): void {
  stage.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX }));
}

describe('BtBookView 点按分区（A3）', () => {
  it('左边缘点击翻到上一页', async () => {
    const { wrapper, stage } = mountView(1);
    await nextTick();

    tap(stage, PAGE_WIDTH * 0.1);
    await nextTick();

    const pages = wrapper.emitted('update:page') ?? [];
    expect(pages[pages.length - 1]).toEqual([0]);
    expect(wrapper.emitted('tap-center')).toBeUndefined();
  });

  it('右边缘点击翻到下一页', async () => {
    const { wrapper, stage } = mountView(1);
    await nextTick();

    tap(stage, PAGE_WIDTH * 0.9);
    await nextTick();

    const pages = wrapper.emitted('update:page') ?? [];
    expect(pages[pages.length - 1]).toEqual([2]);
    expect(wrapper.emitted('tap-center')).toBeUndefined();
  });

  it('中部点击只发 tap-center，不翻页', async () => {
    const { wrapper, stage } = mountView(1);
    await nextTick();
    // 挂载后 goToPage(1) 已发过一次 update:page，量增量才准
    const before = (wrapper.emitted('update:page') ?? []).length;

    tap(stage, PAGE_WIDTH * 0.5);
    await nextTick();

    expect(wrapper.emitted('tap-center')).toHaveLength(1);
    expect((wrapper.emitted('update:page') ?? []).length).toBe(before);
  });

  it('点中按钮等交互元素时不分区', async () => {
    const { wrapper, stage } = mountView(1);
    await nextTick();
    const before = (wrapper.emitted('update:page') ?? []).length;

    const button = document.createElement('button');
    stage.appendChild(button);
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: PAGE_WIDTH * 0.9 }));
    await nextTick();

    expect(wrapper.emitted('tap-center')).toBeUndefined();
    expect((wrapper.emitted('update:page') ?? []).length).toBe(before);
  });
});
