/**
 * BtBookView 文档内锚点链接跳转测试
 *
 * 导入书籍的注码多为 link 标记 `<a href="#…">`（非 noteref 标记）：点击应跳到
 * 目标块——跨页翻页 + 高亮、同页直接高亮——而不是交给浏览器默认锚点导航把预览
 * 页「刷新」到顶。happy-dom 无布局，页容量用 estimator mock 出来。
 */
import { describe, expect, it } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import { MARK_TYPES, NODE_TYPES, createEmptyDocument } from '@bibliotype/core';
import { Reader, type BlockSizeEstimator } from '@bibliotype/reader';
import BtBookView from '../components/BtBookView.vue';
import { NOTE_ACTIVE_CLASS } from '../use-note-interaction.js';

/** 带链接注码的段落（IR link 标记 → 序列化为 `<a class="bt-mark-link" href="#n1">`） */
function refParagraph() {
  return {
    type: NODE_TYPES.PARAGRAPH,
    id: 'p-ref',
    children: [
      {
        type: 'text',
        text: '见注',
        marks: [{ type: MARK_TYPES.LINK, attrs: { href: '#n1' } }],
      },
    ],
  };
}

function makeReader(samePage: boolean): Reader {
  const doc = createEmptyDocument({ title: '锚点' });
  const filler = Array.from({ length: 3 }, (_, index) => ({
    type: NODE_TYPES.PARAGRAPH,
    id: `p-fill-${index}`,
    children: [{ type: 'text', text: `填充${index}` }],
  }));
  const target = {
    type: NODE_TYPES.PARAGRAPH,
    id: 'n1',
    children: [{ type: 'text', text: '注文内容' }],
  };
  doc.root.children = [
    {
      type: NODE_TYPES.CHAPTER,
      id: 'ch-1',
      attrs: { title: '第一章' },
      /* 同页形态：注码与目标同页（每页 3 块）；跨页形态：目标在第 5 块（每页 1 块） */
      children: samePage ? [refParagraph(), target, ...filler] : [refParagraph(), ...filler, target],
    },
  ];
  const estimator: BlockSizeEstimator = () => 100;
  const reader = new Reader({
    pageMainSize: samePage ? 300 : 100,
    bottomSlack: 0,
    estimator,
  });
  reader.loadDocument(doc);
  return reader;
}

function mountView(reader: Reader): VueWrapper {
  return mount(BtBookView, { props: { reader } });
}

function clickRefAnchor(wrapper: VueWrapper): void {
  const anchor = wrapper.find('a[href="#n1"]');
  if (!anchor.exists()) throw new Error('页面中未渲染出锚点链接');
  anchor.element.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true }),
  );
}

describe('BtBookView 文档内锚点跳转', () => {
  it('跨页目标：点击注码翻到目标页并高亮目标块', async () => {
    const wrapper = mountView(makeReader(false));
    await nextTick();

    clickRefAnchor(wrapper);
    await nextTick();
    await nextTick();

    const pages = wrapper.emitted('update:page') ?? [];
    expect(pages.at(-1)).toEqual([4]);
    expect(wrapper.find('#n1').classes()).toContain(NOTE_ACTIVE_CLASS);
    wrapper.unmount();
  });

  it('同页目标：只高亮目标块，不翻页', async () => {
    const wrapper = mountView(makeReader(true));
    await nextTick();
    const before = (wrapper.emitted('update:page') ?? []).length;

    clickRefAnchor(wrapper);
    await nextTick();

    expect(wrapper.find('#n1').classes()).toContain(NOTE_ACTIVE_CLASS);
    expect((wrapper.emitted('update:page') ?? []).length).toBe(before);
    wrapper.unmount();
  });
});
