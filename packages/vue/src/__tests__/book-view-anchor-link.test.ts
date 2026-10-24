/**
 * BtBookView 文档内锚点链接跳转测试
 *
 * 导入书籍的注码多为 link 标记 `<a href="#…">`（EPUB 里还常见带源文件路径的
 * `Note.xhtml#n1` 形态）：点击应跳到目标块——跨页翻页 + 高亮、同页直接高亮；
 * 书内相对锚点一律消费（目标解析不到也 preventDefault），绝不交给浏览器默认
 * 行为按相对路径导航「刷新」预览页。happy-dom 无布局，页容量用 estimator mock。
 */
import { describe, expect, it } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import { MARK_TYPES, NODE_TYPES, createEmptyDocument } from '@bibliotype/core';
import { Reader, type BlockSizeEstimator } from '@bibliotype/reader';
import BtBookView from '../components/BtBookView.vue';
import { NOTE_ACTIVE_CLASS } from '../use-note-interaction.js';

/** 带链接注码的段落（IR link 标记 → 序列化为 `<a class="bt-mark-link" href="…">`） */
function refParagraph(href: string) {
  return {
    type: NODE_TYPES.PARAGRAPH,
    id: 'p-ref',
    children: [
      {
        type: 'text',
        text: '见注',
        marks: [{ type: MARK_TYPES.LINK, attrs: { href } }],
      },
    ],
  };
}

function makeReader(options: { samePage?: boolean; href?: string } = {}): Reader {
  const { samePage = false, href = '#n1' } = options;
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
      children:
        samePage ? [refParagraph(href), target, ...filler] : [refParagraph(href), ...filler, target],
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

function clickRefAnchor(wrapper: VueWrapper, href = '#n1'): MouseEvent {
  const anchor = wrapper.find(`a[href="${href}"]`);
  if (!anchor.exists()) throw new Error(`页面中未渲染出锚点链接 ${href}`);
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  anchor.element.dispatchEvent(event);
  return event;
}

describe('BtBookView 文档内锚点跳转', () => {
  it('跨页目标：点击注码翻到目标页并高亮目标块', async () => {
    const wrapper = mountView(makeReader());
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
    const wrapper = mountView(makeReader({ samePage: true }));
    await nextTick();
    const before = (wrapper.emitted('update:page') ?? []).length;

    clickRefAnchor(wrapper);
    await nextTick();

    expect(wrapper.find('#n1').classes()).toContain(NOTE_ACTIVE_CLASS);
    expect((wrapper.emitted('update:page') ?? []).length).toBe(before);
    wrapper.unmount();
  });

  it('EPUB 遗留的 path#hash 形态（Note.xhtml#n1）同样跳转', async () => {
    const wrapper = mountView(makeReader({ href: 'Text/Note.xhtml#n1' }));
    await nextTick();

    clickRefAnchor(wrapper, 'Text/Note.xhtml#n1');
    await nextTick();
    await nextTick();

    const pages = wrapper.emitted('update:page') ?? [];
    expect(pages.at(-1)).toEqual([4]);
    wrapper.unmount();
  });

  it('目标解析不到：消费点击（不交给默认导航刷新页面），页码不变', async () => {
    const wrapper = mountView(makeReader({ href: '#missing' }));
    await nextTick();
    const before = (wrapper.emitted('update:page') ?? []).length;

    const event = clickRefAnchor(wrapper, '#missing');
    await nextTick();

    expect(event.defaultPrevented).toBe(true);
    expect((wrapper.emitted('update:page') ?? []).length).toBe(before);
    wrapper.unmount();
  });

  it('存量书（目标块无源 id）：EPUB 回链约定双向跳转', async () => {
    /* 存量形态：所有段落无 id，注码链接 hash `ch1-9`，注文回链 hash `ch1-9-back`，
     * 文件名段 text00012.html 是 EPUB 残留（SPA 无此文件） */
    const doc = createEmptyDocument({ title: '存量锚点' });
    doc.root.children = [
      {
        type: NODE_TYPES.CHAPTER,
        attrs: { title: '第一章' },
        children: [
          {
            type: NODE_TYPES.PARAGRAPH,
            children: [
              {
                type: 'text',
                text: '(1)',
                marks: [{ type: MARK_TYPES.LINK, attrs: { href: 'text00012.html#ch1-9' } }],
              },
            ],
          },
          { type: NODE_TYPES.PARAGRAPH, children: [{ type: 'text', text: '填充一' }] },
          { type: NODE_TYPES.PARAGRAPH, children: [{ type: 'text', text: '填充二' }] },
          { type: NODE_TYPES.PARAGRAPH, children: [{ type: 'text', text: '填充三' }] },
          {
            type: NODE_TYPES.PARAGRAPH,
            children: [
              {
                type: 'text',
                text: '(1)',
                marks: [
                  { type: MARK_TYPES.LINK, attrs: { href: 'text00012.html#ch1-9-back' } },
                ],
              },
              { type: 'text', text: '《汉·许皇后传》：幸得免离茅屋之下。' },
            ],
          },
        ],
      },
    ];
    const estimator: BlockSizeEstimator = () => 100;
    const reader = new Reader({ pageMainSize: 100, bottomSlack: 0, estimator });
    reader.loadDocument(doc);
    const wrapper = mountView(reader);
    await nextTick();

    /* 点注码：经回链约定反查注文所在页（第 5 块 → 页 4） */
    clickRefAnchor(wrapper, 'text00012.html#ch1-9');
    await nextTick();
    await nextTick();
    expect((wrapper.emitted('update:page') ?? []).at(-1)).toEqual([4]);

    /* 在注文页点回链：剥 -back 反查注码所在页（页 0） */
    const backlink = wrapper.find('a[href="text00012.html#ch1-9-back"]');
    if (!backlink.exists()) throw new Error('注文页未渲染出回链');
    backlink.element.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );
    await nextTick();
    await nextTick();
    expect((wrapper.emitted('update:page') ?? []).at(-1)).toEqual([0]);
    wrapper.unmount();
  });
});
