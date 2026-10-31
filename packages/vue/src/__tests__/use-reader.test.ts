/**
 * useReader / useReaderBinding 测试
 *
 * 覆盖：文档载入后的响应式状态、Reader 实例复用、ref 源重载、
 * 重排后的页数与布局同步、scope 销毁后的事件解绑。
 */
import { describe, expect, it } from 'vitest';
import { effectScope, nextTick, ref, shallowRef } from 'vue';
import { NODE_TYPES, createEmptyDocument, type BookDocument } from '@bibliotype/core';
import { Reader, type BlockSizeEstimator } from '@bibliotype/reader';
import { useReader, useReaderBinding } from '../use-reader.js';

/** 固定尺寸估算器：按节点 id 取尺寸 */
function fixedEstimator(sizes: Record<string, number>): BlockSizeEstimator {
  return (node) => sizes[node.id ?? ''] ?? 50;
}

/** 构造：卷 > 章（标题 + 两段） + 章（一段） */
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
            {
              type: NODE_TYPES.HEADING,
              id: 'h-1',
              children: [{ type: 'text', text: '学而第一' }],
            },
            {
              type: NODE_TYPES.PARAGRAPH,
              id: 'p-1',
              children: [{ type: 'text', text: '子曰' }],
            },
            {
              type: NODE_TYPES.PARAGRAPH,
              id: 'p-2',
              children: [{ type: 'text', text: '有朋自远方来' }],
            },
          ],
        },
        {
          type: NODE_TYPES.CHAPTER,
          id: 'chap-2',
          attrs: { title: '为政第二' },
          children: [
            {
              type: NODE_TYPES.PARAGRAPH,
              id: 'p-3',
              children: [{ type: 'text', text: '为政以德' }],
            },
          ],
        },
      ],
    },
  ];
  return doc;
}

/** 尺寸：h-1=30, p-1=60, p-2=60, p-3=100（页主轴 100，共 3 页） */
const SIZES = { 'h-1': 30, 'p-1': 60, 'p-2': 60, 'p-3': 100 };

/** 在 effectScope 中运行组合式函数，返回值与停止函数 */
function runInScope<T>(factory: () => T): { value: T; stop: () => void } {
  const scope = effectScope();
  const value = scope.run(factory);
  if (value === undefined) throw new Error('effectScope.run 返回空值');
  return { value, stop: () => scope.stop() };
}

describe('useReader', () => {
  it('载入文档后暴露响应式分页状态', () => {
    const { value: binding, stop } = runInScope(() =>
      useReader(sampleDoc(), { pageMainSize: 100, estimator: fixedEstimator(SIZES) }),
    );

    expect(binding.totalPages.value).toBe(3);
    expect(binding.currentPage.value).toBe(0);
    expect(binding.progress.value).toBeCloseTo(1 / 3);
    expect(binding.pageNodes.value.map((node) => node.id)).toEqual(['h-1', 'p-1']);
    expect(binding.pageNumberText.value).toBe('1');
    expect(binding.outline.value[0]?.title).toBe('卷一');

    binding.next();
    expect(binding.currentPage.value).toBe(1);
    expect(binding.pageNumberText.value).toBe('2');
    expect(binding.pageNodes.value.map((node) => node.id)).toEqual(['p-2']);
    stop();
  });

  it('source 为 Reader 实例时直接复用并绑定', () => {
    const reader = new Reader({ pageMainSize: 100, estimator: fixedEstimator(SIZES) });
    reader.loadDocument(sampleDoc());

    const { value: binding, stop } = runInScope(() => useReader(reader));
    expect(binding.reader.value).toBe(reader);
    expect(binding.totalPages.value).toBe(3);

    reader.goToNode('p-3');
    expect(binding.currentPage.value).toBe(2);
    stop();
  });

  it('ref 文档源变化时自动重载', async () => {
    const docRef = ref<BookDocument | undefined>(undefined);
    const { value: binding, stop } = runInScope(() =>
      useReader(docRef, { pageMainSize: 100, estimator: fixedEstimator(SIZES) }),
    );

    expect(binding.totalPages.value).toBe(0);
    expect(binding.pageNumberText.value).toBe('');

    docRef.value = sampleDoc();
    await nextTick();
    expect(binding.totalPages.value).toBe(3);
    expect(binding.outline.value).toHaveLength(1);
    stop();
  });

  it('repaginate 同步页数并更新布局引用', () => {
    const { value: binding, stop } = runInScope(() =>
      useReader(sampleDoc(), { pageMainSize: 100, estimator: fixedEstimator(SIZES) }),
    );

    binding.repaginate({ pageMainSize: 500 });
    expect(binding.totalPages.value).toBe(2);
    expect(binding.currentPage.value).toBe(0);

    binding.repaginate({ layout: { writingMode: 'vertical-rl' } });
    expect(binding.layout.value.writingMode).toBe('vertical-rl');
    stop();
  });

  it('scope 销毁后事件解绑（状态不再更新）', () => {
    const { value: binding, stop } = runInScope(() =>
      useReader(sampleDoc(), { pageMainSize: 100, estimator: fixedEstimator(SIZES) }),
    );

    stop();
    expect(binding.reader.value.events.hasListeners("page:change")).toBe(false);
    binding.reader.value.nextPage();
    expect(binding.currentPage.value).toBe(0);
  });
});

describe('useReaderBinding 实例替换重绑', () => {
  it('ref 源替换 Reader 实例：事件改绑新实例、状态整体刷新（阅读区跟随换书）', async () => {
    const first = new Reader({ pageMainSize: 100, estimator: fixedEstimator(SIZES) });
    first.loadDocument(sampleDoc());
    const source = shallowRef<Reader>(first);
    const { value: binding, stop } = runInScope(() => useReaderBinding(source));
    expect(binding.totalPages.value).toBe(3);

    const second = new Reader({ pageMainSize: 40, estimator: fixedEstimator(SIZES) });
    second.loadDocument(sampleDoc());
    source.value = second;
    await nextTick();

    /* 状态整体拉到新实例：总页数、目录、当前页随新文档 */
    expect(binding.totalPages.value).toBe(second.totalPages);
    expect(binding.reader.value).toBe(second);
    /* 旧实例的事件已解绑：翻旧书不再推动状态 */
    const before = binding.currentPage.value;
    first.goToNode('p-3');
    expect(binding.currentPage.value).toBe(before);
    /* 新实例的事件已生效 */
    second.nextPage();
    expect(binding.currentPage.value).toBe(second.currentPage);
    stop();
  });
});
