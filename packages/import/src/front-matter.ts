/**
 * Markdown front-matter 解析（YAML 子集，无第三方依赖）
 *
 * 只在导入层生效：`markdownToNodes` 不感知 metadata，粘贴 Markdown 时不会被
 * 误当正文。支持标量、行内数组与简单块级列表，覆盖书目常用字段：
 *
 * ```markdown
 * ---
 * title: 论语注
 * author: 朱熹, 何晏
 * language: zh-Hant
 * date: 2020
 * ---
 * ```
 *
 * 未知标量字段落到 `metadata.extra`，避免静默丢弃。
 */
import type { BookMetadata, Contributor } from '@bibliotype/core';

/** front-matter 解析结果 */
export interface FrontMatterParseResult {
  /** 解析出的书目字段（未出现的键不写入） */
  metadata: Partial<BookMetadata>;
  /** 剥离 front-matter 后的正文 */
  body: string;
}

/** front-matter 分隔符 */
const DELIMITER = '---';

/** 去引号（单 / 双引号，成对才去） */
function unquote(value: string): string {
  const text = value.trim();
  if (text.length >= 2) {
    const first = text[0];
    const last = text[text.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return text.slice(1, -1);
    }
  }
  return text;
}

/** 切分作者字符串（中英文逗号 / 顿号 / 分号） */
function splitAuthors(value: string): string[] {
  return value
    .split(/[,，、;；]/)
    .map((name) => name.trim())
    .filter((name) => name !== '');
}

/** YAML 子集 → 键值表（值为字符串或字符串数组） */
function parseYamlSubset(lines: readonly string[]): Map<string, string | string[]> {
  const map = new Map<string, string | string[]>();
  let listKey: string | null = null;

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (line.trim() === '' || line.trim().startsWith('#')) continue;

    /* 块级列表项：`- 朱熹`（仅承接上一个空值键） */
    const listItem = /^\s*-\s+(.*)$/.exec(line);
    if (listItem !== null && listKey !== null) {
      const current = map.get(listKey);
      if (Array.isArray(current)) current.push(unquote(listItem[1] ?? ''));
      continue;
    }

    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (kv === null) {
      listKey = null;
      continue;
    }

    const key = (kv[1] ?? '').toLowerCase();
    const value = (kv[2] ?? '').trim();
    if (value === '') {
      map.set(key, []);
      listKey = key;
      continue;
    }

    listKey = null;
    if (value.startsWith('[') && value.endsWith(']')) {
      map.set(
        key,
        value
          .slice(1, -1)
          .split(',')
          .map((item) => unquote(item))
          .filter((item) => item !== ''),
      );
      continue;
    }
    map.set(key, unquote(value));
  }

  return map;
}

/** 取标量字符串 */
function scalarOf(map: Map<string, string | string[]>, key: string): string | undefined {
  const value = map.get(key);
  if (typeof value === 'string') return value.trim() === '' ? undefined : value.trim();
  if (Array.isArray(value)) {
    const joined = value.join(', ').trim();
    return joined === '' ? undefined : joined;
  }
  return undefined;
}

/** 取字符串数组（支持标量切分与块级列表） */
function listOf(map: Map<string, string | string[]>, keys: readonly string[]): string[] {
  for (const key of keys) {
    const value = map.get(key);
    if (Array.isArray(value)) {
      const items = value.map((item) => item.trim()).filter((item) => item !== '');
      if (items.length > 0) return items;
      continue;
    }
    if (typeof value === 'string' && value.trim() !== '') {
      return splitAuthors(value);
    }
  }
  return [];
}

/** 键值表 → 书目字段 */
function toMetadata(map: Map<string, string | string[]>): Partial<BookMetadata> {
  const metadata: Partial<BookMetadata> = {};
  const extra: Record<string, unknown> = {};

  const title = scalarOf(map, 'title');
  if (title !== undefined) metadata.title = title;

  const subtitle = scalarOf(map, 'subtitle');
  if (subtitle !== undefined) metadata.subtitle = subtitle;

  const language = scalarOf(map, 'language');
  if (language !== undefined) metadata.language = language;

  const classification = scalarOf(map, 'classification');
  if (classification !== undefined) metadata.classification = classification;

  const names = listOf(map, ['author', 'authors', 'contributor', 'contributors']);
  if (names.length > 0) {
    metadata.contributors = names.map<Contributor>((name) => ({ name }));
  }

  const volumeCountText = scalarOf(map, 'volumeCount') ?? scalarOf(map, 'volumes');
  if (volumeCountText !== undefined) {
    const volumeCount = Number(volumeCountText);
    if (Number.isFinite(volumeCount) && volumeCount > 0) {
      metadata.volumeCount = Math.round(volumeCount);
    }
  }

  const isbn = scalarOf(map, 'isbn');
  if (isbn !== undefined) {
    metadata.identifiers = [{ scheme: 'isbn', value: isbn.replace(/[\s-]/g, '') }];
  }

  const publisher = scalarOf(map, 'publisher');
  const year = scalarOf(map, 'date') ?? scalarOf(map, 'year');
  const place = scalarOf(map, 'place');
  if (publisher !== undefined || year !== undefined || place !== undefined) {
    metadata.publication = {
      ...(publisher === undefined ? {} : { publisher }),
      ...(year === undefined ? {} : { year }),
      ...(place === undefined ? {} : { place }),
    };
  }

  /* 描述 / 摘要等无对应字段的标量进 extra */
  const description = scalarOf(map, 'description') ?? scalarOf(map, 'summary');
  if (description !== undefined) extra['description'] = description;

  const known = new Set([
    'title',
    'subtitle',
    'author',
    'authors',
    'contributor',
    'contributors',
    'language',
    'classification',
    'volumecount',
    'volumes',
    'isbn',
    'publisher',
    'date',
    'year',
    'place',
    'description',
    'summary',
  ]);
  for (const [key, value] of map) {
    if (known.has(key)) continue;
    extra[key] = value;
  }
  if (Object.keys(extra).length > 0) metadata.extra = extra;

  return metadata;
}

/**
 * 解析并剥离 Markdown front-matter
 *
 * 仅当首行是 `---` 且存在闭合分隔行时生效；否则原样返回输入，
 * 避免把普通分隔线误判为元数据块。
 */
export function parseFrontMatter(markdown: string): FrontMatterParseResult {
  const normalized = markdown.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  if ((lines[0] ?? '').trim() !== DELIMITER) {
    return { metadata: {}, body: markdown };
  }

  let end = -1;
  for (let index = 1; index < lines.length; index += 1) {
    const trimmed = (lines[index] ?? '').trim();
    if (trimmed === DELIMITER || trimmed === '...') {
      end = index;
      break;
    }
  }
  if (end < 0) {
    return { metadata: {}, body: markdown };
  }

  const metadata = toMetadata(parseYamlSubset(lines.slice(1, end)));
  const body = lines
    .slice(end + 1)
    .join('\n')
    .replace(/^\n+/, '');
  return { metadata, body };
}
