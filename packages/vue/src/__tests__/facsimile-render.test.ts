/**
 * 古籍仿真直排：阅读视图渲染测试
 *
 * 覆盖清单里的「三端一致」中的阅读端，并守住并列关系：
 * - 带 `facsimile` 的布局：注入版框 / 界行样式与逐页版心（书口）DOM；
 * - 古典 / 现代布局：无版心 DOM、样式表不含任何仿真痕迹；
 * - scroll 连续模式逐页各一份版心；
 * - 从仿真切回古典：装饰 DOM 与 CSS 同时消失（不残留）。
 */
import { describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { DEFAULT_THEME, NODE_TYPES, createEmptyDocument, type BookDocument } from '@bibliotype/core';
import { CLASSICAL_LAYOUT_OPTIONS, FACSIMILE_PRESETS } from '@bibliotype/layout';
import { Reader, type BlockSizeEstimator } from '@bibliotype/reader';
import BtBookView from '../components/BtBookView.vue';

/** 固定尺寸估算器：按节点 id 取尺寸 */
function fixedEstimator(sizes: Record<string, number>): BlockSizeEstimator {
  return (node) => sizes[node.id ?? ''] ?? 50;
}

/** 卷 > 章（标题 30 + 两段 60/60）；页主轴 100 → 两页，同属「学而第一」 */
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
            { type: NODE_TYPES.HEADING, id: 'h-1', children: [{ type: 'text', text: '学而第一' }] },
            { type: NODE_TYPES.PARAGRAPH, id: 'p-1', children: [{ type: 'text', text: '子曰' }] },
            {
              type: NODE_TYPES.PARAGRAPH,
              id: 'p-2',
              children: [{ type: 'text', text: '有朋自远方来' }],
            },
          ],
        },
      ],
    },
  ];
  return doc;
}

/** 默认仿真模板（宋刻浙本） */
const PRESET = FACSIMILE_PRESETS[0] as NonNullable<(typeof FACSIMILE_PRESETS)[0]>;
const FAC_TOKENS = { ...DEFAULT_THEME, ...PRESET.tokens };

/** 建 Reader：pageMainSize 固定 100，分页可预期 */
function createReader(layout: typeof CLASSICAL_LAYOUT_OPTIONS): Reader {
  const reader = new Reader({
    pageMainSize: 100,
    estimator: fixedEstimator({ 'h-1': 30, 'p-1': 60, 'p-2': 60 }),
    layout,
  });
  reader.loadDocument(sampleDoc());
  return reader;
}

/** 读取注入到 head 的书册样式表 */
function bookCss(): string {
  return document.getElementById('bt-book-css')?.textContent ?? '';
}

describe('BtBookView：古籍仿真直排', () => {
  it('注入版框 / 界行样式，并按页渲染版心（书名 / 篇卷 / 叶次）', () => {
    const reader = createReader(PRESET.layout);
    const wrapper = mount(BtBookView, { props: { reader, tokens: FAC_TOKENS } });

    const gutter = wrapper.find('.bt-page-gutter');
    expect(gutter.exists()).toBe(true);
    expect(gutter.attributes('data-side')).toBe('left');
    expect(gutter.attributes('data-mouth')).toBe('white');
    const fields = wrapper.findAll('.bt-page-gutter__field').map((node) => node.text());
    expect(fields).toEqual(['论语', '学而第一', '一']);
    /* 单鱼尾 */
    expect(wrapper.findAll('.bt-page-gutter__fish')).toHaveLength(1);

    const css = bookCss();
    expect(css).toContain('--bt-fs-line-pitch: 42.9px');
    expect(css).toContain('.bt-reader-page::before');
    expect(css).toContain('.bt-reader-page::after');
    expect(css).toContain('.bt-reader-page .bt-page-gutter');
    /* 版心承载叶次 → 页脚页码被隐藏（DOM 仍在，由 CSS 收起） */
    expect(css).toContain('.bt-reader-page .bt-page-number');
  });

  it('古典布局：无版心 DOM，样式表不含仿真痕迹', () => {
    const reader = createReader(CLASSICAL_LAYOUT_OPTIONS);
    const wrapper = mount(BtBookView, { props: { reader } });

    expect(wrapper.find('.bt-page-gutter').exists()).toBe(false);
    const css = bookCss();
    expect(css).not.toContain('--bt-fs-');
    expect(css).not.toContain('.bt-reader-page::before');
    expect(css).not.toContain('bt-page-gutter');
  });

  it('scroll 模式：每页各一份版心，叶次逐页累加', () => {
    const reader = createReader(PRESET.layout);
    const wrapper = mount(BtBookView, {
      props: { reader, tokens: FAC_TOKENS, mode: 'scroll' },
    });

    const gutters = wrapper.findAll('.bt-page-gutter');
    expect(gutters).toHaveLength(2);
    expect(wrapper.findAll('.bt-page-gutter-host')).toHaveLength(2);
    const numbers = wrapper
      .findAll('.bt-page-gutter__field[data-field="pageNumber"]')
      .map((node) => node.text());
    expect(numbers).toEqual(['一', '二']);
  });

  it('从仿真切回古典（重新挂载）：装饰 DOM 与 CSS 一并消失', async () => {
    const facsimile = createReader(PRESET.layout);
    const withFacsimile = mount(BtBookView, { props: { reader: facsimile, tokens: FAC_TOKENS } });
    expect(withFacsimile.find('.bt-page-gutter').exists()).toBe(true);
    withFacsimile.unmount();
    await nextTick();

    const classical = mount(BtBookView, {
      props: { reader: createReader(CLASSICAL_LAYOUT_OPTIONS), tokens: DEFAULT_THEME },
    });

    expect(classical.find('.bt-page-gutter').exists()).toBe(false);
    const css = bookCss();
    expect(css).not.toContain('--bt-fs-');
    expect(css).not.toContain('bt-page-gutter');
    classical.unmount();
  });
});
