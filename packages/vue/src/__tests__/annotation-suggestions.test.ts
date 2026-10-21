/**
 * 句读 / 专名建议审阅测试（K3 Vue 层）
 *
 * 覆盖：建议生成、接受 / 拒绝 / 采纳为标点、类别过滤、改类、
 * 命令返回失败时状态不前进，以及面板组件的事件契约。
 */
import { describe, expect, it, vi } from 'vitest';
import { NODE_TYPES, createEmptyDocument, type BookDocument } from '@bibliotype/core';
import type { AnnotationSuggestion } from '@bibliotype/classical';
import { mount } from '@vue/test-utils';
import BtAnnotationSuggestions from '../components/BtAnnotationSuggestions.vue';
import {
  useAnnotationSuggestions,
  type SuggestionApplyHandlers,
} from '../use-annotation-suggestions.js';

/** 样本文档：一段「孔子曰学而时习之不亦说乎」 */
function sampleDoc(text = '孔子曰学而时习之不亦说乎'): BookDocument {
  const doc = createEmptyDocument({ title: '论语' });
  doc.root.children = [
    { type: NODE_TYPES.PARAGRAPH, id: 'p-1', children: [{ type: 'text', text }] },
  ];
  return doc;
}

/** 记录调用的假执行器 */
function createHandlers(ok = true) {
  const calls: {
    judou: Array<readonly { symbol: string; suggestionId?: string }[]>;
    proper: Array<readonly { nameKind?: string; suggestionId?: string }[]>;
    commit: Array<{ suggestionIds?: readonly string[] } | undefined>;
    remove: Array<{ suggestionIds?: readonly string[] } | undefined>;
  } = { judou: [], proper: [], commit: [], remove: [] };

  const handlers: SuggestionApplyHandlers = {
    judou: vi.fn((items) => {
      calls.judou.push(items);
      return ok;
    }),
    properName: vi.fn((items) => {
      calls.proper.push(items);
      return ok;
    }),
    commitJudou: vi.fn((options) => {
      calls.commit.push(options);
      return ok;
    }),
    remove: vi.fn((options) => {
      calls.remove.push(options);
      return ok;
    }),
  };
  return { handlers, calls };
}

describe('useAnnotationSuggestions', () => {
  it('按文档生成句读与专名建议', () => {
    const { handlers } = createHandlers();
    const state = useAnnotationSuggestions({ document: () => sampleDoc(), apply: handlers });

    expect(state.pending.value.length).toBeGreaterThan(0);
    expect(state.pending.value.some((item) => item.kind === 'judou')).toBe(true);
    expect(state.pending.value.some((item) => item.kind === 'proper-name')).toBe(true);
    expect(state.counts.value['proper-name']).toBe(1);
  });

  it('接受后从待处理列表移除，并把 symbol / nameKind 传给命令', () => {
    const { handlers, calls } = createHandlers();
    const state = useAnnotationSuggestions({ document: () => sampleDoc(), apply: handlers });

    expect(state.accept()).toBeGreaterThan(0);
    expect(state.pending.value).toHaveLength(0);
    expect(calls.judou[0]?.[0]?.symbol).toBeDefined();
    expect(calls.proper[0]?.[0]?.nameKind).toBe('person');
    // 全部进入 accepted
    expect(Object.values(state.decisions.value).every((value) => value === 'accepted')).toBe(true);
  });

  it('拒绝调用 remove，且不再出现在待处理列表', () => {
    const { handlers, calls } = createHandlers();
    const state = useAnnotationSuggestions({ document: () => sampleDoc(), apply: handlers });
    const target = state.pending.value[0]!;

    expect(state.reject([target.id])).toBe(1);
    expect(calls.remove[0]?.suggestionIds).toEqual([target.id]);
    expect(state.decisions.value[target.id]).toBe('rejected');
    expect(state.pending.value.some((item) => item.id === target.id)).toBe(false);
  });

  it('采纳为标点只提交已接受的句读', () => {
    const { handlers, calls } = createHandlers();
    const state = useAnnotationSuggestions({ document: () => sampleDoc(), apply: handlers });

    const judouIds = state.pending.value
      .filter((item) => item.kind === 'judou')
      .map((item) => item.id);
    state.accept(judouIds);
    expect(state.commitJudou()).toBe(judouIds.length);
    expect(calls.commit[0]?.suggestionIds).toEqual(judouIds);
    expect(judouIds.every((id) => state.decisions.value[id] === 'committed')).toBe(true);
  });

  it('过滤只影响可见列表，不影响计数', () => {
    const { handlers } = createHandlers();
    const state = useAnnotationSuggestions({ document: () => sampleDoc(), apply: handlers });
    const total = state.counts.value.judou + state.counts.value['proper-name'];

    state.filter.value = 'judou';
    expect(state.visible.value.every((item) => item.kind === 'judou')).toBe(true);
    expect(state.counts.value.judou + state.counts.value['proper-name']).toBe(total);
  });

  it('改类后接受，命令收到覆盖值', () => {
    const { handlers, calls } = createHandlers();
    const state = useAnnotationSuggestions({ document: () => sampleDoc(), apply: handlers });
    const target = state.pending.value.find((item) => item.kind === 'judou')!;

    state.setOverride(target.id, { symbol: '；' });
    expect(state.visible.value.find((item) => item.id === target.id)?.symbol).toBe('；');

    state.accept([target.id]);
    expect(calls.judou[0]?.[0]?.symbol).toBe('；');
  });

  it('命令返回失败时状态不前进', () => {
    const { handlers } = createHandlers(false);
    const state = useAnnotationSuggestions({ document: () => sampleDoc(), apply: handlers });
    const before = state.pending.value.length;

    expect(state.accept()).toBe(0);
    expect(state.pending.value).toHaveLength(before);
    expect(state.decisions.value).toEqual({});
  });

  it('文档为空时没有建议', () => {
    const { handlers } = createHandlers();
    const state = useAnnotationSuggestions({ document: () => undefined, apply: handlers });
    expect(state.all.value).toEqual([]);
    expect(state.visible.value).toEqual([]);
  });
});

describe('BtAnnotationSuggestions', () => {
  const suggestions: AnnotationSuggestion[] = [
    {
      id: 'judou:p-1:2:3:：',
      kind: 'judou',
      blockId: 'p-1',
      start: 2,
      end: 3,
      text: '曰',
      symbol: '：',
      confidence: 0.85,
      source: 'auto',
    },
    {
      id: 'proper-name:p-1:0:2',
      kind: 'proper-name',
      blockId: 'p-1',
      start: 0,
      end: 2,
      text: '孔子',
      name: '孔子',
      nameKind: 'person',
      confidence: 0.9,
      source: 'auto',
    },
  ];

  it('渲染建议行并抛出接受 / 拒绝事件', async () => {
    const wrapper = mount(BtAnnotationSuggestions, {
      props: { suggestions, counts: { judou: 1, 'proper-name': 1 } },
    });

    expect(wrapper.findAll('.bt-suggestions__item')).toHaveLength(2);
    expect(wrapper.text()).toContain('孔子');

    const rows = wrapper.findAll('.bt-suggestions__item');
    await rows[0]!.find('.bt-suggestions__accept').trigger('click');
    expect(wrapper.emitted('accept')?.[0]).toEqual([['judou:p-1:2:3:：']]);

    await rows[1]!.find('.bt-suggestions__reject').trigger('click');
    expect(wrapper.emitted('reject')?.[0]).toEqual([['proper-name:p-1:0:2']]);
  });

  it('筛选按钮与批量按钮发出正确事件', async () => {
    const wrapper = mount(BtAnnotationSuggestions, { props: { suggestions } });

    await wrapper.findAll('.bt-suggestions__filter')[1]!.trigger('click');
    expect(wrapper.emitted('update:filter')?.[0]).toEqual(['judou']);

    await wrapper.findAll('.bt-suggestions__bulk')[0]!.trigger('click');
    expect(wrapper.emitted('accept')?.[0]).toEqual([suggestions.map((item) => item.id)]);

    await wrapper.findAll('.bt-suggestions__bulk')[2]!.trigger('click');
    expect(wrapper.emitted('commit')?.[0]).toEqual([[]]);
  });

  it('改标点 / 改类发出 override 事件', async () => {
    const wrapper = mount(BtAnnotationSuggestions, { props: { suggestions } });
    const selects = wrapper.findAll('.bt-suggestions__select');

    await selects[0]!.setValue('；');
    expect(wrapper.emitted('override')?.[0]).toEqual(['judou:p-1:2:3:：', { symbol: '；' }]);

    await selects[1]!.setValue('place');
    expect(wrapper.emitted('override')?.[1]).toEqual([
      'proper-name:p-1:0:2',
      { nameKind: 'place' },
    ]);
  });

  it('空态文案与禁用态', () => {
    const wrapper = mount(BtAnnotationSuggestions, {
      props: { suggestions: [], emptyText: '没有建议了', disabled: true },
    });
    expect(wrapper.find('.bt-suggestions__empty').text()).toBe('没有建议了');
    expect(wrapper.findAll('.bt-suggestions__bulk').every((item) => item.attributes('disabled') !== undefined)).toBe(true);
  });

  it('点击原文片段发出定位事件', async () => {
    const wrapper = mount(BtAnnotationSuggestions, { props: { suggestions } });
    await wrapper.findAll('.bt-suggestions__excerpt')[1]!.trigger('click');
    expect(wrapper.emitted('locate')?.[0]?.[0]).toMatchObject({ id: 'proper-name:p-1:0:2' });
  });
});
