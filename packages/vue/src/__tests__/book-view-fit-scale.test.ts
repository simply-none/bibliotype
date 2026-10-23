/**
 * BtBookView fitScale 外部整页缩放测试（开本适配「自适应宽度 / 高度」落地端）
 *
 * 语义是 PDF「适合宽度 / 高度」：宿主按「舞台轴 / 开本轴」算好倍率传入，
 * 组件直接拿它做整页 transform 缩放——允许 >1 放大（突破旧的 `Math.min(1, ratio)`
 * contain 上限），字体与版面一起等比缩放；未传 / 非法值回退自身适配策略。
 * happy-dom 无布局（clientWidth 恒 0，常规分支只能落在 scale 1），恰好可以
 * 区分「覆盖生效」与「回退」两条路。
 */
import { describe, expect, it } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import { NODE_TYPES, createEmptyDocument } from '@bibliotype/core';
import { Reader, type BlockSizeEstimator } from '@bibliotype/reader';
import { PAGE_SIZES } from '@bibliotype/layout';
import BtBookView from '../components/BtBookView.vue';

function makeReader(): Reader {
  const doc = createEmptyDocument({ title: '缩放' });
  doc.root.children = [
    {
      type: NODE_TYPES.CHAPTER,
      id: 'ch-1',
      attrs: { title: '第一章' },
      children: [1, 2, 3].map((index) => ({
        type: NODE_TYPES.PARAGRAPH,
        id: `p-${index}`,
        children: [{ type: 'text', text: `正文${index}` }],
      })),
    },
  ];
  const estimator: BlockSizeEstimator = () => 100;
  const reader = new Reader({ pageMainSize: 100, bottomSlack: 0, estimator });
  reader.loadDocument(doc);
  return reader;
}

/** 挂载并取单页舞台（缩放后的版面元素；onMounted 的重算等一次刷新） */
async function mountView(props: Record<string, unknown>): Promise<{ wrapper: VueWrapper; stage: HTMLElement }> {
  const wrapper = mount(BtBookView, { props: { reader: makeReader(), ...props } });
  await nextTick();
  const stage = wrapper.find('.bt-book-view__stage').element as HTMLElement;
  return { wrapper, stage };
}

describe('BtBookView fitScale（PDF 式整页缩放）', () => {
  it('传入倍率直接落地：舞台版面 = 开本 × 倍率（允许 >1）', async () => {
    const { stage } = await mountView({ fitScale: 1.61 });
    /* happy-dom 下容器宽为 0，无覆盖必然 scale=1；这里是 559×1.61，放大生效
       （数值断言不拼字符串：浮点尾差在 style 序列化里会被归一） */
    expect(Number.parseFloat(stage.style.width)).toBeCloseTo(PAGE_SIZES.A5.width * 1.61, 1);
    expect(Number.parseFloat(stage.style.height)).toBeCloseTo(PAGE_SIZES.A5.height * 1.61, 1);
    const page = stage.querySelector('.bt-reader-page') as HTMLElement;
    expect(page.style.transform).toBe('scale(1.61)');
  });

  it('倍率变更即时重缩放（拖窗口 / 换档位不重排、只换倍率）', async () => {
    const { wrapper, stage } = await mountView({ fitScale: 2 });
    expect(stage.style.width).toBe(`${PAGE_SIZES.A5.width * 2}px`);
    await wrapper.setProps({ fitScale: 0.75 });
    expect(stage.style.width).toBe(`${PAGE_SIZES.A5.width * 0.75}px`); // 559×0.75=419.25 整值
  });

  it('未传 / 非法值回退自身适配（容器量不到时 scale 1，页框仍是开本）', async () => {
    const { stage } = await mountView({ fitScale: Number.NaN });
    expect(stage.style.width).toBe(`${PAGE_SIZES.A5.width}px`);
    const { stage: plain } = await mountView({});
    expect(plain.style.width).toBe(`${PAGE_SIZES.A5.width}px`);
  });
});
