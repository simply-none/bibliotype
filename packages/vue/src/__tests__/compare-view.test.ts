/**
 * D5 双文稿对照：单文档退化对页、双文档并排、页码双向同步（重入 / 越界钳制）
 */
import { NODE_TYPES, createEmptyDocument, type BookDocument } from '@bibliotype/core';
import { Reader, type BlockSizeEstimator } from '@bibliotype/reader';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import BtCompareView from '../components/BtCompareView.vue';

const COLLATION = 'collation-mark';

function markDoc(title: string, seed: number): BookDocument {
  const doc = createEmptyDocument({ title });
  doc.root.children = [
    {
      type: NODE_TYPES.CHAPTER,
      id: `ch-${seed}`,
      attrs: { title },
      children: Array.from({ length: 30 }, (_, i) => ({
        type: NODE_TYPES.PARAGRAPH,
        id: `p-${seed}-${i}`,
        children: [
          { type: 'text', text: `${title} 段落 ${i + 1}` },
          { type: COLLATION, attrs: { pairId: `pair-${seed}-${i}`, role: i % 2 === 0 ? 'base' : 'variant' } },
        ],
      })),
    },
  ];
  return doc;
}

function makeReader(title: string, seed: number): Reader {
  const estimator: BlockSizeEstimator = () => 80;
  const reader = new Reader({ pageMainSize: 240, estimator });
  reader.loadDocument(markDoc(title, seed));
  return reader;
}

describe('BtCompareView', () => {
  it('仅传 left 时退化为单文档对页阅读', () => {
    const left = makeReader('底本', 1);
    const wrapper = mount(BtCompareView, { props: { left } });
    // 单文档形态渲染一个 BtBookView（带 facing 版式）
    expect(wrapper.find('.bt-book-view').exists()).toBe(true);
    expect(wrapper.find('.bt-spread').exists()).toBe(false);
  });

  it('双文档并排渲染左侧 / 右侧各一个阅读视图', () => {
    const left = makeReader('底本', 1);
    const right = makeReader('校本', 2);
    const wrapper = mount(BtCompareView, { props: { left, right } });
    // 双文档形态使用通用双栏布局
    expect(wrapper.find('.bt-spread').exists()).toBe(true);
    const views = wrapper.findAll('.bt-book-view');
    expect(views).toHaveLength(2);
  });

  it('syncPages 开启时，左侧翻页带动右侧同步', async () => {
    const left = makeReader('底本', 1);
    const right = makeReader('校本', 2);
    const wrapper = mount(BtCompareView, { props: { left, right, syncPages: true } });
    await wrapper.vm.$nextTick();

    expect(left.currentPage).toBe(0);
    expect(right.currentPage).toBe(0);

    // 直接驱动左侧翻到下一页（宿主点击 / 键盘经 BtBookView 内部 same path）
    left.goToPage(1);
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    expect(left.currentPage).toBe(1);
    expect(right.currentPage).toBe(1);
  });

  it('双向同步不会死循环（右侧回写不会再次驱动左侧）', async () => {
    const left = makeReader('底本', 1);
    const right = makeReader('校本', 2);
    const wrapper = mount(BtCompareView, { props: { left, right, syncPages: true } });
    await wrapper.vm.$nextTick();

    expect(() => {
      left.goToPage(2);
      right.goToPage(0);
    }).not.toThrow();
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    // 末次驱动以左侧为准，右侧应被拉到 2（或各自钳制到合法页，但不报错）
    expect(right.currentPage).toBeGreaterThanOrEqual(0);
    expect(left.currentPage).toBeGreaterThanOrEqual(0);
  });

  it('越界页码被钳制，同步后两侧一致', async () => {
    const left = makeReader('底本', 1);
    const right = makeReader('校本', 2);
    const wrapper = mount(BtCompareView, { props: { left, right, syncPages: true } });
    await wrapper.vm.$nextTick();

    left.goToPage(999);
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    // 越界被钳制到末页，同步后两侧页码一致
    expect(left.currentPage).toBe(right.currentPage);
    expect(left.currentPage).toBeGreaterThanOrEqual(0);
  });

  it('syncPages 关闭时不互相干扰', async () => {
    const left = makeReader('底本', 1);
    const right = makeReader('校本', 2);
    const wrapper = mount(BtCompareView, { props: { left, right, syncPages: false } });
    await wrapper.vm.$nextTick();

    left.goToPage(1);
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    expect(left.currentPage).toBe(1);
    expect(right.currentPage).toBe(0);
  });
});
