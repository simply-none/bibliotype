/**
 * 目录增强（D6）组件测试：活动章高亮、折叠记忆、目录内搜索、缩略图、
 * 侧栏拖拽条（键盘 / 复位 / 拖拽）与宽度夹取纯函数。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { NODE_TYPES, createEmptyDocument, type BookDocument } from '@bibliotype/core';
import { Reader, type BlockSizeEstimator } from '@bibliotype/reader';
import BtToc from '../components/BtToc.vue';
import BtSidebarResizer from '../components/BtSidebarResizer.vue';
import {
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  clampSidebarWidth,
  stepSidebarWidth,
} from '../sidebar-width.js';

function fixedEstimator(sizes: Record<string, number>): BlockSizeEstimator {
  return (node) => sizes[node.id ?? ''] ?? 50;
}

/** 构造：卷（卷一）> 章（朱熹章句：标题 + 一段） + 章（为政第二：一段） */
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
          attrs: { title: '朱熹章句' },
          children: [
            { type: NODE_TYPES.HEADING, id: 'h-1', children: [{ type: 'text', text: '朱熹章句' }] },
            { type: NODE_TYPES.PARAGRAPH, id: 'p-1', children: [{ type: 'text', text: '子曰' }] },
          ],
        },
        {
          type: NODE_TYPES.CHAPTER,
          id: 'chap-2',
          attrs: { title: '为政第二' },
          children: [
            { type: NODE_TYPES.PARAGRAPH, id: 'p-2', children: [{ type: 'text', text: '为政以德' }] },
          ],
        },
      ],
    },
  ];
  return doc;
}

const SIZES = { 'h-1': 30, 'p-1': 60, 'p-2': 100 };

function createReader(): Reader {
  const reader = new Reader({ pageMainSize: 100, estimator: fixedEstimator(SIZES) });
  reader.loadDocument(sampleDoc());
  return reader;
}

/** 目录行标题（按 DOM 顺序） */
function rowTitles(wrapper: ReturnType<typeof mount>): string[] {
  return wrapper.findAll('.bt-toc__link').map((link) => link.text());
}

describe('BtToc 当前章高亮', () => {
  it('随翻页更新 aria-current 与活动类', async () => {
    const reader = createReader();
    const wrapper = mount(BtToc, { props: { reader } });

    expect(wrapper.findAll('[aria-current="location"]').map((node) => node.text())).toEqual([
      '朱熹章句',
    ]);

    reader.goToPage(1);
    await nextTick();

    expect(wrapper.findAll('[aria-current="location"]').map((node) => node.text())).toEqual([
      '为政第二',
    ]);
    expect(wrapper.findAll('.bt-toc__item--active')).toHaveLength(1);
  });

  it('活动项变化后调用 scrollIntoView（特性缺失时静默跳过）', async () => {
    const reader = createReader();
    const wrapper = mount(BtToc, { props: { reader } });
    const original = Element.prototype.scrollIntoView;
    const spy = vi.fn();
    Element.prototype.scrollIntoView = spy;

    reader.goToPage(1);
    await nextTick();

    expect(spy).toHaveBeenCalledTimes(1);
    Element.prototype.scrollIntoView = original;
    wrapper.unmount();
  });
});

describe('BtToc 折叠', () => {
  it('点击折叠按钮收起子项并抛出 update:expandedKeys', async () => {
    const reader = createReader();
    const wrapper = mount(BtToc, { props: { reader } });
    expect(rowTitles(wrapper)).toEqual(['卷一', '朱熹章句', '为政第二']);

    await wrapper.find('.bt-toc__toggle').trigger('click');
    await nextTick();

    expect(rowTitles(wrapper)).toEqual(['卷一']);
    const emitted = wrapper.emitted('update:expandedKeys');
    // 未受控时默认全展开，收起卷一 = 集合里剔除卷一
    expect(emitted?.[0]?.[0]).toEqual(['chap-1', 'chap-2']);
  });

  it('受控折叠集合决定初始展开状态', () => {
    const reader = createReader();
    const collapsed = mount(BtToc, { props: { reader, expandedKeys: [] } });
    expect(rowTitles(collapsed)).toEqual(['卷一']);

    const expanded = mount(BtToc, { props: { reader, expandedKeys: ['vol-1'] } });
    expect(rowTitles(expanded)).toEqual(['卷一', '朱熹章句', '为政第二']);
  });
});

describe('BtToc 目录内搜索', () => {
  it('过滤命中项、展开父级并高亮命中片段', async () => {
    const reader = createReader();
    const wrapper = mount(BtToc, { props: { reader } });

    await wrapper.find('.bt-toc__search-input').setValue('朱熹');
    await nextTick();

    expect(rowTitles(wrapper)).toEqual(['卷一', '朱熹章句']);
    const hits = wrapper.findAll('.bt-toc__hit').map((node) => node.text());
    expect(hits).toEqual(['朱熹']);
  });

  it('无命中文案与清空还原', async () => {
    const reader = createReader();
    const wrapper = mount(BtToc, { props: { reader } });

    await wrapper.find('.bt-toc__search-input').setValue('不存在');
    await nextTick();
    expect(wrapper.find('.bt-toc__empty').text()).toBe('无匹配目录项');

    await wrapper.find('.bt-toc__search-input').setValue('');
    await nextTick();
    expect(rowTitles(wrapper)).toEqual(['卷一', '朱熹章句', '为政第二']);
  });

  it('Esc 清空搜索框', async () => {
    const reader = createReader();
    const wrapper = mount(BtToc, { props: { reader } });

    const input = wrapper.find('.bt-toc__search-input');
    await input.setValue('朱熹');
    await input.trigger('keydown', { key: 'Escape' });
    await nextTick();

    expect((input.element as HTMLInputElement).value).toBe('');
  });
});

describe('BtToc 缩略图与工具条', () => {
  it('宿主传入缩略图时渲染图片，缺省渲染首字占位', () => {
    const reader = createReader();
    const wrapper = mount(BtToc, {
      props: {
        reader,
        showThumbnails: true,
        thumbnails: { 'vol-1': 'data:image/png;base64,AAA' },
      },
    });

    expect(wrapper.find('img.bt-toc__thumb').attributes('src')).toBe('data:image/png;base64,AAA');
    const placeholders = wrapper.findAll('.bt-toc__thumb--placeholder');
    expect(placeholders.map((node) => node.text())).toEqual(['朱', '为']);
  });

  it('全部展开 / 全部收起', async () => {
    const reader = createReader();
    const wrapper = mount(BtToc, { props: { reader } });
    const tools = wrapper.findAll('.bt-toc__tool');

    await tools[1]?.trigger('click');
    await nextTick();
    expect(rowTitles(wrapper)).toEqual(['卷一']);

    await tools[0]?.trigger('click');
    await nextTick();
    expect(rowTitles(wrapper)).toHaveLength(3);
  });
});

describe('sidebar-width 纯函数', () => {
  it('夹取到范围内，非法值回退最小值', () => {
    expect(clampSidebarWidth(100)).toBe(SIDEBAR_MIN_WIDTH);
    expect(clampSidebarWidth(9999)).toBe(SIDEBAR_MAX_WIDTH);
    expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_MIN_WIDTH);
    expect(clampSidebarWidth(300.4)).toBe(300);
    expect(clampSidebarWidth(300, { min: 400, max: 200 })).toBe(400);
  });

  it('按步进调整并夹取', () => {
    expect(stepSidebarWidth(280, 1)).toBe(296);
    expect(stepSidebarWidth(280, -1)).toBe(264);
    expect(stepSidebarWidth(SIDEBAR_MIN_WIDTH, -3)).toBe(SIDEBAR_MIN_WIDTH);
  });
});

describe('BtSidebarResizer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('渲染 separator 语义与当前值', () => {
    const wrapper = mount(BtSidebarResizer, { props: { modelValue: 300 } });
    const root = wrapper.find('.bt-sidebar-resizer');
    expect(root.attributes('role')).toBe('separator');
    expect(root.attributes('aria-valuenow')).toBe('300');
    expect(root.attributes('aria-valuemin')).toBe(String(SIDEBAR_MIN_WIDTH));
    expect(root.attributes('tabindex')).toBe('0');
  });

  it('方向键步进并夹取', async () => {
    const wrapper = mount(BtSidebarResizer, { props: { modelValue: 300 } });
    const root = wrapper.find('.bt-sidebar-resizer');

    await root.trigger('keydown', { key: 'ArrowRight' });
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([316]);

    await root.trigger('keydown', { key: 'ArrowLeft' });
    expect(wrapper.emitted('update:modelValue')?.[1]).toEqual([284]);

    await root.trigger('keydown', { key: 'Home' });
    expect(wrapper.emitted('update:modelValue')?.[2]).toEqual([SIDEBAR_MIN_WIDTH]);
  });

  it('双击复位到默认宽度', async () => {
    const wrapper = mount(BtSidebarResizer, { props: { modelValue: 460, defaultWidth: 280 } });
    await wrapper.find('.bt-sidebar-resizer').trigger('dblclick');

    expect(wrapper.emitted('reset')?.[0]).toEqual([280]);
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([280]);
  });

  it('拖拽按位移更新宽度', async () => {
    const wrapper = mount(BtSidebarResizer, { props: { modelValue: 280 } });
    const root = wrapper.find('.bt-sidebar-resizer');

    await root.trigger('pointerdown', { clientX: 100 });
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 140 }));
    expect(wrapper.emitted('dragstart')).toHaveLength(1);
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([320]);
    window.dispatchEvent(new MouseEvent('pointerup'));
    expect(wrapper.emitted('dragend')).toHaveLength(1);
  });

  it('禁用时不响应键盘与拖拽', async () => {
    const wrapper = mount(BtSidebarResizer, { props: { modelValue: 300, disabled: true } });
    const root = wrapper.find('.bt-sidebar-resizer');

    expect(root.attributes('tabindex')).toBe('-1');
    await root.trigger('keydown', { key: 'ArrowRight' });
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });
});
