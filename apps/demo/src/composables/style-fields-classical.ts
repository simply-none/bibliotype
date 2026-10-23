/**
 * 古籍样式字段表（圈点 / 专名 / 书名等标记 + 注疏 + 版本形态）
 *
 * 与 `style-fields-core.ts` 合成完整 `STYLE_FIELDS`（见 `use-style-schema.ts` 门面）；
 * 新增一个可调参数只改本表，不改组件。
 */
import type { FeatureStyleId } from '@bibliotype/core';
import {
  BORDER_STYLE_OPTIONS,
  EMPHASIS_POSITION_OPTIONS,
  EMPHASIS_STYLE_OPTIONS,
  TEXT_DECORATION_STYLE_OPTIONS,
} from './style-options.js';
import { borderTriple, color, num, select, text, type StyleField } from './style-field-helpers.js';

/** 古籍标记与注疏 / 版本形态字段 */
export const CLASSICAL_STYLE_FIELDS: Partial<Record<FeatureStyleId, StyleField[]>> = {
  /* ---------- 古籍标记 ---------- */
  'mark.proper-name': [
    select('border-bottom-style', '线型', BORDER_STYLE_OPTIONS, '线型'),
    num('border-bottom-width', '线宽', 'px', 0, 8, 1, '线型'),
    color('border-bottom-color', '线色', '线型'),
    num('border-bottom', '与字距', 'px', 0, 8, 1, '线型'),
    select('text-decoration-line', '改用下划线', [
      { value: 'none', label: '否（用边框）' },
      { value: 'underline', label: '是' },
    ], '线型'),
  ],
  'mark.book-title': [
    select('text-decoration-style', '线型', TEXT_DECORATION_STYLE_OPTIONS, '线型'),
    num('text-decoration-thickness', '线宽', 'px', 0, 8, 1, '线型'),
    color('text-decoration-color', '线色', '线型'),
    num('text-underline-offset', '偏移', 'px', 0, 12, 1, '线型'),
  ],
  'mark.circle-emphasis': [
    select('text-emphasis', '圈点样式', EMPHASIS_STYLE_OPTIONS, '样式'),
    select('text-emphasis-position', '位置', EMPHASIS_POSITION_OPTIONS, '样式'),
    color('text-emphasis-color', '颜色', '样式'),
  ],
  /* 句读候选：只调候选符号的颜色与浓淡（符号本身由 mark 的 data-symbol 决定） */
  'mark.judou': [
    color('color', '候选符号颜色', '符号'),
    num('opacity', '候选符号透明度', '', 0, 1, 0.05, '符号'),
  ],
  'mark.note-ref': [
    text('font-size', '字号', '如 0.72em', '字符'),
    select('vertical-align', '对齐', [
      { value: 'super', label: '上标' },
      { value: 'baseline', label: '基线' },
      { value: 'sub', label: '下标' },
    ], '位置'),
    color('color', '颜色', '字符'),
  ],
  'mark.variant': [
    select('text-decoration-style', '线型', TEXT_DECORATION_STYLE_OPTIONS, '标记线'),
    color('text-decoration-color', '线色', '标记线'),
  ],
  'mark.taboo': [
    select('text-decoration-style', '线型', TEXT_DECORATION_STYLE_OPTIONS, '标记线'),
    color('text-decoration-color', '线色', '标记线'),
  ],

  /* ---------- 古籍注疏 ---------- */
  'block.double-note': [
    text('font-size', '字号', '如 0.72em', '字符'),
    text('line-height', '行高', '如 1.65', '字符'),
    color('color', '颜色', '字符'),
    num('column-count', '栏数', '栏', 1, 2, 1, '版面'),
    num('column-gap', '栏距', 'em', 0, 4, 0.1, '版面'),
    num('margin-left', '左缩进', 'em', 0, 4, 0.1, '版面'),
    num('margin-top', '段前', 'em', 0, 2, 0.05, '间距'),
  ],
  'block.head-note': [
    text('font-size', '字号', '如 0.72em', '字符'),
    color('color', '颜色', '字符'),
    text('padding', '内边距', '如 0.25em 0.7em', '外观'),
    num('border-radius', '圆角', 'px', 0, 12, 1, '外观'),
    color('background-color', '底色', '外观'),
    ...borderTriple('边框'),
  ],
  'block.tail-note': [
    text('font-size', '字号', '如 0.85em', '字符'),
    color('color', '颜色', '字符'),
    num('padding-left', '左内边距', 'em', 0, 4, 0.1, '版面'),
    select('border-top-style', '上分隔线', BORDER_STYLE_OPTIONS, '边框'),
    color('border-top-color', '分隔线色', '边框'),
  ],
  'block.collation-note': [
    text('font-size', '字号', '如 0.7em', '字符'),
    color('color', '颜色', '字符'),
    select('border-left-style', '左线型', BORDER_STYLE_OPTIONS, '左边线'),
    num('border-left-width', '左线宽', 'px', 0, 8, 1, '左边线'),
    color('border-left-color', '左线色', '左边线'),
    num('padding-left', '左内边距', 'em', 0, 4, 0.05, '版面'),
  ],
  'block.inline-note': [
    text('font-size', '字号', '如 0.85em', '字符'),
    color('color', '颜色', '字符'),
  ],
  'block.collation-mark': [
    text('font-size', '字号', '如 1em', '字符'),
    color('color', '颜色', '字符'),
    text('margin-left', '左间距', '如 0.15em', '版面'),
    text('margin-right', '右间距', '如 0.15em', '版面'),
  ],

  /* ---------- 古籍版本形态 ---------- */
  'block.seal': [
    ...borderTriple('边框'),
    num('border-radius', '圆角', 'px', 0, 12, 1, '边框'),
    text('padding', '内边距', '如 0.1em 0.3em', '尺寸'),
    text('font-size', '字号', '如 0.9em', '字符'),
    color('color', '文字与边框色', '字符'),
    text('transform', '旋转', '如 rotate(-3deg)', '外观'),
  ],
  'block.fish-tail': [
    num('width', '宽度', 'em', 0.2, 3, 0.1, '尺寸'),
    num('height', '高度', 'em', 0.2, 3, 0.1, '尺寸'),
    color('border-top-color', '线色', '外观'),
  ],
  'block.border-frame': [
    ...borderTriple('边框'),
    text('padding', '内边距', '如 0.5em 0.75em', '尺寸'),
    num('margin-top', '段前', 'em', 0, 4, 0.1, '间距'),
  ],
  'block.imprint': [
    text('font-size', '字号', '如 0.78em', '字符'),
    color('color', '颜色', '字符'),
    text('padding', '内边距', '如 0.5em 1em', '外观'),
    ...borderTriple('边框'),
    text('letter-spacing', '字距', '如 0.1em', '字符'),
  ],
  'block.colophon': [
    text('font-size', '字号', '如 0.78em', '字符'),
    color('color', '颜色', '字符'),
    select('border-top-style', '上分隔线', BORDER_STYLE_OPTIONS, '边框'),
    color('border-top-color', '分隔线色', '边框'),
  ],
  'block.variant-char': [
    select('text-decoration-style', '线型', TEXT_DECORATION_STYLE_OPTIONS, '标记线'),
    color('text-decoration-color', '线色', '标记线'),
  ],
  'block.taboo-char': [
    select('text-decoration-style', '线型', TEXT_DECORATION_STYLE_OPTIONS, '标记线'),
    color('text-decoration-color', '线色', '标记线'),
  ],
};
