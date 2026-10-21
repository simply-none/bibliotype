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

/** 四部（经 / 史 / 子 / 集） */
export type ClassicalDivision = 'jing' | 'shi' | 'zi' | 'ji';

/** 四部细目（K7） */
export interface ClassicalCategory {
  /** 部类 */
  division: ClassicalDivision;
  /** 二级类，如「易类」「正史类」「儒家类」（自由文本） */
  subdivision?: string;
}

/** 版本类型（K7）：刻本 / 抄本 / 活字 / 稿本 */
export type EditionType = 'block-print' | 'manuscript' | 'movable-type' | 'draft';

/** 四部枚举（含中文标签，UI 与服务端校验共用） */
export const CLASSICAL_DIVISIONS: ReadonlyArray<{
  value: ClassicalDivision;
  label: string;
  /** 常见二级类（仅作下拉建议，不限制自定义值） */
  subdivisions: readonly string[];
}> = [
  { value: 'jing', label: '经部', subdivisions: ['易类', '书类', '诗类', '礼类', '春秋类', '孝经类', '四书类', '小学类'] },
  { value: 'shi', label: '史部', subdivisions: ['正史类', '编年类', '纪事本末类', '别史类', '杂史类', '传记类', '地理类', '目录类'] },
  { value: 'zi', label: '子部', subdivisions: ['儒家类', '道家类', '兵家类', '法家类', '医家类', '天文算法类', '术数类', '类书类'] },
  { value: 'ji', label: '集部', subdivisions: ['楚辞类', '别集类', '总集类', '诗文评类', '词曲类'] },
];

/** 版本类型枚举（含中文标签） */
export const EDITION_TYPES: ReadonlyArray<{ value: EditionType; label: string }> = [
  { value: 'block-print', label: '刻本' },
  { value: 'manuscript', label: '抄本' },
  { value: 'movable-type', label: '活字本' },
  { value: 'draft', label: '稿本' },
];

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
  /**
   * 四部细目（K7）
   *
   * 与自由文本 `classification` 并存：前者用于编目映射（MARC / DC），
   * 后者保留原书分类号或馆藏分类（不做枚举限制）。
   */
  classicalCategory?: ClassicalCategory;
  /** 版本类型（K7，刻本 / 抄本 / 活字 / 稿本） */
  editionType?: EditionType;
  /** 藏地 / 收藏机构（K7），如「中国国家图书馆」 */
  repository?: string;
  /** 索书号（K7），如「善本 12345」 */
  callNumber?: string;
  /** 创建时间 */
  createdAt?: Timestamp;
  /** 最近修改时间 */
  updatedAt?: Timestamp;
  /** 扩展元数据（插件可写入自定义字段） */
  extra?: Record<string, unknown>;
}
