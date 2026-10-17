/**
 * 功能样式字段元数据（设置面板的表单来源）
 *
 * 目标：新增一个可调参数只改本文件，不改组件 —— `FeatureStyleEditor` 按本表渲染控件。
 *
 * 约定：
 * - `property` 为**最终写入 CSS 的属性名**（kebab-case），值原样进样式表；
 * - 数值控件由 `unit` 拼接单位（`1.6` + `em` → `1.6em`），值为空表示「不覆盖」；
 * - 「不覆盖」与「取空值」是两件事：清空输入 = 删除该声明（回落到默认样式），
 *   而不是写空串（空串会让整条声明失效甚至被老引擎丢弃）。
 * - 未在本表登记细节的功能，仍可在面板的「自定义声明」里直接写 CSS，
 *   因此不存在「某功能完全无法配置」的情况。
 */
import type { FeatureStyleId } from '@bibliotype/core';

/** 控件类型 */
export type StyleControl =
  | 'select'
  | 'chips'
  | 'number'
  | 'text'
  | 'color'
  | 'slider';

/** 一个可调参数 */
export interface StyleField {
  /** CSS 属性名 */
  property: string;
  /** 中文标签 */
  label: string;
  /** 控件类型 */
  control: StyleControl;
  /** 下拉 / 分段选项 */
  options?: ReadonlyArray<{ value: string; label: string }>;
  /** 数值范围 */
  min?: number;
  max?: number;
  step?: number;
  /** 数值单位（'px' / 'em' / '%'） */
  unit?: string;
  /** 输入提示（展示默认值） */
  placeholder?: string;
  /** 悬浮说明 */
  hint?: string;
  /** 组内小节标题 */
  section?: string;
}

/* -------------------------------------------------------------------------- */
/* 选项常量                                                                    */
/* -------------------------------------------------------------------------- */

const ALIGN_OPTIONS = [
  { value: 'left', label: '左' },
  { value: 'center', label: '居中' },
  { value: 'right', label: '右' },
  { value: 'justify', label: '两端' },
] as const;

const BORDER_STYLE_OPTIONS = [
  { value: 'solid', label: '实线' },
  { value: 'dashed', label: '虚线' },
  { value: 'dotted', label: '点线' },
  { value: 'double', label: '双线' },
] as const;

const TEXT_DECORATION_STYLE_OPTIONS = [
  { value: 'solid', label: '单线' },
  { value: 'double', label: '双线' },
  { value: 'dotted', label: '点线' },
  { value: 'dashed', label: '虚线' },
  { value: 'wavy', label: '波浪' },
] as const;

const EMPHASIS_STYLE_OPTIONS = [
  { value: 'filled circle', label: '实心圈' },
  { value: 'open circle', label: '空心圈' },
  { value: 'filled dot', label: '实心点' },
  { value: 'open dot', label: '空心点' },
  { value: 'double-circle', label: '双圈' },
  { value: 'filled triangle', label: '三角' },
  { value: 'sesame', label: '芝麻点' },
] as const;

const EMPHASIS_POSITION_OPTIONS = [
  { value: 'under right', label: '字下右' },
  { value: 'under left', label: '字下左' },
  { value: 'over right', label: '字上右' },
  { value: 'over left', label: '字上左' },
] as const;

const RUBY_POSITION_OPTIONS = [
  { value: 'over', label: '注文在上' },
  { value: 'under', label: '注文在下' },
  { value: 'inter-character', label: '注文在右（直排用）' },
] as const;

/* -------------------------------------------------------------------------- */
/* 字段工厂                                                                    */
/* -------------------------------------------------------------------------- */

/** 颜色字段 */
function color(property: string, label: string, section?: string): StyleField {
  return { property, label, control: 'color', section };
}

/** 数值字段 */
function num(
  property: string,
  label: string,
  unit: string,
  min: number,
  max: number,
  step = 1,
  section?: string,
): StyleField {
  return { property, label, control: 'number', unit, min, max, step, section };
}

/** 文本字段（自由值，如 `1.6`、`0.02em`、`2em`） */
function text(property: string, label: string, placeholder?: string, section?: string): StyleField {
  return { property, label, control: 'text', placeholder, section };
}

/** 下拉字段 */
function select(
  property: string,
  label: string,
  options: ReadonlyArray<{ value: string; label: string }>,
  section?: string,
): StyleField {
  return { property, label, control: 'select', options, section };
}

/** 边框三元组（线型 / 线宽 / 颜色），写进 `border` 简写 */
function borderTriple(section?: string): StyleField[] {
  return [
    {
      property: 'border-style',
      label: '线型',
      control: 'select',
      options: BORDER_STYLE_OPTIONS,
      section,
    },
    num('border-width', '线宽', 'px', 0, 12, 1, section),
    color('border-color', '线色', section),
  ];
}

/** 段前 / 段后 / 行高 */
function spacingFields(section = '间距'): StyleField[] {
  return [
    num('margin-top', '段前', 'em', 0, 6, 0.1, section),
    num('margin-bottom', '段后', 'em', 0, 6, 0.1, section),
    text('line-height', '行高', '如 1.9 或 32px', section),
  ];
}

/* -------------------------------------------------------------------------- */
/* 字段表                                                                      */
/* -------------------------------------------------------------------------- */

/** 全部已登记的功能字段（未登记的功能用「自定义声明」兜底） */
export const STYLE_FIELDS: Partial<Record<FeatureStyleId, StyleField[]>> = {
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
    { property: 'border-left-style', label: '左线型', control: 'select', options: BORDER_STYLE_OPTIONS, section: '左边线' },
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
    { property: 'border-style', label: '线型', control: 'select', options: BORDER_STYLE_OPTIONS, section: '边框' },
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
    { property: 'border-top-style', label: '线型', control: 'select', options: BORDER_STYLE_OPTIONS, section: '分隔线' },
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
    { property: 'border-top-style', label: '注线线型', control: 'select', options: BORDER_STYLE_OPTIONS, section: '注线' },
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
    { property: 'text-decoration-style', label: '线型', control: 'select', options: TEXT_DECORATION_STYLE_OPTIONS, section: '线型' },
    num('text-decoration-thickness', '线宽', 'px', 0, 8, 1, '线型'),
    color('text-decoration-color', '线色', '线型'),
    num('text-underline-offset', '偏移', 'px', 0, 12, 1, '线型'),
  ],
  'mark.strikethrough': [
    { property: 'text-decoration-style', label: '线型', control: 'select', options: TEXT_DECORATION_STYLE_OPTIONS, section: '线型' },
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
    { property: 'text-decoration-line', label: '下划线', control: 'select', options: [
      { value: 'underline', label: '有' },
      { value: 'none', label: '无' },
    ] },
  ],
  'mark.ruby': [
    text('font-size', '注文字号', '如 0.5em', '字符'),
    color('color', '注文颜色', '字符'),
    select('ruby-position', '注文位置', RUBY_POSITION_OPTIONS, '位置'),
    text('font-family', '注文字体', '留空跟随正文', '字符'),
  ],

  /* ---------- 古籍标记 ---------- */
  'mark.proper-name': [
    { property: 'border-bottom-style', label: '线型', control: 'select', options: BORDER_STYLE_OPTIONS, section: '线型' },
    num('border-bottom-width', '线宽', 'px', 0, 8, 1, '线型'),
    color('border-bottom-color', '线色', '线型'),
    num('border-bottom', '与字距', 'px', 0, 8, 1, '线型'),
    { property: 'text-decoration-line', label: '改用下划线', control: 'select', options: [
      { value: 'none', label: '否（用边框）' },
      { value: 'underline', label: '是' },
    ], section: '线型' },
  ],
  'mark.book-title': [
    { property: 'text-decoration-style', label: '线型', control: 'select', options: TEXT_DECORATION_STYLE_OPTIONS, section: '线型' },
    num('text-decoration-thickness', '线宽', 'px', 0, 8, 1, '线型'),
    color('text-decoration-color', '线色', '线型'),
    num('text-underline-offset', '偏移', 'px', 0, 12, 1, '线型'),
  ],
  'mark.circle-emphasis': [
    select('text-emphasis', '圈点样式', EMPHASIS_STYLE_OPTIONS, '样式'),
    select('text-emphasis-position', '位置', EMPHASIS_POSITION_OPTIONS, '样式'),
    color('text-emphasis-color', '颜色', '样式'),
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
    { property: 'text-decoration-style', label: '线型', control: 'select', options: TEXT_DECORATION_STYLE_OPTIONS, section: '标记线' },
    color('text-decoration-color', '线色', '标记线'),
  ],
  'mark.taboo': [
    { property: 'text-decoration-style', label: '线型', control: 'select', options: TEXT_DECORATION_STYLE_OPTIONS, section: '标记线' },
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
    { property: 'border-top-style', label: '上分隔线', control: 'select', options: BORDER_STYLE_OPTIONS, section: '边框' },
    color('border-top-color', '分隔线色', '边框'),
  ],
  'block.collation-note': [
    text('font-size', '字号', '如 0.7em', '字符'),
    color('color', '颜色', '字符'),
    { property: 'border-left-style', label: '左线型', control: 'select', options: BORDER_STYLE_OPTIONS, section: '左边线' },
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
    { property: 'border-top-style', label: '上分隔线', control: 'select', options: BORDER_STYLE_OPTIONS, section: '边框' },
    color('border-top-color', '分隔线色', '边框'),
  ],
  'block.variant-char': [
    { property: 'text-decoration-style', label: '线型', control: 'select', options: TEXT_DECORATION_STYLE_OPTIONS, section: '标记线' },
    color('text-decoration-color', '线色', '标记线'),
  ],
  'block.taboo-char': [
    { property: 'text-decoration-style', label: '线型', control: 'select', options: TEXT_DECORATION_STYLE_OPTIONS, section: '标记线' },
    color('text-decoration-color', '线色', '标记线'),
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
    { property: 'border-bottom-style', label: '下分隔线', control: 'select', options: BORDER_STYLE_OPTIONS, section: '分隔线' },
    color('border-bottom-color', '分隔线色', '分隔线'),
  ],
  'role.page-footer': [
    text('font-size', '字号', '如 0.72em', '字符'),
    color('color', '颜色', '字符'),
    select('text-align', '对齐', ALIGN_OPTIONS, '位置'),
    { property: 'border-top-style', label: '上分隔线', control: 'select', options: BORDER_STYLE_OPTIONS, section: '分隔线' },
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

/** 取某功能的字段表（无登记返回空数组 → 面板只剩「自定义声明」） */
export function getStyleFields(id: FeatureStyleId): StyleField[] {
  return STYLE_FIELDS[id] ?? [];
}

/** 分组内的小节顺序（保持字段声明顺序，这里只做去重收集） */
export function listSections(fields: readonly StyleField[]): string[] {
  const sections: string[] = [];
  for (const field of fields) {
    const section = field.section ?? '基本';
    if (!sections.includes(section)) sections.push(section);
  }
  return sections;
}
