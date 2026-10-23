/**
 * 样式字段类型与控件工厂
 *
 * `StyleField` / `StyleControl` 是设置面板表单的元数据结构（公开类型由
 * `use-style-schema.ts` 门面 re-export）；工厂函数把常见控件（颜色 / 数值 /
 * 文本 / 下拉 / 边框三元组 / 间距三件套）收敛成一行调用，供各字段表复用。
 */
import { BORDER_STYLE_OPTIONS } from './style-options.js';

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

/** 颜色字段 */
export function color(property: string, label: string, section?: string): StyleField {
  return { property, label, control: 'color', section };
}

/** 数值字段 */
export function num(
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
export function text(property: string, label: string, placeholder?: string, section?: string): StyleField {
  return { property, label, control: 'text', placeholder, section };
}

/** 下拉字段 */
export function select(
  property: string,
  label: string,
  options: ReadonlyArray<{ value: string; label: string }>,
  section?: string,
): StyleField {
  return { property, label, control: 'select', options, section };
}

/** 边框三元组（线型 / 线宽 / 颜色），写进 `border` 简写 */
export function borderTriple(section?: string): StyleField[] {
  return [
    select('border-style', '线型', BORDER_STYLE_OPTIONS, section),
    num('border-width', '线宽', 'px', 0, 12, 1, section),
    color('border-color', '线色', section),
  ];
}

/** 段前 / 段后 / 行高 */
export function spacingFields(section = '间距'): StyleField[] {
  return [
    num('margin-top', '段前', 'em', 0, 6, 0.1, section),
    num('margin-bottom', '段后', 'em', 0, 6, 0.1, section),
    text('line-height', '行高', '如 1.9 或 32px', section),
  ];
}
