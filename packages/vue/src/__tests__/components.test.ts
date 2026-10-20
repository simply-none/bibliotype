/**
 * 组件测试（BtBookView / BtPager / BtToc）
 *
 * 覆盖：页内容渲染与样式表注入、翻页控件状态与交互、
 * 目录层级渲染与跳转。
 */
import { describe, expect, it, vi } from 'vitest';
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

/** N 段各占一页（每段尺寸 = 页主轴）：构造多页文档供虚拟化测试 */
function createPagedReader(pageCount: number): Reader {
  const sizes: Record<string, number> = {};
  const children = [];
  for (let i = 0; i < pageCount; i += 1) {
    const id = `p-${i}`;
    sizes[id] = 100;
    children.push({
      type: NODE_TYPES.PARAGRAPH,
      id,
      children: [{ type: 'text', text: `第${i}页` }],
    });
  }
  const doc = createEmptyDocument({ title: '多页' });
  doc.root.children = [{ type: NODE_TYPES.VOLUME, id: 'vol', children }];
  const reader = new Reader({ pageMainSize: 100, estimator: fixedEstimator(sizes) });
  reader.loadDocument(doc);
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

  it('scroll 模式：一次渲染全部分页且页脚逐页标页码', () => {
    const reader = createReader();
    const wrapper = mount(BtBookView, { props: { reader, mode: 'scroll' } });

    const slots = wrapper.findAll('.bt-scroll__slot');
    expect(slots).toHaveLength(3);
    // 全部内容同屏出现（不再仅限当前页）
    const html = wrapper.html();
    expect(html).toContain('子曰');
    expect(html).toContain('有朋自远方来');
    expect(html).toContain('为政以德');
    // 每页各带页脚页码 1 / 2 / 3
    const numbers = wrapper.findAll('.bt-page-number').map((node) => node.text());
    expect(numbers).toEqual(['1', '2', '3']);
  });

  it('scroll 模式：外部翻页为当前槽位高亮 is-active', async () => {
    const reader = createReader();
    const wrapper = mount(BtBookView, { props: { reader, mode: 'scroll' } });

    const active = () =>
      wrapper.findAll('.bt-scroll__slot').findIndex((node) => node.classes().includes('is-active'));
    expect(active()).toBe(0);

    reader.goToPage(2);
    await nextTick();
    expect(active()).toBe(2);
  });

  it('scroll 模式：窗口化只渲染可见页，轨道高度仍反映总页数', () => {
    const reader = createPagedReader(20);
    const wrapper = mount(BtBookView, { props: { reader, mode: 'scroll' } });

    expect(reader.totalPages).toBe(20);
    // 视口高度 0（happy-dom）：仅首页 + overscan 渲染，远少于 20 页
    const slots = wrapper.findAll('.bt-scroll__slot');
    expect(slots.length).toBeLessThan(20);
    expect(slots.length).toBeGreaterThan(0);
    // 轨道内联高度按 20 页总高撑出真实滚动条
    const trackStyle = wrapper.find('.bt-scroll__track').attributes('style') ?? '';
    expect(trackStyle).toMatch(/height: \d+p[xt]/);
    const heightPx = Number(/height: (\d+(?:\.\d+)?)px/.exec(trackStyle)?.[1] ?? '0');
    expect(heightPx).toBeGreaterThan(20 * 100); // 至少能容纳 20 个页位
  });

  it('page 模式滚轮翻页：达阈向下翻下一页、向上翻上一页，未达阈不翻', async () => {
    vi.useFakeTimers();
    try {
      const reader = createPagedReader(5);
      const wrapper = mount(BtBookView, { props: { reader, mode: 'page' } });
      const view = wrapper.find('.bt-book-view');

      // 不足累计阈值（120）：同向两小格共 100 仍不翻页
      await view.trigger('wheel', { deltaY: 50 });
      await view.trigger('wheel', { deltaY: 50 });
      expect(reader.currentPage).toBe(0);

      // 足够一格：向下拨 = 向前翻页
      await view.trigger('wheel', { deltaY: 200 });
      expect(reader.currentPage).toBe(1);

      // 冷却（320ms）内后续滚动不连翻（同一帧内连发多格惯性尾巴）
      await view.trigger('wheel', { deltaY: 200 });
      expect(reader.currentPage).toBe(1);

      // 反向：绕过冷却后向上拨 = 回上一页
      vi.advanceTimersByTime(400);
      await view.trigger('wheel', { deltaY: -300 });
      expect(reader.currentPage).toBe(0);

      // 首页再向上不越界（prevPage 失败，页态不变）
      vi.advanceTimersByTime(400);
      await view.trigger('wheel', { deltaY: -300 });
      expect(reader.currentPage).toBe(0);
    } finally {
      vi.useRealTimers();
    }
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

describe('BtBookView 键盘与触屏翻页', () => {
  it('方向键 / PageDown / 空格翻页，首页向上不越界', async () => {
    const reader = createReader();
    const wrapper = mount(BtBookView, { props: { reader } });
    const root = wrapper.find('.bt-book-view--paged');

    await root.trigger('keydown', { key: 'ArrowRight' });
    expect(reader.currentPage).toBe(1);
    await root.trigger('keydown', { key: 'PageDown' });
    expect(reader.currentPage).toBe(2);
    await root.trigger('keydown', { key: 'ArrowLeft' });
    expect(reader.currentPage).toBe(1);
    await root.trigger('keydown', { key: ' ' });
    expect(reader.currentPage).toBe(2);
  });

  it('Home / End 跳首末页', async () => {
    const reader = createReader();
    const wrapper = mount(BtBookView, { props: { reader } });
    const root = wrapper.find('.bt-book-view--paged');

    await root.trigger('keydown', { key: 'End' });
    expect(reader.currentPage).toBe(2);
    await root.trigger('keydown', { key: 'Home' });
    expect(reader.currentPage).toBe(0);
  });

  it('带修饰键的组合不拦截翻页', async () => {
    const reader = createReader();
    const wrapper = mount(BtBookView, { props: { reader } });
    const root = wrapper.find('.bt-book-view--paged');

    await root.trigger('keydown', { key: 'ArrowRight', ctrlKey: true });
    expect(reader.currentPage).toBe(0);
  });

  it('横排左滑下一页、右滑上一页；纵向滑动不翻页', async () => {
    const reader = createReader();
    const wrapper = mount(BtBookView, { props: { reader } });
    const root = wrapper.find('.bt-book-view--paged');

    await root.trigger('touchstart', { touches: [{ clientX: 240, clientY: 100 }] });
    await root.trigger('touchend', { changedTouches: [{ clientX: 120, clientY: 104 }] });
    expect(reader.currentPage).toBe(1);

    await root.trigger('touchstart', { touches: [{ clientX: 120, clientY: 100 }] });
    await root.trigger('touchend', { changedTouches: [{ clientX: 240, clientY: 100 }] });
    expect(reader.currentPage).toBe(0);

    await root.trigger('touchstart', { touches: [{ clientX: 200, clientY: 100 }] });
    await root.trigger('touchend', { changedTouches: [{ clientX: 200, clientY: 240 }] });
    expect(reader.currentPage).toBe(0);
  });

  it('阅读区可聚焦并提供页码播报', () => {
    const reader = createReader();
    const wrapper = mount(BtBookView, { props: { reader } });
    const root = wrapper.find('.bt-book-view--paged');

    expect(root.attributes('tabindex')).toBe('0');
    expect(root.attributes('role')).toBe('document');
    expect(root.attributes('aria-label')).toContain('方向键翻页');
    expect(wrapper.find('[aria-live="polite"]').text()).toContain('1 / 共 3 页');
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

describe('BtBookView 页底注区（B5）', () => {
  it('浮注开启时渲染页底注区且含注码', () => {
    const doc = createEmptyDocument({ title: '注区' });
    doc.root.children = [
      { type: NODE_TYPES.PARAGRAPH, id: 'p-1', children: [{ type: 'text', text: '正文' }] },
      {
        type: NODE_TYPES.FOOTNOTE,
        id: 'fn-1',
        children: [{ type: NODE_TYPES.PARAGRAPH, id: 'fn-1-p', children: [{ type: 'text', text: '注文' }] }],
      },
    ];
    const reader = new Reader({
      pageMainSize: 600,
      bottomSlack: 0,
      footnoteFloat: true,
      noteMaxRatio: 0.4,
      estimator: fixedEstimator({ 'p-1': 100, 'fn-1': 60 }),
    });
    reader.loadDocument(doc);

    const wrapper = mount(BtBookView, { props: { reader } });
    const html = wrapper.html();
    expect(html).toContain('bt-page-notes');
    expect(html).toContain('data-note-id="fn-1"');
    expect(html).toContain('bt-footnote');
  });

  it('关闭浮注时不渲染注区', () => {
    const doc = createEmptyDocument({ title: '注区' });
    doc.root.children = [
      { type: NODE_TYPES.PARAGRAPH, id: 'p-1', children: [{ type: 'text', text: '正文' }] },
      {
        type: NODE_TYPES.FOOTNOTE,
        id: 'fn-1',
        children: [{ type: NODE_TYPES.PARAGRAPH, id: 'fn-1-p', children: [{ type: 'text', text: '注文' }] }],
      },
    ];
    const reader = new Reader({
      pageMainSize: 600,
      bottomSlack: 0,
      footnoteFloat: false,
      estimator: fixedEstimator({ 'p-1': 100, 'fn-1': 60 }),
    });
    reader.loadDocument(doc);

    const wrapper = mount(BtBookView, { props: { reader } });
    expect(wrapper.html()).not.toContain('bt-page-notes');
  });
});
