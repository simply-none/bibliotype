/**
 * 书目元数据 Schema
 *
 * 覆盖调研清单 § 六 要求：书名、作者、朝代、版本、卷数、四部分类号等。
 * 元数据同样需可协同编辑（D6），故所有字段均为纯数据、无运行时对象。
 */
import type { Timestamp } from './types.js';

/** 责任者（作者/编者/校注者等） */
export interface Contributor {
  /** 姓名 */
  name: string;
  /**
   * 朝代或国别，如 "宋"、"清"、"日"
   *
   * 与 D3 补充一致：允许中英文数字混排（如 "19世纪"、"US"）。
   */
  dynasty?: string;
  /** 角色，如 "撰"、"注"、"校"、"编" */
  role?: string;
}

/** 版本信息（底本 / 校本） */
export interface EditionInfo {
  /** 版本名称，如 "庚辰本"、"中华书局点校本" */
  name?: string;
  /** 刊刻年代，如 "清乾隆五十六年" */
  era?: string;
  /** 出版者 / 藏书机构 */
  publisher?: string;
  /** 版本性质：底本或校本 */
  kind?: 'base' | 'variant';
}

/** 通用标识符（ISBN / CNMARC / DOI 等） */
export interface Identifier {
  /** 标识符类型 */
  scheme: 'isbn' | 'issn' | 'doi' | 'cnmarc' | 'other';
  /** 标识符值（允许数字与连字符） */
  value: string;
}

/** 出版信息 */
export interface PublicationInfo {
  /** 出版社 */
  publisher?: string;
  /** 出版年（可为古代纪年或公历） */
  year?: string;
  /** 出版地 */
  place?: string;
}

/** 书目元数据 */
export interface BookMetadata {
  /** 书名（必填） */
  title: string;
  /** 副题 / 并列题名 */
  subtitle?: string;
  /** 责任者列表 */
  contributors?: Contributor[];
  /** 版本信息 */
  edition?: EditionInfo;
  /** 卷数 */
  volumeCount?: number;
  /** 分类号（如四部分类：经/史/子/集 + 细目） */
  classification?: string;
  /** 语言标记（BCP 47，如 "zh-Hant"、"zh-Hans"） */
  language?: string;
  /** 标识符列表 */
  identifiers?: Identifier[];
  /** 出版信息 */
  publication?: PublicationInfo;
  /** 创建时间 */
  createdAt?: Timestamp;
  /** 最近修改时间 */
  updatedAt?: Timestamp;
  /** 扩展元数据（插件可写入自定义字段） */
  extra?: Record<string, unknown>;
}
