/**
 * 样式字段控件的下拉 / 分段选项常量
 *
 * 集中定义供 `style-field-helpers.ts` 的 `select`/`borderTriple` 工厂与各字段表复用，
 * 避免选项字面量散落到字段定义中。
 */

/** 文本对齐 */
export const ALIGN_OPTIONS = [
  { value: 'left', label: '左' },
  { value: 'center', label: '居中' },
  { value: 'right', label: '右' },
  { value: 'justify', label: '两端' },
] as const;

/** 边框线型 */
export const BORDER_STYLE_OPTIONS = [
  { value: 'solid', label: '实线' },
  { value: 'dashed', label: '虚线' },
  { value: 'dotted', label: '点线' },
  { value: 'double', label: '双线' },
] as const;

/** 文本装饰线型（下划线 / 删除线 / 着重线等） */
export const TEXT_DECORATION_STYLE_OPTIONS = [
  { value: 'solid', label: '单线' },
  { value: 'double', label: '双线' },
  { value: 'dotted', label: '点线' },
  { value: 'dashed', label: '虚线' },
  { value: 'wavy', label: '波浪' },
] as const;

/** 圈点（text-emphasis）样式 */
export const EMPHASIS_STYLE_OPTIONS = [
  { value: 'filled circle', label: '实心圈' },
  { value: 'open circle', label: '空心圈' },
  { value: 'filled dot', label: '实心点' },
  { value: 'open dot', label: '空心点' },
  { value: 'double-circle', label: '双圈' },
  { value: 'filled triangle', label: '三角' },
  { value: 'sesame', label: '芝麻点' },
] as const;

/** 圈点位置 */
export const EMPHASIS_POSITION_OPTIONS = [
  { value: 'under right', label: '字下右' },
  { value: 'under left', label: '字下左' },
  { value: 'over right', label: '字上右' },
  { value: 'over left', label: '字上左' },
] as const;

/** 注文（ruby）位置 */
export const RUBY_POSITION_OPTIONS = [
  { value: 'over', label: '注文在上' },
  { value: 'under', label: '注文在下' },
  { value: 'inter-character', label: '注文在右（直排用）' },
] as const;
