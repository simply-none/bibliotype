/**
 * IDS 合成字形 SVG 测试（K6）
 *
 * 覆盖：结构输出、确定性（同输入逐字节一致）、外框、非法描述退化、
 * HTML 片段包装与转义。
 */
import { describe, expect, it } from 'vitest';
import { parseIds } from '@bibliotype/core';
import { renderIdsGlyphHtml, renderIdsSvg } from '../svg/ids-glyph.js';

describe('renderIdsSvg', () => {
  it('输出带无障碍标签的归一化 SVG', () => {
    const svg = renderIdsSvg({ description: '⿰山夆' });
    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox="0 0 100 100"');
    expect(svg).toContain('aria-label="合成字形：⿰山夆"');
    expect(svg).toContain('>山</text>');
    expect(svg).toContain('>夆</text>');
    // 两个叶子 → 两个 text
    expect(svg.match(/<text/g)).toHaveLength(2);
  });

  it('同输入逐字节一致（可快照）', () => {
    expect(renderIdsSvg({ description: '⿱⿰山夆水' })).toBe(
      renderIdsSvg({ description: '⿱⿰山夆水' }),
    );
  });

  it('可直接传入已解析树', () => {
    const tree = parseIds('⿰山夆').tree!;
    expect(renderIdsSvg({ tree })).toContain('>山</text>');
  });

  it('frame 开启时画外框', () => {
    const svg = renderIdsSvg({ description: '⿰山夆', frame: true });
    expect(svg).toContain('rx="3"');
  });

  it('描述非法时返回空串（调用方保留原字符）', () => {
    expect(renderIdsSvg({ description: '⿰山' })).toBe('');
    expect(renderIdsSvg({ description: '' })).toBe('');
  });
});

describe('renderIdsGlyphHtml', () => {
  it('包装为可内联的书页片段', () => {
    const html = renderIdsGlyphHtml('⿰山夆');
    expect(html).toContain('class="bt-glyph bt-glyph--ids"');
    expect(html).toContain('data-ids="⿰山夆"');
    expect(html).toContain('<svg');
  });

  it('描述中的尖括号被转义', () => {
    const html = renderIdsGlyphHtml('⿰<>');
    expect(html).toContain('data-ids="⿰&lt;&gt;"');
    expect(html).not.toContain('data-ids="⿰<>"');
  });

  it('非法描述返回空串', () => {
    expect(renderIdsGlyphHtml('⿰山')).toBe('');
  });
});
