/**
 * 组件测试（BtBookView / BtPager / BtToc）
 *
 * 覆盖：页内容渲染与样式表注入、翻页控件状态与交互、
 * 目录层级渲染与跳转。
 */
import { describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { NODE_TYPES, createEmptyDocument, type BookDocument } from '@bibliotype/core';
import { Reader, type BlockSizeEstimator } from '@bibliotype/reader';
import BtBookView from '../components/BtBookView.vue';
import BtPager from '../components/BtPager.vue';
import BtToc from '../components/BtToc.vue';

/** 固定尺寸估算器：按节点 id 取尺寸 */
function fixedEstimator(sizes: Record<string, number>): BlockSizeEstimator {
  return (node) => sizes[node.id ?? ''] ?? 50;
}

/** 构造：卷 > 章（标题 + 两段） + 章（一段） */
function sampleDoc(): BookDocument {
  const doc = createEmptyDocument({ title: '论语' });
  doc.root.children = [
    {
      type: NODE_TYPES.VOLUME,
      id: 'vol-1',
      attrs: { title: '卷一' },
      children: [
        {
          type: NODE_TYPES.CHAPTER,
          id: 'chap-1',
          attrs: { title: '学而第一' },
          children: [
            {
              type: NODE_TYPES.HEADING,
              id: 'h-1',
              children: [{ type: 'text', text: '学而第一' }],
            },
            {
              type: NODE_TYPES.PARAGRAPH,
              id: 'p-1',
              children: [{ type: 'text', text: '子曰' }],
            },
            {
              type: NODE_TYPES.PARAGRAPH,
              id: 'p-2',
              children: [{ type: 'text', text: '有朋自远方来' }],
            },
          ],
        },
        {
          type: NODE_TYPES.CHAPTER,
          id: 'chap-2',
          attrs: { title: '为政第二' },
          children: [
            {
              type: NODE_TYPES.PARAGRAPH,
              id: 'p-3',
              children: [{ type: 'text', text: '为政以德' }],
            },
          ],
        },
      ],
    },
  ];
  return doc;
}

/** 尺寸：h-1=30, p-1=60, p-2=60, p-3=100（页主轴 100，共 3 页） */
const SIZES = { 'h-1': 30, 'p-1': 60, 'p-2': 60, 'p-3': 100 };

/** 创建已载入样本的 Reader */
function createReader(): Reader {
  const reader = new Reader({ pageMainSize: 100, estimator: fixedEstimator(SIZES) });
  reader.loadDocument(sampleDoc());
  return reader;
}

describe('BtBookView', () => {
  it('渲染当前页内容、页框样式与书册样式表', () => {
    const reader = createReader();
    const wrapper = mount(BtBookView, { props: { reader } });

    const page = wrapper.find('.bt-reader-page');
    expect(page.exists()).toBe(true);
    expect(page.html()).toContain('bt-paragraph');
    expect(page.html()).toContain('子曰');
    /* 页框尺寸取布局页面尺寸（默认 A5：559×794） */
    expect(page.attributes('style')).toContain('width: 559px');
    /* 书册样式表已注入，且以 .bt-reader-page 为根容器 */
    const styleElement = document.getElementById('bt-book-css');
    expect(styleElement).not.toBeNull();
    expect(styleElement?.textContent).toContain('.bt-reader-page {');
    expect(styleElement?.textContent).toContain('--bt-font-family-body');
  });

  it('翻页后内容随之更新', async () => {
    const reader = createReader();
    const wrapper = mount(BtBookView, { props: { reader } });
    expect(wrapper.html()).toContain('子曰');

    reader.nextPage();
    await nextTick();
    expect(wrapper.html()).toContain('有朋自远方来');
    expect(wrapper.html()).not.toContain('子曰');
  });

  it('页脚页码随翻页更新', async () => {
    const reader = createReader();
    const wrapper = mount(BtBookView, { props: { reader } });

    const number = wrapper.find('.bt-page-number');
    expect(number.exists()).toBe(true);
    expect(number.text()).toBe('1');

    reader.nextPage();
    await nextTick();
    expect(wrapper.find('.bt-page-number').text()).toBe('2');
  });

  it('封面页不显示页脚页码', async () => {
    const doc = createEmptyDocument({ title: '带封面' });
    doc.root.children = [
      {
        type: NODE_TYPES.COVER,
        id: 'cover',
        children: [
          {
            type: NODE_TYPES.HEADING,
            id: 'cover-title',
            children: [{ type: 'text', text: '论语' }],
          },
        ],
      },
      {
        type: NODE_TYPES.VOLUME,
        id: 'vol-1',
        children: [
          { type: NODE_TYPES.PARAGRAPH, id: 'p-1', children: [{ type: 'text', text: '正文' }] },
        ],
      },
    ];
    const reader = new Reader({ pageMainSize: 100, estimator: fixedEstimator({}) });
    reader.loadDocument(doc);
    const wrapper = mount(BtBookView, { props: { reader } });

    expect(wrapper.find('.bt-page-number').exists()).toBe(false);

    reader.nextPage();
    await nextTick();
    expect(wrapper.find('.bt-page-number').exists()).toBe(true);
  });
});

describe('BtPager', () => {
  it('渲染页码状态并在首页禁用上一页', () => {
    const reader = createReader();
    const wrapper = mount(BtPager, { props: { reader } });
    const buttons = wrapper.findAll('button');

    expect(buttons).toHaveLength(2);
    expect(wrapper.text()).toContain('1 / 共 3 页');
    expect(buttons[0]?.attributes('disabled')).toBeDefined();
    expect(buttons[1]?.attributes('disabled')).toBeUndefined();
  });

  it('点击下一页更新页码', async () => {
    const reader = createReader();
    const wrapper = mount(BtPager, { props: { reader } });
    const nextButton = wrapper.findAll('button')[1];
    if (nextButton === undefined) throw new Error('未找到下一页按钮');

    await nextButton.trigger('click');
    expect(reader.currentPage).toBe(1);
    expect(wrapper.text()).toContain('2 / 共 3 页');
  });

  it('末页禁用下一页', async () => {
    const reader = createReader();
    const wrapper = mount(BtPager, { props: { reader } });

    reader.goToPage(2);
    await nextTick();
    const buttons = wrapper.findAll('button');
    expect(buttons[0]?.attributes('disabled')).toBeUndefined();
    expect(buttons[1]?.attributes('disabled')).toBeDefined();
  });
});

describe('BtToc', () => {
  it('渲染层级目录，点击跳转并抛出 select 事件', async () => {
    const reader = createReader();
    const wrapper = mount(BtToc, { props: { reader } });

    expect(wrapper.text()).toContain('卷一');
    expect(wrapper.text()).toContain('学而第一');
    expect(wrapper.text()).toContain('为政第二');

    const target = wrapper
      .findAll('button')
      .find((button) => button.text() === '为政第二');
    if (target === undefined) throw new Error('未找到目录项按钮');
    await target.trigger('click');

    /* chap-2 为结构容器，定位到其首叶（p-3）所在页 */
    expect(reader.currentPage).toBe(2);
    const emitted = wrapper.emitted('select');
    expect(emitted).toHaveLength(1);
    expect((emitted?.[0]?.[0] as { title: string }).title).toBe('为政第二');
  });
});
