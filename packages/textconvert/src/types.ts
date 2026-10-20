/**
 * 文本转换类型
 *
 * 转换表是**数据**，转换器是**算法**：内置表只覆盖最常见繁简 / 异体字对，
 * 生产级全量表（含词组歧义消解）通过 `createOpenCcConverter` 交给 OpenCC 等外部实现，
 * 本包不绑定任何具体转换库。
 */

/** 单条转换规则 */
export interface ConversionEntry {
  /** 源字 / 源词 */
  from: string;
  /** 目标字 / 目标词 */
  to: string;
  /** 说明（为何需要该规则、适用场景） */
  note?: string;
}

/** 转换表 */
export interface TextConversionTable {
  /** 表标识（如 `zh-Hant-to-zh-Hans`） */
  id: string;
  /** 表名称 */
  name: string;
  /** 单字规则（按字逐一替换） */
  entries: ConversionEntry[];
  /** 词组规则（优先于单字，按长度降序匹配） */
  phrases?: ConversionEntry[];
}

/** 单次替换命中 */
export interface ConversionHit {
  /** 在源文本中的起始偏移 */
  offset: number;
  /** 命中的源文本 */
  from: string;
  /** 替换后的文本 */
  to: string;
}

/** 转换结果 */
export interface ConversionResult {
  /** 转换后文本 */
  text: string;
  /** 命中记录（供预览高亮 / 差异对比） */
  hits: ConversionHit[];
}

/** 转换器接口（表驱动实现与外部实现统一契约） */
export interface TextConverter {
  /** 转换器标识 */
  readonly id: string;
  /** 转换器名称 */
  readonly name: string;
  /** 只取结果文本 */
  convert(text: string): string;
  /** 取结果与命中记录 */
  convertWithHits(text: string): ConversionResult;
}
