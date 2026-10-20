/**
 * @bibliotype/textconvert 统一导出入口
 *
 * 繁简 / 异体字转换：
 * - 离线兜底：`createTableConverter(TRADITIONAL_TO_SIMPLIFIED)`；
 * - 生产级：`createOpenCcConverter(openccConvert)` 接入 OpenCC；
 * - 反向（简 → 繁）：`reverseTable`，自动跳过一对多歧义字。
 *
 * 纯函数、无依赖，浏览器与 Node 同构。
 */

/* ---------- 类型 ---------- */
export type {
  ConversionEntry,
  TextConversionTable,
  ConversionHit,
  ConversionResult,
  TextConverter,
} from './types.js';

/* ---------- 内置表 ---------- */
export {
  TRADITIONAL_TO_SIMPLIFIED,
  TRADITIONAL_TO_SIMPLIFIED_ENTRIES,
  TRADITIONAL_TABLE_ID,
} from './traditional-table.js';

/* ---------- 转换器 ---------- */
export {
  AMBIGUOUS_SIMPLIFIED,
  createTableConverter,
  convertText,
  createOpenCcConverter,
  findAmbiguousTargets,
  reverseTable,
  summarizeHits,
} from './convert.js';
export type { ExternalConverterOptions, ReverseTableOptions } from './convert.js';
