/**
 * K5 印章印谱：SVG 确定性、朱文/白文、回文排字、序列化接入
 */
import { describe, expect, it } from 'vitest';
import { serializeNode } from '../html/index.js';
import { renderSealSvg } from '../svg/seal.js';

describe('renderSealSvg', () => {
  it('同输入字节一致，不同风格字节不同', () => {
    const once = renderSealSvg({ text: '藏书' });
    const twice = renderSealSvg({ text: '藏书' });
    expect(once).toBe(twice);
    expect(renderSealSvg({ text: '藏书', style: 'bai' })).not.toBe(once);
    expect(once).not.toMatch(/Date|random|timestamp/);
  });

  it('朱文无边框时不画矩形，白文铺底朱色', () => {
    const zhu = renderSealSvg({ text: '印', style: 'zhu', border: 'none' });
    expect(zhu).not.toContain('<rect');
    expect(zhu).toContain('fill="#b03a2e"');

    const bai = renderSealSvg({ text: '印', style: 'bai' });
    expect(bai).toContain('<rect');
    expect(bai).toContain('fill="#ffffff"');
  });

  it('方印回文：四字按右上→右下→左上→左下排字', () => {
    const svg = renderSealSvg({ text: '甲乙丙丁', layout: 'square' });
    expect(svg).toContain('x="75" y="36"');
    expect(svg).toContain('x="75" y="70"');
    expect(svg).toContain('x="25" y="36"');
    expect(svg).toContain('x="25" y="70"');
    expect((svg.match(/<text/g) ?? []).length).toBe(4);
  });

  it('竖排：单列居中，取前四字', () => {
    const svg = renderSealSvg({ text: '甲乙丙丁戊', layout: 'column' });
    expect((svg.match(/<text/g) ?? []).length).toBe(4);
    expect(svg).toContain('x="50"');
    expect(svg).not.toContain('>戊<');
  });

  it('转义印文与显式尺寸', () => {
    const svg = renderSealSvg({ text: '<&', size: 32 });
    expect(svg).toContain('&lt;&amp;');
    expect(svg).toContain('width="32"');
    expect(svg).toContain('aria-label="印章：<&"'.replace('<&', '&lt;&amp;'));
  });

  it('空印文返回空串', () => {
    expect(renderSealSvg({ text: '   ' })).toBe('');
  });
});

describe('seal 序列化', () => {
  const seal = {
    type: 'seal',
    attrs: { text: '藏书', style: 'bai', layout: 'square' },
  };

  it('输出内联 SVG 并保留 data-text', () => {
    const html = serializeNode(seal);
    expect(html).toContain('class="bt-seal"');
    expect(html).toContain('data-text="藏书"');
    expect(html).toContain('<svg');
    expect(html).toContain('class="bt-seal-svg"');
    /* style / layout 等只用于生成 SVG，不应重复输出为 data-* */
    expect(html).not.toContain('data-style');
    expect(html).not.toContain('data-layout');
  });

  it('关闭 SVG 时退化为空载体 + data-text', () => {
    const html = serializeNode(seal, { inlineSealSvg: false });
    expect(html).toBe('<span class="bt-seal" data-text="藏书"></span>');
  });
});
