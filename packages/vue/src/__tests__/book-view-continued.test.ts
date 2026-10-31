/**
 * BtBookView 跨页续排片段（data-continued）测试。
 *
 * 横排块按行拆分跨页后，后继片段是同一句话的中段：序列化器输出
 * data-continued，book-css 据此置零首行缩进（截图缺陷：续行被当新段落
 * 缩进两字符 + 行数超出分页记账致页底空行带）。
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { NODE_TYPES, createEmptyDocument } from '@bibliotype/core';
import { Reader } from '@bibliotype/reader';
import BtBookView from '../components/BtBookView.vue';

describe('BtBookView 续排片段顶格', () => {
  it('page 模式：续排片段输出 data-continued，页首片段不输出', () => {
    const doc = createEmptyDocument({ title: '长段' });
    doc.root.children = [
      {
        type: NODE_TYPES.PARAGRAPH,
        id: 'long',
        children: [{ type: 'text', text: '字'.repeat(300) }],
      },
    ];
    /* 无实测映射 → 行数按估算（mainSize 300 ÷ 行高 30 = 10 行），
     * pageMainSize 120 → 约 4 行/页 → 必然跨页续排 */
    const reader = new Reader({
      pageMainSize: 120,
      bottomSlack: 0,
      estimator: (node) => (node.id === 'long' ? 300 : 100),
    });
    reader.loadDocument(doc);
    expect(reader.totalPages).toBeGreaterThan(1);
    reader.goToPage(1);

    const wrapper = mount(BtBookView, {
      props: { reader, mode: 'page' },
      attachTo: document.body,
    });
    const html = wrapper.html();
    /* 第 2 页的片段是续排（fromLine>0）→ 带 data-continued */
    expect(html).toContain('data-continued="true"');
    wrapper.unmount();
  });

  it('整块未跨页的段落不输出 data-continued', () => {
    const doc = createEmptyDocument({ title: '短段' });
    doc.root.children = [
      {
        type: NODE_TYPES.PARAGRAPH,
        id: 'short',
        children: [{ type: 'text', text: '短段落' }],
      },
    ];
    const reader = new Reader({ pageMainSize: 600, bottomSlack: 0 });
    reader.loadDocument(doc);
    const wrapper = mount(BtBookView, {
      props: { reader, mode: 'page' },
      attachTo: document.body,
    });
    expect(wrapper.html()).not.toContain('data-continued');
    wrapper.unmount();
  });
});
