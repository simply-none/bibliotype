/**
 * 字形回退决策测试（K6）
 *
 * 覆盖固定顺序：主字体链 → IDS 合成 → 方框；以及探测缺省、私用区标记、
 * 非法 IDS 描述不参与合成。
 */
import { describe, expect, it } from 'vitest';
import type { GlyphProbe } from '../font-coverage.js';
import { describeGlyphFallback, resolveGlyphFallback } from '../glyph-fallback.js';

/** 构造「指定族覆盖指定字符」的假探测 */
function probeOf(table: Record<string, string>): GlyphProbe {
  return (char, family) => (table[family] ?? '').includes(char);
}

describe('resolveGlyphFallback', () => {
  it('命中字体链时取首个命中的族', () => {
    const result = resolveGlyphFallback('山', {
      families: ['A', 'B'],
      probe: probeOf({ B: '山' }),
    });
    expect(result.stage).toBe('font');
    expect(result.family).toBe('B');
    expect(result.missing).toBe(false);
    expect(result.code).toBe('U+5C71');
  });

  it('全链未命中且有合法 IDS 时改用合成', () => {
    const result = resolveGlyphFallback('𫞩', {
      families: ['A'],
      probe: probeOf({}),
      idsFor: () => '⿰山夆',
    });
    expect(result.stage).toBe('ids');
    expect(result.idsDescription).toBe('⿰山夆');
    expect(result.idsTree?.kind).toBe('compound');
    expect(result.missing).toBe(false);
    expect(describeGlyphFallback(result)).toContain('IDS');
  });

  it('IDS 描述非法时不合成，落到方框并标记缺字', () => {
    const result = resolveGlyphFallback('𫞩', {
      families: ['A'],
      probe: probeOf({}),
      idsFor: () => '⿰山',
    });
    expect(result.stage).toBe('tofu');
    expect(result.missing).toBe(true);
    expect(result.description).toContain('缺字');
  });

  it('无探测端口时按命中处理（宁漏报不误报）', () => {
    const result = resolveGlyphFallback('𫞩', { families: ['A'] });
    expect(result.stage).toBe('font');
    expect(result.missing).toBe(false);
  });

  it('私用区字符带 privateUse 标记', () => {
    const result = resolveGlyphFallback('\uE000', {
      families: ['A'],
      probe: probeOf({}),
    });
    expect(result.privateUse).toBe(true);
    expect(describeGlyphFallback(result)).toContain('私用区');
  });
});
