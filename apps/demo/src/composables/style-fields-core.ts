/**
 * 现代节点样式字段表（段落 / 标题 / 块级 / 行内标记 / 页面装饰 / 结构页角色）
 *
 * 与 `style-fields-classical.ts` 合成完整 `STYLE_FIELDS`（见 `use-style-schema.ts` 门面）；
 * 新增一个可调参数只改本表，不改组件。
 */
import type { FeatureStyleId } from '@bibliotype/core';
import {
  ALIGN_OPTIONS,
  BORDER_STYLE_OPTIONS,
  RUBY_POSITION_OPTIONS,
  TEXT_DECORATION_STYLE_OPTIONS,
} from './style-options.js';
import {
  borderTriple,
  color,
  num,
  select,
  spacingFields,
  text,
  type StyleField,
} from './style-field-helpers.js';

/** 现代节点字段（未登记的功能用「自定义声明」兜底） */
export const CORE_STYLE_FIELDS: Partial<Record<FeatureStyleId, StyleField[]>> = {
  /* ---------- 正文段落（Word「段落」对话框的核心） ---------- */
  'block.paragraph': [
    select('text-align', '对齐', ALIGN_OPTIONS, '对齐与缩进'),
    text('text-indent', '首行缩进', '如 2em；0 表示不缩进', '对齐与缩进'),
    num('margin-left', '左缩进', 'em', 0, 6, 0.1, '对齐与缩进'),
    num('margin-right', '右缩进', 'em', 0, 6, 0.1, '对齐与缩进'),
    ...spacingFields(),
    text('letter-spacing', '字距', '如 0.02em', '字符'),
    text('font-size', '字号', '如 16px / 1em', '字符'),
    select('font-weight', '字重', [
      { value: '300', label: '细' },
      { value: '400', label: '常规' },
      { value: '500', label: '中等' },
      { value: '600', label: '半粗' },
      { value: '700', label: '粗' },
    ], '字符'),
    color('color', '颜色', '字符'),
  ],

  /* ---------- 标题（1~6 级各自一份字段） ---------- */
  ...Object.fromEntries(
    [1, 2, 3, 4, 5, 6].map((level) => [
      `block.heading.${level}`,
      [
        text('font-size', '字号', '如 1.75em', '字号与字体'),
        select('font-weight', '字重', [
          { value: '400', label: '常规' },
          { value: '500', label: '中等' },
          { value: '600', label: '半粗' },
          { value: '700', label: '粗' },
        ], '字号与字体'),
        color('color', '颜色', '字号与字体'),
        text('letter-spacing', '字距', '如 0.1em', '字号与字体'),
        select('text-align', '对齐', ALIGN_OPTIONS, '版面'),
        ...spacingFields('间距'),
        text('line-height', '行高', '如 1.4', '间距'),
      ],
    ]),
  ) as unknown as Partial<Record<FeatureStyleId, StyleField[]>>,

  /* ---------- 引用 / 列表 / 代码 / 表格 / 图 ---------- */
  'block.quote': [
    num('margin-top', '段前', 'em', 0, 6, 0.1, '间距'),
    num('margin-bottom', '段后', 'em', 0, 6, 0.1, '间距'),
    num('margin-left', '左缩进', 'em', 0, 6, 0.1, '间距'),
    num('margin-right', '右缩进', 'em', 0, 6, 0.1, '间距'),
    select('border-left-style', '左线型', BORDER_STYLE_OPTIONS, '左边线'),
    num('border-left-width', '左线宽', 'px', 0, 12, 1, '左边线'),
    color('border-left-color', '左线色', '左边线'),
    text('font-size', '字号', '如 0.95em', '字符'),
    color('color', '颜色', '字符'),
  ],
  'block.list': [
    num('padding-left', '缩进', 'em', 0, 6, 0.1, '缩进'),
    num('margin-top', '段前', 'em', 0, 6, 0.1, '间距'),
    num('margin-bottom', '段后', 'em', 0, 6, 0.1, '间距'),
  ],
  'block.list-item': [
    num('margin-top', '项间距', 'em', 0, 3, 0.05, '间距'),
    num('padding-left', '悬挂缩进', 'em', 0, 4, 0.1, '缩进'),
  ],
  'block.code-block': [
    text('font-size', '字号', '如 0.85em', '字符'),
    text('line-height', '行高', '如 1.6', '字符'),
    color('background-color', '底色', '外观'),
    num('border-radius', '圆角', 'px', 0, 24, 1, '外观'),
    num('padding', '内边距', 'em', 0, 4, 0.1, '外观'),
    ...borderTriple('边框'),
  ],
  'block.table': [
    num('margin-top', '段前', 'em', 0, 6, 0.1, '间距'),
    num('margin-bottom', '段后', 'em', 0, 6, 0.1, '间距'),
  ],
  'block.table-cell': [
    select('border-style', '线型', BORDER_STYLE_OPTIONS, '边框'),
    num('border-width', '线宽', 'px', 0, 8, 1, '边框'),
    color('border-color', '线色', '边框'),
    text('padding', '内边距', '如 0.25em 0.6em', '尺寸'),
  ],
  'block.image': [
    text('max-width', '最大宽度', '如 100% / 60%', '尺寸'),
    num('border-radius', '圆角', 'px', 0, 32, 1, '外观'),
    ...borderTriple('边框'),
    text('display', '对齐', 'block / inline-block', '版面'),
    text('margin-left', '左外边距', 'auto 表示居中', '版面'),
    text('margin-right', '右外边距', 'auto 表示居中', '版面'),
  ],
  'block.caption': [
    text('font-size', '字号', '如 0.85em', '字符'),
    color('color', '颜色', '字符'),
    select('text-align', '对齐', ALIGN_OPTIONS, '版面'),
  ],
  'block.break': [
    select('border-top-style', '线型', BORDER_STYLE_OPTIONS, '分隔线'),
    num('border-top-width', '线宽', 'px', 0, 12, 1, '分隔线'),
    color('border-top-color', '线色', '分隔线'),
    num('margin-top', '上间距', 'em', 0, 6, 0.1, '间距'),
    num('margin-bottom', '下间距', 'em', 0, 6, 0.1, '间距'),
  ],
  'block.math-block': [
    select('text-align', '对齐', ALIGN_OPTIONS, '版面'),
    text('font-size', '字号', '如 1em', '字符'),
  ],

  /* ---------- 注释块 ---------- */
  'block.footnote': [
    text('font-size', '字号', '如 0.75em', '字符'),
    color('color', '颜色', '字符'),
    select('border-top-style', '注线线型', BORDER_STYLE_OPTIONS, '注线'),
    num('border-top-width', '注线宽', 'px', 0, 8, 1, '注线'),
    color('border-top-color', '注线色', '注线'),
    num('margin-top', '段前', 'em', 0, 4, 0.1, '间距'),
  ],
  'block.endnote': [
    text('font-size', '字号', '如 0.75em', '字符'),
    color('color', '颜色', '字符'),
    num('margin-top', '段前', 'em', 0, 4, 0.1, '间距'),
  ],
  'block.margin-note': [
    text('font-size', '字号', '如 0.72em', '字符'),
    color('color', '颜色', '字符'),
    num('width', '宽度', 'em', 0, 20, 0.5, '版面'),
  ],

  /* ---------- 行内标记 ---------- */
  'mark.strong': [
    select('font-weight', '字重', [
      { value: '600', label: '半粗' },
      { value: '700', label: '粗' },
      { value: '900', label: '特粗' },
    ]),
    color('color', '颜色'),
  ],
  'mark.emphasis': [color('color', '颜色')],
  'mark.underline': [
    select('text-decoration-style', '线型', TEXT_DECORATION_STYLE_OPTIONS, '线型'),
    num('text-decoration-thickness', '线宽', 'px', 0, 8, 1, '线型'),
    color('text-decoration-color', '线色', '线型'),
    num('text-underline-offset', '偏移', 'px', 0, 12, 1, '线型'),
  ],
  'mark.strikethrough': [
    select('text-decoration-style', '线型', TEXT_DECORATION_STYLE_OPTIONS, '线型'),
    num('text-decoration-thickness', '线宽', 'px', 0, 8, 1, '线型'),
    color('text-decoration-color', '线色', '线型'),
  ],
  'mark.highlight': [
    color('background-color', '填充色'),
    text('padding', '内边距', '如 0.05em 0.15em'),
    num('border-radius', '圆角', 'px', 0, 12, 1),
    color('color', '文字色'),
  ],
  'mark.code': [
    text('font-size', '字号', '如 0.9em', '字符'),
    color('background-color', '底色', '外观'),
    color('color', '文字色', '外观'),
    num('border-radius', '圆角', 'px', 0, 12, 1, '外观'),
    text('padding', '内边距', '如 0.1em 0.3em', '外观'),
  ],
  'mark.link': [
    color('color', '颜色'),
    color('text-decoration-color', '下划线色'),
    select('text-decoration-line', '下划线', [
      { value: 'underline', label: '有' },
      { value: 'none', label: '无' },
    ]),
  ],
  'mark.ruby': [
    text('font-size', '注文字号', '如 0.5em', '字符'),
    color('color', '注文颜色', '字符'),
    select('ruby-position', '注文位置', RUBY_POSITION_OPTIONS, '位置'),
    text('font-family', '注文字体', '留空跟随正文', '字符'),
  ],

  /* ---------- 页面装饰 ---------- */
  'role.page-number': [
    text('font-size', '字号', '如 0.75em', '字符'),
    color('color', '颜色', '字符'),
    text('bottom', '距页底', '如 16px', '位置'),
    select('text-align', '对齐', ALIGN_OPTIONS, '位置'),
  ],
  'role.page-header': [
    text('font-size', '字号', '如 0.72em', '字符'),
    color('color', '颜色', '字符'),
    select('text-align', '对齐', ALIGN_OPTIONS, '位置'),
    select('border-bottom-style', '下分隔线', BORDER_STYLE_OPTIONS, '分隔线'),
    color('border-bottom-color', '分隔线色', '分隔线'),
  ],
  'role.page-footer': [
    text('font-size', '字号', '如 0.72em', '字符'),
    color('color', '颜色', '字符'),
    select('text-align', '对齐', ALIGN_OPTIONS, '位置'),
    select('border-top-style', '上分隔线', BORDER_STYLE_OPTIONS, '分隔线'),
    color('border-top-color', '分隔线色', '分隔线'),
  ],

  /* ---------- 结构页角色（标题类共用一套） ---------- */
  ...Object.fromEntries(
    [
      'role.cover-title',
      'role.cover-subtitle',
      'role.cover-creator',
      'role.cover-publisher',
      'role.title-page-title',
      'role.title-page-subtitle',
      'role.title-page-creator',
      'role.title-page-publisher',
      'role.copyright-title',
      'role.copyright-line',
      'role.toc-title',
      'role.toc-entry',
      'role.toc-subentry',
      'role.volume-title',
      'role.volume-creator',
      'role.back-cover-line',
    ].map((id) => [
      id,
      [
        text('font-size', '字号', '如 1.4em', '字符'),
        select('text-align', '对齐', ALIGN_OPTIONS, '版面'),
        color('color', '颜色', '字符'),
        text('letter-spacing', '字距', '如 0.2em', '字符'),
        num('margin-top', '段前', 'em', 0, 8, 0.1, '间距'),
        num('margin-bottom', '段后', 'em', 0, 8, 0.1, '间距'),
      ] as StyleField[],
    ]),
  ) as unknown as Partial<Record<FeatureStyleId, StyleField[]>>,
};
