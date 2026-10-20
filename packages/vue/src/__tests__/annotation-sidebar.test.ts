/**
 * BtAnnotationSidebar 组件测试：tab 过滤、章节渲染、事件上抛
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createBlockAnchor } from '@bibliotype/core';
import BtAnnotationSidebar from '../components/BtAnnotationSidebar.vue';
import type { SidebarChapter } from '../annotation-model.js';

const anchor = createBlockAnchor('p-1');

function model(): SidebarChapter[] {
  return [
    {
      id: 'ch1',
      title: '学而第一',
      items: [
        { id: 'a1', kind: 'bookmark', label: '重点', anchor },
        { id: 'a2', kind: 'note', label: '旁注', anchor },
        {
          id: 'a3',
          kind: 'comment',
          label: '存疑',
          anchor,
          resolved: false,
          comments: [{ id: 'c1', author: { id: 'u1', name: '读者' }, body: '此处存疑', createdAt: '2026-10-20T00:00:00.000Z' }],
        },
      ],
    },
  ];
}

describe('BtAnnotationSidebar', () => {
  it('渲染章节与全部标注', () => {
    const wrapper = mount(BtAnnotationSidebar, { props: { model: model() } });
    expect(wrapper.text()).toContain('学而第一');
    expect(wrapper.text()).toContain('重点');
    expect(wrapper.text()).toContain('旁注');
    expect(wrapper.text()).toContain('存疑');
  });

  it('切换 tab 过滤种类', async () => {
    const wrapper = mount(BtAnnotationSidebar, { props: { model: model() } });
    const tabs = wrapper.findAll('.bt-annotation-sidebar__tab');
    await tabs[1]!.trigger('click');
    expect(wrapper.text()).toContain('重点');
    expect(wrapper.text()).not.toContain('旁注');
    expect(wrapper.text()).not.toContain('存疑');
  });

  it('点击标注上抛 locate', async () => {
    const wrapper = mount(BtAnnotationSidebar, { props: { model: model() } });
    await wrapper.find('.bt-annotation-sidebar__locate').trigger('click');
    expect(wrapper.emitted('locate')?.[0]?.[0]).toEqual(anchor);
  });

  it('只读时隐藏删除 / 回复 / 解决', () => {
    const wrapper = mount(BtAnnotationSidebar, { props: { model: model(), readonly: true } });
    expect(wrapper.find('.bt-annotation-sidebar__remove').exists()).toBe(false);
    expect(wrapper.find('.bt-annotation-sidebar__resolve').exists()).toBe(false);
  });

  it('评论线程回复上抛 reply', async () => {
    const wrapper = mount(BtAnnotationSidebar, { props: { model: model() } });
    const input = wrapper.find('.bt-annotation-sidebar__reply input');
    await input.setValue('赞同');
    await input.trigger('keyup', { key: 'Enter' });
    expect(wrapper.emitted('reply')?.[0]?.[0]).toEqual({ id: 'a3', body: '赞同' });
  });
});
