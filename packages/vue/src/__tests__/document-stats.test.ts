/**
 * 文档统计组合式与状态栏测试（C9）
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { countDocumentStats, createEmptyDocument } from '@bibliotype/core';
import type { BookDocument } from '@bibliotype/core';
import BtDocumentStats from '../components/BtDocumentStats.vue';
import { useDocumentStats } from '../use-document-stats.js';

function makeDoc(charCount: number): BookDocument {
  const doc = createEmptyDocument({ title: '统计' });
  doc.root.children = [
    {
      type: 'chapter',
      id: 'ch1',
      attrs: { title: '第一章' },
      children: [
        {
          type: 'paragraph',
          id: 'p1',
          children: [{ type: 'text', text: '字'.repeat(charCount) }],
        },
      ],
    },
  ];
  return doc;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('useDocumentStats', () => {
  it('初始值立即计算，引用变化后防抖重算', async () => {
    vi.useFakeTimers();
    const doc = ref(makeDoc(10));
    const scope = effectScope();
    const stats = scope.run(() =>
      useDocumentStats({ document: doc, debounceMs: 300 }),
    )!;

    expect(stats.stats.value.characters).toBe(10);

    doc.value = makeDoc(20);
    await nextTick();
    // 防抖未到期：仍是旧值
    expect(stats.stats.value.characters).toBe(10);
    vi.advanceTimersByTime(300);
    expect(stats.stats.value.characters).toBe(20);
    scope.stop();
  });

  it('revision 变化触发重算', async () => {
    vi.useFakeTimers();
    const doc = ref(makeDoc(10));
    const revision = ref(0);
    const scope = effectScope();
    const stats = scope.run(() =>
      useDocumentStats({ document: doc, revision, debounceMs: 300 }),
    )!;

    doc.value.root.children![0]!.children![0]!.children = [{ type: 'text', text: '字'.repeat(7) }];
    revision.value += 1;
    await nextTick();
    vi.advanceTimersByTime(300);
    expect(stats.stats.value.characters).toBe(7);
    scope.stop();
  });

  it('recompute 跳过防抖立即刷新', () => {
    const doc = ref(makeDoc(10));
    const scope = effectScope();
    const stats = scope.run(() => useDocumentStats({ document: doc }))!;
    doc.value = makeDoc(5);
    stats.recompute();
    expect(stats.stats.value.characters).toBe(5);
    scope.stop();
  });
});

describe('BtDocumentStats', () => {
  const stats = countDocumentStats(makeDoc(12));

  it('渲染字数 / 块数 / 时长', () => {
    const wrapper = mount(BtDocumentStats, { props: { stats } });
    expect(wrapper.text()).toContain('12');
    expect(wrapper.text()).toContain('字');
    expect(wrapper.text()).toContain('块');
  });

  it('compact 隐藏注释与章节分布', () => {
    const wrapper = mount(BtDocumentStats, { props: { stats, compact: true } });
    expect(wrapper.find('.bt-doc-stats__structures').exists()).toBe(false);
  });

  it('selectable 时点击章节点上抛 select-structure', async () => {
    const wrapper = mount(BtDocumentStats, { props: { stats, selectable: true } });
    await wrapper.find('.bt-doc-stats__structure-title').trigger('click');
    expect(wrapper.emitted('select-structure')?.[0]?.[0]).toBe('ch1');
  });
});
