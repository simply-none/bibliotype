/**
 * PagedCanvas 直排行内流测试（v2 批 3）
 *
 * happy-dom 无布局：验证「直排渲染通道正确」——连排片段走 serializeVerticalFlow
 * （bt-vpara / bt-vnote / 段首空位），续排片段不带行款前缀；横排不受影响。
 * 字符轴：fragTextNodes 对行内流标记的文本轴与模型轴一致（选区桥前置条件）。
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { DEFAULT_THEME, NODE_TYPES, createEmptyDocument, type BookDocument } from '@bibliotype/core';
import { CLASSICAL_LAYOUT_OPTIONS } from '@bibliotype/layout';
import { DEFAULT_LAYOUT_OPTIONS } from '@bibliotype/layout';
import { disposeMeasureSheet } from '../pagination-measure.js';
import { buildPagedLayout } from '../paged-editor/use-paged-layout.js';
import { fragTextNodes } from '../paged-editor/input-router.js';
import PagedCanvas from '../paged-editor/PagedCanvas.vue';

/** 直排样本：两段 + 段内双行夹注 */
function verticalDoc(): BookDocument {
  const doc = createEmptyDocument({ title: '直排行内流' });
  doc.root.children = [
    {
      type: NODE_TYPES.CHAPTER,
      id: 'chap-1',
      children: [
        {
          type: NODE_TYPES.PARAGRAPH,
          id: 'p-1',
          attrs: { indent: 2 },
          children: [{ type: 'text', text: '子曰學而時習之不亦說乎有朋自遠方來不亦樂乎人不知而不慍不亦君子乎。'.repeat(4) }],
        },
        {
          type: NODE_TYPES.PARAGRAPH,
          id: 'p-2',
          children: [
            { type: 'text', text: '其為人也孝弟' },
            { type: 'double-note', children: [{ type: 'text', text: '注：善事父母為孝。' }] },
            { type: 'text', text: '而好犯上者鮮矣。' },
          ],
        },
      ],
    },
  ];
  return doc;
}

const VERTICAL_OPTIONS = { ...CLASSICAL_LAYOUT_OPTIONS };

describe('PagedCanvas 直排行内流', () => {
  it('连排片段走行内流序列化：bt-vpara / 段首空位（低格）/ bt-vnote 双列盒', () => {
    const { pages } = buildPagedLayout({ doc: verticalDoc(), options: VERTICAL_OPTIONS });
    const wrapper = mount(PagedCanvas, {
      props: { pages, options: VERTICAL_OPTIONS, tokens: DEFAULT_THEME },
    });
    const flow = wrapper.find('.bt-paged-page__flow');
    expect(flow.classes()).toContain('bt-vflow');

    /* 段首片段（fromLine=0）带低格空位盒 */
    const frags = wrapper.findAll('.bt-paged-frag--inline');
    expect(frags.length).toBeGreaterThan(0);
    const firstHtml = frags[0]!.html();
    expect(firstHtml).toContain('bt-vpara');
    expect(firstHtml).toContain('<span class="bt-vpad" data-n="2"></span>');
    /* 夹注固定双列盒（含右 / 左子列） */
    const noteHtml = wrapper.html();
    expect(noteHtml).toContain('bt-vnote');
    expect(noteHtml).toContain('bt-vnote-col');
    wrapper.unmount();
    disposeMeasureSheet();
  });

  it('续排片段（fromLine>0）不带行款前缀（不重复低格）', () => {
    const { pages } = buildPagedLayout({ doc: verticalDoc(), options: VERTICAL_OPTIONS });
    const wrapper = mount(PagedCanvas, {
      props: { pages, options: VERTICAL_OPTIONS, tokens: DEFAULT_THEME },
    });
    const continuations = wrapper.findAll('.bt-paged-frag[data-from-line]:not([data-from-line="0"])');
    for (const frag of continuations) {
      if (!frag.classes().includes('bt-paged-frag--inline')) continue;
      expect(frag.html()).not.toContain('bt-vpad');
      expect(frag.html()).not.toContain('bt-vbreak');
    }
    wrapper.unmount();
    disposeMeasureSheet();
  });

  it('字符轴一致：行内流片段的 DOM 文本（含夹注、不含 ruby）与模型切片文本同长', () => {
    /* 直接对序列化产物断言（无布局依赖）：vpara / vnote 内文本节点全部计入，
     * 与 sliceNodeByCharRange 的模型字符轴同口径（选区桥前置条件） */
    const { pages } = buildPagedLayout({ doc: verticalDoc(), options: VERTICAL_OPTIONS });
    const wrapper = mount(PagedCanvas, {
      props: { pages, options: VERTICAL_OPTIONS, tokens: DEFAULT_THEME },
    });
    for (const frag of wrapper.findAll('.bt-paged-frag--inline')) {
      const container = frag.element as HTMLElement;
      const texts = fragTextNodes(container).map((e) => e.node.data);
      /* 行内流标记（空位盒 / 断列 br）不产生文本节点；vpara / vnote 的文本全在轴上 */
      const joined = texts.join('');
      expect(joined.length).toBeGreaterThan(0);
      /* 无 ruby 样本下，轴长 == 片段可见文本长（含注文） */
      expect(joined).toBe(frag.text().replace(/\u200B/g, ''));
    }
    wrapper.unmount();
    disposeMeasureSheet();
  });

  it('横排不受影响：无 bt-vflow 类，片段仍为块级序列化', () => {
    const { pages } = buildPagedLayout({ doc: verticalDoc(), options: { ...DEFAULT_LAYOUT_OPTIONS } });
    const wrapper = mount(PagedCanvas, {
      props: { pages, options: { ...DEFAULT_LAYOUT_OPTIONS }, tokens: DEFAULT_THEME },
    });
    expect(wrapper.find('.bt-paged-page__flow').classes()).not.toContain('bt-vflow');
    expect(wrapper.findAll('.bt-paged-frag--inline').length).toBe(0);
    wrapper.unmount();
    disposeMeasureSheet();
  });
});
