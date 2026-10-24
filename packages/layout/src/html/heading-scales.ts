/**
 * 标题分级字号倍率（共享常量）
 *
 * `book-css` 的标题分级规则与「仿真行款网格对齐层」的落格行高计算共用
 * 同一张表，抽出为独立模块避免互相引用成环；倍率以 H1（= `font-size-heading`
 * 令牌）为基准。
 */
export const HEADING_LEVEL_SCALES: Readonly<Record<number, number>> = {
  1: 1,
  2: 0.82,
  3: 0.72,
  4: 0.64,
  5: 0.58,
  6: 0.54,
};
