/**
 * K5 六套仿真模板的版心字段序列（模板即契约：改字段必须改测试与文档）
 */
import { describe, expect, it } from 'vitest';
import { FACSIMILE_PRESETS } from '../facsimile-presets.js';

describe('FACSIMILE_PRESETS 版心字段', () => {
  it('每套模板都声明字段且含叶次', () => {
    for (const preset of FACSIMILE_PRESETS) {
      const fields = preset.layout.facsimile?.gutter?.fields ?? [];
      expect(fields.length, preset.id).toBeGreaterThan(0);
      expect(fields, preset.id).toContain('pageNumber');
    }
  });

  it('字段序列按形制区分（不全部相同）', () => {
    const sequences = new Map(
      FACSIMILE_PRESETS.map((preset) => [
        preset.id,
        (preset.layout.facsimile?.gutter?.fields ?? []).join(','),
      ]),
    );
    expect(sequences.get('song-zhe')).toBe('bookTitle,volumeTitle,pageNumber');
    expect(sequences.get('ming-jiajing')).toBe('bookTitle,chapterTitle,pageNumber');
    expect(sequences.get('qing-dianben')).toBe(
      'bookTitle,volumeTitle,chapterTitle,pageNumber',
    );
    expect(sequences.get('zhushilan')).toBe('volumeTitle,pageNumber');
    expect(sequences.get('jinxiang')).toBe('chapterTitle,pageNumber');
    expect(new Set(sequences.values()).size).toBeGreaterThan(3);
  });
});
