/**
 * 主题面板测试：预设切换、排版令牌保留、导出往返、非法导入拒绝、重置。
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import {
  COLOR_TOKENS,
  DEFAULT_THEME,
  FONT_SIZE_TOKENS,
  parseThemePreset,
  serializeThemePreset,
  type ThemePreset,
  type ThemeToken,
} from '@bibliotype/core';
import BtThemePanel from '../components/BtThemePanel.vue';

type Tokens = Record<ThemeToken, string>;

/** 带用户自定义字号的当前令牌 */
function currentTokens(): Tokens {
  return { ...DEFAULT_THEME, [FONT_SIZE_TOKENS.BODY]: '22px' };
}

/** 取最近一次 update:tokens 载荷 */
function lastTokens(wrapper: ReturnType<typeof mount>): Tokens {
  const emitted = wrapper.emitted('update:tokens') ?? [];
  return emitted[emitted.length - 1]?.[0] as Tokens;
}

describe('BtThemePanel 预设切换', () => {
  it('渲染内置三套预设卡片', () => {
    const wrapper = mount(BtThemePanel, { props: { tokens: currentTokens() } });
    const names = wrapper.findAll('.bt-theme-panel__name').map((node) => node.text());
    expect(names).toEqual(['夜间', '护眼', '羊皮纸']);
  });

  it('应用夜间预设时改颜色、保留用户字号', async () => {
    const wrapper = mount(BtThemePanel, { props: { tokens: currentTokens() } });
    await wrapper.findAll('.bt-theme-panel__card')[0]?.trigger('click');

    const next = lastTokens(wrapper);
    expect(next[COLOR_TOKENS.BACKGROUND]).toBe('#1C1B19');
    expect(next[COLOR_TOKENS.TEXT]).toBe('#E8E4DC');
    // 解耦验收：切换主题不丢自定义字号
    expect(next[FONT_SIZE_TOKENS.BODY]).toBe('22px');
    expect(wrapper.emitted('apply')?.[0]).toEqual(['night']);
    expect(wrapper.find('.bt-theme-panel__current').text()).toContain('夜间');
  });

  it('重置回到基线令牌并清空选中态', async () => {
    const wrapper = mount(BtThemePanel, { props: { tokens: currentTokens() } });
    const buttons = wrapper.findAll('.bt-theme-panel__button');
    await buttons[0]?.trigger('click');

    expect(lastTokens(wrapper)).toEqual(currentTokens());
    expect(wrapper.find('.bt-theme-panel__current').text()).toContain('自定义');
  });

  it('baseTokens 决定重置目标', async () => {
    const base = { ...DEFAULT_THEME, [COLOR_TOKENS.BACKGROUND]: '#FFFFFF' };
    const wrapper = mount(BtThemePanel, {
      props: { tokens: currentTokens(), baseTokens: base },
    });
    await wrapper.findAll('.bt-theme-panel__button')[0]?.trigger('click');
    expect(lastTokens(wrapper)).toEqual(base);
  });
});

describe('BtThemePanel 导入导出', () => {
  it('导出当前令牌为主题包，可再解析', async () => {
    const tokens = currentTokens();
    const wrapper = mount(BtThemePanel, { props: { tokens } });
    await wrapper.findAll('.bt-theme-panel__button')[1]?.trigger('click');

    const json = wrapper.emitted('export')?.[0]?.[0] as string;
    const preset = parseThemePreset(json);
    expect(preset.id).toBe('custom-theme');
    expect(preset.tokens[FONT_SIZE_TOKENS.BODY]).toBe('22px');
    expect(preset.tokens[COLOR_TOKENS.TEXT]).toBe(tokens[COLOR_TOKENS.TEXT]);
  });

  it('导出再导入视觉一致（全量应用含排版令牌）', async () => {
    const tokens = currentTokens();
    const wrapper = mount(BtThemePanel, { props: { tokens } });
    await wrapper.findAll('.bt-theme-panel__button')[1]?.trigger('click');
    const json = wrapper.emitted('export')?.[0]?.[0] as string;

    await wrapper.find('.bt-theme-panel__textarea').setValue(json);
    await wrapper.findAll('.bt-theme-panel__button')[2]?.trigger('click');

    expect(lastTokens(wrapper)).toEqual(tokens);
    expect(wrapper.find('.bt-theme-panel__issues').exists()).toBe(false);
  });

  it('非法主题包被拒并列出问题', async () => {
    const wrapper = mount(BtThemePanel, { props: { tokens: currentTokens() } });
    await wrapper.find('.bt-theme-panel__textarea').setValue('{"kind":"nope"}');
    await wrapper.findAll('.bt-theme-panel__button')[2]?.trigger('click');

    expect(wrapper.emitted('update:tokens')).toBeUndefined();
    const issues = wrapper.find('.bt-theme-panel__issues');
    expect(issues.exists()).toBe(true);
    expect(issues.text()).toContain('kind');
  });

  it('导入自定义主题后卡片立即出现并可回切', async () => {
    const wrapper = mount(BtThemePanel, { props: { tokens: currentTokens() } });
    const custom: ThemePreset = {
      id: 'my-theme',
      name: '我的主题',
      tokens: { [COLOR_TOKENS.BACKGROUND]: '#123456' },
    };
    await wrapper.find('.bt-theme-panel__textarea').setValue(serializeThemePreset(custom));
    await wrapper.findAll('.bt-theme-panel__button')[2]?.trigger('click');

    const names = wrapper.findAll('.bt-theme-panel__name').map((node) => node.text());
    expect(names).toContain('我的主题');

    // 再切回内置预设
    await wrapper.findAll('.bt-theme-panel__card')[0]?.trigger('click');
    expect(lastTokens(wrapper)[COLOR_TOKENS.BACKGROUND]).toBe('#1C1B19');
    expect(wrapper.emitted('apply')?.length).toBeGreaterThan(0);
  });
});
