/**
 * 书目元数据映射（K7）
 *
 * 两个出口，都是纯函数、零依赖、无时间与随机值：
 * - **DC JSON**：都柏林核心，键序固定，便于宿主直接写库 / 走 OAI；
 * - **CNMARC 文本行**：字段式纯文本（`200 1#$a论语$f孔子` 形态），便于人工核对
 *   与导入图书馆系统，不实现 ISO 2709 二进制打包。
 *
 * 字段映射只做「有值才输出」，不会为缺字段编造内容；缺字段请在
 * `validateMetadata` 的结果里提示用户补齐。
 */
import {
  CLASSICAL_DIVISIONS,
  EDITION_TYPES,
  type BookMetadata,
} from './ir/metadata.js';

/** 都柏林核心记录（键序固定） */
export interface DublinCoreRecord {
  title: string;
  creator: readonly string[];
  contributor: readonly string[];
  type: string;
  publisher?: string;
  date?: string;
  language?: string;
  identifier: readonly string[];
  subject: readonly string[];
  source?: string;
  relation: readonly string[];
  description?: string;
}

/** 责任者角色中算「著者」的写法 */
const CREATOR_ROLES: ReadonlySet<string> = new Set(['', '撰', '著', '编', '编著', '译']);

/** 语言标记 → CNMARC 101 代码（只覆盖常见情形，其余原样保留 BCP 47） */
function marcLanguage(language: string | undefined): string | undefined {
  if (language === undefined) return undefined;
  if (language.toLowerCase().startsWith('zh')) return 'chi';
  if (language.toLowerCase().startsWith('en')) return 'eng';
  if (language.toLowerCase().startsWith('ja')) return 'jpn';
  return undefined;
}

/** 四部中文标签 */
function divisionLabel(metadata: BookMetadata): string | undefined {
  const division = metadata.classicalCategory?.division;
  if (division === undefined) return undefined;
  return CLASSICAL_DIVISIONS.find((item) => item.value === division)?.label;
}

/** 版本类型中文标签 */
function editionTypeLabel(metadata: BookMetadata): string | undefined {
  const type = metadata.editionType;
  if (type === undefined) return undefined;
  return EDITION_TYPES.find((item) => item.value === type)?.label;
}

/** 责任者摘要（`孔子 撰；朱熹 注`） */
function contributorSummary(metadata: BookMetadata): string | undefined {
  const parts = (metadata.contributors ?? [])
    .filter((person) => person.name.trim() !== '')
    .map((person) => (person.role === undefined || person.role === '' ? person.name : `${person.name} ${person.role}`));
  return parts.length === 0 ? undefined : parts.join('；');
}

/** 源文献（底本 / 参校本） */
function sourceSummary(metadata: BookMetadata): string | undefined {
  const edition = metadata.edition;
  if (edition === undefined) return undefined;
  const parts = [edition.name, edition.era, edition.publisher].filter(
    (value): value is string => value !== undefined && value.trim() !== '',
  );
  return parts.length === 0 ? undefined : parts.join('，');
}

/**
 * 转都柏林核心记录
 *
 * @param metadata 书目元数据
 * @returns 键序固定的 DC 记录（空字段省略）
 */
export function toDublinCore(metadata: BookMetadata): DublinCoreRecord {
  const creator: string[] = [];
  const contributor: string[] = [];
  for (const person of metadata.contributors ?? []) {
    if (person.name.trim() === '') continue;
    if (CREATOR_ROLES.has(person.role ?? '')) creator.push(person.name);
    else contributor.push(person.name);
  }

  const subject: string[] = [];
  const label = divisionLabel(metadata);
  if (label !== undefined) subject.push(label);
  const subdivision = metadata.classicalCategory?.subdivision;
  if (subdivision !== undefined && subdivision.trim() !== '') subject.push(subdivision);
  if (metadata.classification !== undefined && metadata.classification.trim() !== '') {
    subject.push(metadata.classification);
  }

  const relation: string[] = [];
  if (metadata.edition?.kind === 'base') relation.push('底本');
  if (metadata.edition?.kind === 'variant') relation.push('参校本');

  const record: DublinCoreRecord = {
    title: metadata.title,
    creator,
    contributor,
    type: 'Text',
    ...(metadata.publication?.publisher === undefined
      ? {}
      : { publisher: metadata.publication.publisher }),
    ...(metadata.publication?.year === undefined ? {} : { date: metadata.publication.year }),
    ...(metadata.language === undefined ? {} : { language: metadata.language }),
    identifier: (metadata.identifiers ?? []).map(
      (identifier) => `${identifier.scheme}:${identifier.value}`,
    ),
    subject,
    ...(sourceSummary(metadata) === undefined ? {} : { source: sourceSummary(metadata) }),
    relation,
    ...(metadata.volumeCount === undefined
      ? {}
      : { description: `${metadata.volumeCount} 卷` }),
  };

  return record;
}

/**
 * 序列化 DC 记录为 JSON（固定键序，同一元数据逐字节一致）
 *
 * @param record {@link toDublinCore} 的产物
 */
export function serializeDublinCore(record: DublinCoreRecord): string {
  return JSON.stringify(record, null, 2);
}

/** 子字段值清洗：`$` 是子字段分隔符，换行会破坏「一字段一行」 */
function sanitize(value: string): string {
  return value.replace(/\$/g, '＄').replace(/[\r\n]+/g, ' ').trim();
}

/** FNV-1a 32 位十六进制（确定性记录号，避免引入时间 / 随机） */
function fnv1aHex(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** 记录标识：优先编目号 / ISBN / DOI，否则按书名生成稳定哈希 */
function recordId(metadata: BookMetadata): string {
  const preferred = (metadata.identifiers ?? []).find((identifier) =>
    ['cnmarc', 'isbn', 'doi'].includes(identifier.scheme),
  );
  if (preferred !== undefined && preferred.value.trim() !== '') return sanitize(preferred.value);
  return `bt-${fnv1aHex(`${metadata.title}|${contributorSummary(metadata) ?? ''}`)}`;
}

/** 构造一个字段行；全部子字段为空时返回空串 */
function fieldLine(
  tag: string,
  indicators: string,
  subfields: ReadonlyArray<readonly [string, string | undefined]>,
): string {
  const body = subfields
    .filter((entry): entry is readonly [string, string] => entry[1] !== undefined && entry[1].trim() !== '')
    .map(([code, value]) => `$${code}${sanitize(value)}`)
    .join('');
  return body === '' ? '' : `${tag} ${indicators}${body}`;
}

/**
 * 转 CNMARC 字段行文本
 *
 * 每行一个字段（`001` 无指示符）；空字段整行省略。输出不含末尾空行，
 * 可直接贴进支持「MARC 文本」的编目工具人工核对。
 *
 * @param metadata 书目元数据
 */
export function toCnmarc(metadata: BookMetadata): string {
  const division = divisionLabel(metadata);
  const editionType = editionTypeLabel(metadata);
  const summary = contributorSummary(metadata);
  const edition = metadata.edition;
  const publication = metadata.publication;
  const subdivision = metadata.classicalCategory?.subdivision;

  const lines = [
    `001  ${recordId(metadata)}`,
    ...(metadata.identifiers ?? [])
      .filter((identifier) => identifier.scheme === 'isbn')
      .map((identifier) => fieldLine('010', '##', [['a', identifier.value]])),
    fieldLine('100', '##', [['a', publication?.year]]),
    fieldLine('101', '0#', [['a', marcLanguage(metadata.language)]]),
    fieldLine('200', '1#', [
      ['a', metadata.title],
      ['e', metadata.subtitle],
      ['f', summary],
    ]),
    fieldLine('205', '##', [
      ['a', [editionType, edition?.name].filter((value) => value !== undefined).join(' ')],
      ['f', edition?.era],
    ]),
    fieldLine('210', '##', [
      ['a', publication?.place],
      ['c', publication?.publisher],
      ['d', publication?.year],
    ]),
    fieldLine('215', '##', [
      ['a', metadata.volumeCount === undefined ? undefined : `${metadata.volumeCount} 卷`],
    ]),
    fieldLine('300', '##', [
      [
        'a',
        [
          metadata.repository === undefined ? undefined : `藏地：${metadata.repository}`,
          metadata.callNumber === undefined ? undefined : `索书号：${metadata.callNumber}`,
        ]
          .filter((value) => value !== undefined)
          .join('；'),
      ],
    ]),
    fieldLine('606', '0#', [['a', division]]),
    fieldLine('686', '##', [['a', metadata.classification]]),
    fieldLine('690', '##', [['a', division], ['h', subdivision]]),
    fieldLine('801', '#0', [['a', 'CN']]),
    fieldLine('905', '##', [
      ['a', metadata.repository],
      ['b', metadata.callNumber],
    ]),
  ].filter((line) => line !== '');

  return lines.join('\n');
}
