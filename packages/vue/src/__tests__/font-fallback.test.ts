/**
 * 字体回退调试面板测试：逐字命中展示、缺字标红与码位、私用区标记。
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import type { GlyphProbe } from '@bibliotype/core';
import BtFontFallbackPanel from '../components/BtFontFallbackPanel.vue';
import { splitFontFamilyList } from '../font-probe.js';

/** 假探测：只有 Songti 覆盖「子」「A」 */
function probe(): GlyphProbe {
  return (char, family) => family === 'Songti' && (char === '子' || char === 'A');
}

describe('splitFontFamilyList', () => {
  it('按逗号拆分并去掉引号与空格', () => {
    expect(splitFontFamilyList('"Songti SC", Kaiti, serif')).toEqual([
      'Songti SC',
      'Kaiti',
      'serif',
    ]);
  });

  it('空串与多余逗号不产生空项', () => {
    expect(splitFontFamilyList(' , ')).toEqual([]);
    expect(splitFontFamilyList('')).toEqual([]);
  });
});

describe('BtFontFallbackPanel', () => {
  it('逐字给出命中字体与码位', () => {
    const wrapper = mount(BtFontFallbackPanel, {
      props: { text: '子A', families: ['Songti'], probe: probe() },
    });
    const cells = wrapper.findAll('.bt-font-fallback__cell');
    expect(cells).toHaveLength(2);
    expect(cells[0]?.text()).toContain('U+5B50');
    expect(cells[0]?.attributes('title')).toContain('Songti');
    expect(wrapper.find('.bt-font-fallback__summary').text()).toBe('共 2 字 · 缺 0 字');
  });

  it('缺字标红并列出码位', () => {
    const wrapper = mount(BtFontFallbackPanel, {
      props: { text: '子B', families: ['Songti'], probe: probe() },
    });
    const missing = wrapper.findAll('.bt-font-fallback__cell--missing');
    expect(missing).toHaveLength(1);
    expect(missing[0]?.text()).toContain('B');
    expect(wrapper.find('.bt-font-fallback__missing').text()).toContain('U+0042');
    expect(wrapper.find('.bt-font-fallback__summary').text()).toBe('共 2 字 · 缺 1 字');
  });

  it('私用区字符加虚线标记', () => {
    const wrapper = mount(BtFontFallbackPanel, {
      props: { text: '\uE001', families: ['Songti'], probe: probe() },
    });
    expect(wrapper.find('.bt-font-fallback__cell--private').exists()).toBe(true);
    expect(wrapper.find('.bt-font-fallback__cell--private').attributes('title')).toContain('私用区');
  });

  it('未配置回退链时给出提示', () => {
    const wrapper = mount(BtFontFallbackPanel, {
      props: { text: '子', families: [], probe: probe() },
    });
    expect(wrapper.find('.bt-font-fallback__hint').text()).toContain('未配置字体回退链');
  });

  it('maxChars 截断超长文本', () => {
    const wrapper = mount(BtFontFallbackPanel, {
      props: { text: '子A子A子A', families: ['Songti'], probe: probe(), maxChars: 2 },
    });
    expect(wrapper.findAll('.bt-font-fallback__cell')).toHaveLength(2);
  });
});
