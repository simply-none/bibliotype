/**
 * K2 校勘对照组件：配对筛选与双向高亮
 */
import { NODE_TYPES, createEmptyDocument, type BookDocument, type BookNode } from '@bibliotype/core';
import { Reader, type BlockSizeEstimator } from '@bibliotype/reader';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import BtCollationCompare from '../components/BtCollationCompare.vue';

const COLLATION_MARK = 'collation-mark';

function mark(pairId: string, role: 'base' | 'variant'): BookNode {
  return { type: COLLATION_MARK, attrs: { pairId, role, symbol: '○' } };
}

function sampleDoc(): BookDocument {
  const doc = createEmptyDocument({ title: '校勘' });
  doc.root.children = [
    {
      type: NODE_TYPES.CHAPTER,
      id: 'ch-1',
      attrs: { title: '学而第一' },
      children: [
        {
          type: NODE_TYPES.PARAGRAPH,
          id: 'p-base',
          children: [{ type: 'text', text: '底本作仁' }, mark('pair-1', 'base')],
        },
        {
          type: NODE_TYPES.PARAGRAPH,
          id: 'p-variant',
          children: [{ type: 'text', text: '校本作人' }, mark('pair-1', 'variant')],
        },
        {
          type: NODE_TYPES.PARAGRAPH,
          id: 'p-other',
          children: [{ type: 'text', text: '无关段落' }],
        },
      ],
    },
  ];
  return doc;
}

function makeReader(): Reader {
  const estimator: BlockSizeEstimator = () => 100;
  const reader = new Reader({ pageMainSize: 300, estimator });
  reader.loadDocument(sampleDoc());
  return reader;
}

describe('BtCollationCompare', () => {
  it('按 pairId 渲染底本 / 校本两侧', () => {
    const wrapper = mount(BtCollationCompare, { props: { reader: makeReader() } });
    expect(wrapper.findAll('.bt-collation-compare__pair')).toHaveLength(1);
    expect(wrapper.findAll('.bt-collation-compare__pane')).toHaveLength(2);
    expect(wrapper.text()).toContain('底本作仁');
    expect(wrapper.text()).toContain('校本作人');
  });

  it('悬浮时同一配对两侧同步高亮', async () => {
    const wrapper = mount(BtCollationCompare, { props: { reader: makeReader() } });
    const pair = wrapper.find('.bt-collation-compare__pair');
    expect(pair.classes()).not.toContain('is-linked');

    await pair.trigger('mouseenter');
    expect(pair.classes()).toContain('is-linked');

    await pair.trigger('mouseleave');
    expect(pair.classes()).not.toContain('is-linked');
  });

  it('pairId 过滤：未命中时显示空态', () => {
    const wrapper = mount(BtCollationCompare, {
      props: { reader: makeReader(), pairId: 'pair-9' },
    });
    expect(wrapper.findAll('.bt-collation-compare__pair')).toHaveLength(0);
    expect(wrapper.text()).toContain('没有可对照');
  });
});
