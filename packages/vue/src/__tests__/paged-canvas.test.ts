/**
 * 编辑态分页外壳（PagedCanvas）组件测试
 *
 * happy-dom 无布局：仅验证「渲染结构正确」——真实页槽渲染、片段格只读/可编辑
 * 属性、页脚页码存在；交互式输入（beforeinput / caret 还原）依赖真实选区与布局，
 * 由模型级单测（paged-bridge / paged-input）+ 浏览器手动验收覆盖。
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { DEFAULT_THEME, NODE_TYPES, createEmptyDocument, type BookDocument } from '@bibliotype/core';
import { DEFAULT_LAYOUT_OPTIONS } from '@bibliotype/layout';
import { BookEditor, buildEditorSchema } from '@bibliotype/editor';
import { extractBlocks } from '@bibliotype/reader';
import { disposeMeasureSheet } from '../pagination-measure.js';
import { buildPagedLayout, collectPmLeafPositions } from '../paged-editor/use-paged-layout.js';
import { buildPagedIndex } from '../paged-editor/selection-bridge.js';
import PagedCanvas from '../paged-editor/PagedCanvas.vue';

function longDoc(): BookDocument {
  const doc = createEmptyDocument({ title: '测试' });
  doc.root.children = [
    {
      type: NODE_TYPES.CHAPTER,
      id: 'chap-1',
      children: [{ type: NODE_TYPES.PARAGRAPH, id: 'p-0', children: [{ type: 'text', text: '仁义礼智信忠孝节悌'.repeat(400) }] }],
    },
  ];
  return doc;
}

describe('PagedCanvas', () => {
  it('渲染真实页槽（只读片段 + 页脚页码）', () => {
    const { pages } = buildPagedLayout({ doc: longDoc(), options: DEFAULT_LAYOUT_OPTIONS });
    expect(pages.length).toBeGreaterThan(0);

    const wrapper = mount(PagedCanvas, {
      props: { pages, options: DEFAULT_LAYOUT_OPTIONS, tokens: DEFAULT_THEME },
    });

    const frames = wrapper.findAll('.bt-paged-page');
    expect(frames.length).toBeGreaterThanOrEqual(1);
    // 只读：片段格 contenteditable=false
    const frag = wrapper.find('.bt-paged-frag');
    expect(frag.exists()).toBe(true);
    expect(frag.attributes('contenteditable')).toBe('false');
    // 页脚页码存在
    expect(wrapper.find('.bt-paged-page__no').exists()).toBe(true);

    wrapper.unmount();
    disposeMeasureSheet();
  });

  it('可编辑态：片段格 contenteditable=true 且携带块定位数据', () => {
    const doc = createEmptyDocument({ title: '测试' });
    doc.root.children = [
      { type: NODE_TYPES.PARAGRAPH, id: 'p-1', children: [{ type: 'text', text: '子曰学而时习之' }] },
    ];
    const editor = new BookEditor({ schema: buildEditorSchema(), document: doc });
    const { pages } = buildPagedLayout({ doc: editor.getDocument(), options: DEFAULT_LAYOUT_OPTIONS });
    const index = buildPagedIndex(
      extractBlocks(editor.getDocument(), {}),
      collectPmLeafPositions(editor.editorState.doc),
      new Map(),
    );
    const wrapper = mount(PagedCanvas, {
      props: {
        pages,
        options: DEFAULT_LAYOUT_OPTIONS,
        tokens: DEFAULT_THEME,
        editable: true,
        editor,
        index,
      },
    });
    const frag = wrapper.find('.bt-paged-frag');
    expect(frag.exists()).toBe(true);
    expect(frag.attributes('contenteditable')).toBe('true');
    expect(frag.attributes('data-block-id')).toBe('p-1');
    wrapper.unmount();
  });

  it('空页序列不渲染页槽', () => {
    const wrapper = mount(PagedCanvas, {
      props: { pages: [], options: DEFAULT_LAYOUT_OPTIONS, tokens: DEFAULT_THEME },
    });
    expect(wrapper.findAll('.bt-paged-page').length).toBe(0);
    wrapper.unmount();
  });

  it('scale 用户倍率：覆盖容器宽自适应（允许 >1 放大）且变更即时生效', async () => {
    const { pages } = buildPagedLayout({ doc: longDoc(), options: DEFAULT_LAYOUT_OPTIONS });
    const wrapper = mount(PagedCanvas, {
      // happy-dom 无布局（clientWidth=0）：自适应回退 1，用户倍率则直接生效
      props: { pages, options: DEFAULT_LAYOUT_OPTIONS, tokens: DEFAULT_THEME, scale: 1.5 },
    });
    const frame = wrapper.find('.bt-paged-page');
    expect(frame.attributes('style')).toContain('scale(1.5)');

    // 限幅：超过 2 截断到 2
    await wrapper.setProps({ scale: 3 });
    expect(wrapper.find('.bt-paged-page').attributes('style')).toContain('scale(2)');

    // 还原 undefined：回到自适应链路（无布局环境下为 1）
    await wrapper.setProps({ scale: undefined });
    expect(wrapper.find('.bt-paged-page').attributes('style')).toContain('scale(1)');
    wrapper.unmount();
    disposeMeasureSheet();
  });

  it('直排（vertical-rl）：页阵主轴转置为水平右起 — 槽位写 right、轨道撑宽', () => {
    const options = { ...DEFAULT_LAYOUT_OPTIONS, writingMode: 'vertical-rl' as const };
    const { pages } = buildPagedLayout({ doc: longDoc(), options });
    expect(pages.length).toBeGreaterThan(1);

    const wrapper = mount(PagedCanvas, {
      props: { pages, options, tokens: DEFAULT_THEME },
    });

    // 滚动容器换为横向滚动变体，页槽带右锚定类
    const scroller = wrapper.find('.bt-paged');
    expect(scroller.classes()).toContain('bt-paged--x');
    const slots = wrapper.findAll('.bt-paged__slot');
    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0]?.classes()).toContain('bt-paged__slot--x');

    // 主轴偏移写到 right（首页 = SCROLL_PADDING 16），不再写 top 堆叠
    const firstStyle = slots[0]?.attributes('style') ?? '';
    expect(firstStyle).toContain('right: 16px');
    expect(firstStyle).not.toContain('top: 16px');

    // 逐页步长 = 页宽 + 缝距（而非页高）
    const secondStyle = slots[1]?.attributes('style') ?? '';
    const step = options.pageSize.width + 28;
    expect(secondStyle).toContain(`right: ${16 + step}px`);

    // 轨道沿主轴（宽）按页数撑开，高度填满视口（页在交叉轴居中）
    const trackStyle = wrapper.find('.bt-paged__track').attributes('style') ?? '';
    expect(trackStyle).toContain('width:');
    expect(trackStyle).toContain('height: 100%');

    wrapper.unmount();
    disposeMeasureSheet();
  });

  it('横排不变：主轴仍为纵向（槽位写 top、无横向变体类）', () => {
    const { pages } = buildPagedLayout({ doc: longDoc(), options: DEFAULT_LAYOUT_OPTIONS });
    const wrapper = mount(PagedCanvas, {
      props: { pages, options: DEFAULT_LAYOUT_OPTIONS, tokens: DEFAULT_THEME },
    });
    expect(wrapper.find('.bt-paged').classes()).not.toContain('bt-paged--x');
    const slotStyle = wrapper.find('.bt-paged__slot').attributes('style') ?? '';
    expect(slotStyle).toContain('top: 16px');
    expect(slotStyle).not.toContain('right: 16px');
    wrapper.unmount();
    disposeMeasureSheet();
  });

  it('initialPage：首轮分页就绪后定位到目标页并回写可见页（一次性）', async () => {
    const { pages } = buildPagedLayout({ doc: longDoc(), options: DEFAULT_LAYOUT_OPTIONS });
    expect(pages.length).toBeGreaterThan(3);
    // 先挂空页序列（模拟分页未就绪），再就绪触发一次性定位
    const wrapper = mount(PagedCanvas, {
      props: { pages: [], options: DEFAULT_LAYOUT_OPTIONS, tokens: DEFAULT_THEME, initialPage: 2 },
    });
    await wrapper.setProps({ pages });
    await wrapper.vm.$nextTick();

    const scroller = wrapper.element as HTMLElement;
    const stride = DEFAULT_LAYOUT_OPTIONS.pageSize.height + 28;
    expect(scroller.scrollTop).toBe(16 + 2 * stride);
    expect(wrapper.emitted('update:visiblePage')?.[0]).toEqual([2]);

    // 一次性消费：后续重排不强行回拉位置
    scroller.scrollTop = 0;
    await wrapper.setProps({ pages: pages.slice(0, -1) });
    await wrapper.vm.$nextTick();
    expect(scroller.scrollTop).toBe(0);

    wrapper.unmount();
    disposeMeasureSheet();
  });
});
