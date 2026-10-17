/**
 * 功能样式选择器 / 覆盖规则生成测试
 *
 * 覆盖改造的关键约束：
 * - 未登记的功能 id 不得猜测选择器（防污染无关元素）；
 * - 用户覆盖必须能与默认规则的优先级对齐（否则「改了不生效」）；
 * - 命名样式排在功能样式之后（单节点覆盖统一风格）；
 * - 直排下专名号的边向声明要转写。
 */
import { describe, expect, it } from 'vitest';
import type { FeatureStyleSheet, NamedStyleSet } from '@bibliotype/core';
import {
  buildFeatureCss,
  collectFeatureRules,
  listFeatureSelectors,
  resolveFeatureSelector,
  translateSideDeclarations,
} from '../html/feature-selectors.js';

describe('resolveFeatureSelector', () => {
  it('返回登记过的选择器（不含容器前缀）', () => {
    expect(resolveFeatureSelector('block.paragraph')).toBe('.bt-paragraph');
    expect(resolveFeatureSelector('block.heading.2')).toBe('h2.bt-heading');
    expect(resolveFeatureSelector('role.page-number')).toBe('.bt-page-number');
    expect(resolveFeatureSelector('role.page-header')).toBe('.bt-page-header');
  });

  it('未知功能 / 未来版本 id 返回 undefined（不做猜测）', () => {
    expect(resolveFeatureSelector('block.unknown')).toBeUndefined();
    expect(resolveFeatureSelector('mark.future-thing')).toBeUndefined();
  });

  it('全部登记项都是非空字符串', () => {
    const selectors = listFeatureSelectors();
    expect(selectors.length).toBeGreaterThan(40);
    for (const [id, selector] of selectors) {
      expect(id.length).toBeGreaterThan(0);
      expect(selector.length).toBeGreaterThan(0);
    }
  });
});

describe('buildFeatureCss', () => {
  it('空样式表 / 空声明组不产出任何规则', () => {
    expect(buildFeatureCss(undefined)).toBe('');
    expect(buildFeatureCss({})).toBe('');
    expect(buildFeatureCss({ 'block.paragraph': {} })).toBe('');
  });

  it('规则带容器前缀，且只输出声明的属性', () => {
    const features: FeatureStyleSheet = {
      'block.paragraph': { color: '#123456' },
    };
    const css = buildFeatureCss(features, { containerSelector: '.bt-reader-page' });
    expect(css).toBe('.bt-reader-page .bt-paragraph {\n  color: #123456;\n}');
  });

  it('带属性变体的功能用同优先级覆盖选择器（circle-emphasis / break）', () => {
    const features: FeatureStyleSheet = {
      'mark.circle-emphasis': { 'text-emphasis': 'open circle' },
      'block.break': { color: '#999' },
    };
    const rules = collectFeatureRules(features, undefined, 'body');
    expect(rules.map((rule) => rule.selector)).toEqual([
      'body .bt-mark-circle-emphasis[data-style]',
      'body .bt-break[data-variant]',
    ]);
  });

  it('命名样式排在功能样式之后（同优先级靠层叠顺序覆盖）', () => {
    const features: FeatureStyleSheet = { 'block.paragraph': { color: '#111' } };
    const namedStyles: NamedStyleSet = {
      version: 1,
      styles: [
        {
          id: 'bt-style-1',
          name: '题解',
          featureId: 'block.paragraph',
          declarations: { color: '#222' },
        },
      ],
    };
    const css = buildFeatureCss(features, { namedStyles, containerSelector: '.bt-page' });
    expect(css.indexOf('.bt-page .bt-paragraph')).toBeLessThan(
      css.indexOf('.bt-page [data-style-id="bt-style-1"]'),
    );
    expect(css).toContain('color: #222;');
  });

  it('命名样式的空声明不产出规则；id 里的引号被转义', () => {
    const namedStyles: NamedStyleSet = {
      version: 1,
      styles: [
        { id: 'empty', name: '空', featureId: 'block.paragraph', declarations: {} },
        { id: 'a"b', name: '引号', featureId: 'block.paragraph', declarations: { color: 'red' } },
      ],
    };
    const css = buildFeatureCss({}, { namedStyles });
    expect(css).not.toContain('[data-style-id="empty"]');
    expect(css).toContain('[data-style-id="a\\"b"]');
  });
});

describe('translateSideDeclarations', () => {
  it('横排原样保留', () => {
    expect(translateSideDeclarations({ 'border-bottom': '1px solid red' }, false)).toEqual({
      'border-bottom': '1px solid red',
    });
  });

  it('直排把上下边换成左右边（专名号随书写方向）', () => {
    expect(translateSideDeclarations({ 'border-bottom': '1px solid red' }, true)).toEqual({
      'border-left': '1px solid red',
    });
    expect(translateSideDeclarations({ 'padding-bottom': '2px' }, true)).toEqual({
      'padding-left': '2px',
    });
  });

  it('长写法（带 -width 后缀）同样转写', () => {
    expect(translateSideDeclarations({ 'border-bottom-width': '2px' }, true)).toEqual({
      'border-left-width': '2px',
    });
  });

  it('与方向无关的声明原样保留', () => {
    expect(translateSideDeclarations({ color: 'red', 'border-radius': '2px' }, true)).toEqual({
      color: 'red',
      'border-radius': '2px',
    });
  });
});
