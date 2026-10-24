/**
 * 古籍仿真版式模板测试
 *
 * 锁定三件事：
 * 1. 六个模板的行款（每半页行数 × 每行字数）与文档表格一致——模板数值改动
 *    必须先改表格与断言，避免「模板悄悄变形」；
 * 2. 模板数据自洽（id 唯一、`facsimile.preset` 与 id 对齐、关键令牌齐全）；
 * 3. 套用是纯函数（不改入参、保留基准布局的其它字段，如页眉页脚）。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT_OPTIONS } from '../layout-options.js';
import {
  DEFAULT_FACSIMILE_PRESET_ID,
  FACSIMILE_PRESETS,
  applyFacsimilePreset,
  resolveFacsimilePreset,
} from '../facsimile-presets.js';
import { FACSIMILE_FONT_TOKENS, FACSIMILE_FRAMES } from '../facsimile.js';
import { resolveFacsimileGrid } from '../facsimile-geometry.js';

/** 文档表格中声明的行款（改模板必须同步改这里） */
const EXPECTED_GRID: Readonly<Record<string, { lines: number; chars: number }>> = {
  'song-zhe': { lines: 10, chars: 20 },
  'song-jian': { lines: 13, chars: 26 },
  'song-shu': { lines: 8, chars: 16 },
  'yuan-ke': { lines: 12, chars: 24 },
  'ming-jiajing': { lines: 9, chars: 18 },
  'ming-wanli': { lines: 11, chars: 24 },
  jiguge: { lines: 12, chars: 25 },
  'qing-dianben': { lines: 9, chars: 21 },
  'qing-xieke': { lines: 9, chars: 20 },
  'qing-siku': { lines: 8, chars: 21 },
  zhushilan: { lines: 10, chars: 29 },
  jinxiang: { lines: 13, chars: 30 },
};

describe('FACSIMILE_PRESETS', () => {
  it('十二个模板 id 唯一，且第一个为默认模板', () => {
    const ids = FACSIMILE_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(FACSIMILE_PRESETS).toHaveLength(12);
    expect(FACSIMILE_PRESETS[0]?.id).toBe(DEFAULT_FACSIMILE_PRESET_ID);
  });

  it('每个模板都带 facsimile 配置与版心、且 preset 与 id 对齐', () => {
    for (const preset of FACSIMILE_PRESETS) {
      expect(preset.layout.facsimile?.preset).toBe(preset.id);
      expect(preset.layout.facsimile?.gutter).toBeDefined();
      expect(preset.layout.facsimile?.frame).not.toBe(FACSIMILE_FRAMES.NONE);
      expect(preset.layout.columns).toBe(1);
      expect(preset.layout.writingMode).toBe('vertical-rl');
    }
  });

  it('行款与文档表格一致', () => {
    for (const preset of FACSIMILE_PRESETS) {
      const grid = resolveFacsimileGrid(preset.layout, preset.tokens);
      const expected = EXPECTED_GRID[preset.id];
      expect(expected, `模板 ${preset.id} 缺少期望行款`).toBeDefined();
      expect(
        { lines: grid.linesPerHalfLeaf, chars: grid.charsPerColumn },
        `模板 ${preset.id} 行款偏移`,
      ).toEqual(expected);
    }
  });

  it('令牌齐备：纸色 / 墨色 / 版框与界行颜色 / 字号行距字距 / 页边距', () => {
    for (const preset of FACSIMILE_PRESETS) {
      const tokens = preset.tokens;
      for (const key of [
        'color-background',
        'color-text',
        'page-frame-color',
        'page-rule-color',
        'gutter-color',
        'font-size-body',
        'line-height-body',
        'letter-spacing-body',
        'page-margin',
      ]) {
        expect(tokens[key], `模板 ${preset.id} 缺少令牌 ${key}`).toBeTruthy();
      }
      /* 字体族：宋体 / 仿宋模板必须自带字体栈；楷体复用 core 既有令牌 */
      if (
        preset.fontToken === FACSIMILE_FONT_TOKENS.SONG ||
        preset.fontToken === FACSIMILE_FONT_TOKENS.FANGSONG
      ) {
        expect(tokens[preset.fontToken]).toContain('serif');
      }
    }
  });

  it('版心字段随形制声明（K5：不再统一三段）', () => {
    for (const preset of FACSIMILE_PRESETS) {
      const fields = preset.layout.facsimile?.gutter?.fields ?? [];
      expect(fields.length, preset.id).toBeGreaterThan(0);
      expect(fields, preset.id).toContain('pageNumber');
      expect(fields[fields.length - 1], preset.id).toBe('pageNumber');
    }
    /* 宋刻浙本 / 武英殿本用卷次替代篇卷，巾箱本只留篇卷与叶次 */
    expect(FACSIMILE_PRESETS[0]?.layout.facsimile?.gutter?.fields).toEqual([
      'bookTitle',
      'volumeTitle',
      'pageNumber',
    ]);
  });

  it('按 id 取模板：未知 id 返回 undefined', () => {
    expect(resolveFacsimilePreset('song-zhe')?.label).toBe('宋刻浙本');
    expect(resolveFacsimilePreset('nope')).toBeUndefined();
    expect(resolveFacsimilePreset(undefined)).toBeUndefined();
  });
});

describe('applyFacsimilePreset', () => {
  it('套用后布局切换为直排 + 仿真版式，且不修改入参', () => {
    const base = { ...DEFAULT_LAYOUT_OPTIONS };
    const snapshot = JSON.stringify(base);
    const preset = FACSIMILE_PRESETS[0];
    expect(preset).toBeDefined();
    const applied = applyFacsimilePreset(base, preset as NonNullable<typeof preset>);
    expect(applied.writingMode).toBe('vertical-rl');
    expect(applied.facsimile?.preset).toBe('song-zhe');
    expect(applied.pageSize).toEqual(preset?.layout.pageSize);
    expect(JSON.stringify(base)).toBe(snapshot);
  });

  it('保留基准布局中模板未声明的字段（如页眉页脚）', () => {
    const base = {
      ...DEFAULT_LAYOUT_OPTIONS,
      pageChrome: {
        header: 'bookTitle' as const,
        footer: 'pageNumber' as const,
        headerSize: 30,
        footerSize: 30,
        mirror: true,
      },
    };
    const preset = FACSIMILE_PRESETS[0];
    const applied = applyFacsimilePreset(base, preset as NonNullable<typeof preset>);
    expect(applied.pageChrome).toEqual(base.pageChrome);
    expect(applied.pageChrome?.mirror).toBe(true);
  });
});
