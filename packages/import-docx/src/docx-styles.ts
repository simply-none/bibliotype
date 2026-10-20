/**
 * DOCX 命名样式解析（word/styles.xml）
 *
 * 把 Word 的段落样式映射为库内 `NamedStyle`：
 * - id 统一 `ns-docx-` 前缀并做字符白名单清洗（避免 CSS 选择器注入）；
 * - 中文样式名保留为 `name`，`w:basedOn` 映射为 `basedOn`；
 * - 只映射常用格式子集：加粗 / 斜体 / 下划线 / 字号 / 颜色 / 首行缩进 /
 *   行距 / 段前段后 / 对齐；制表位、边框、主题字体等忽略。
 *
 * 同时收集正文实际引用的样式 id，供 `docxToBookDocumentWithStyles` 过滤
 * 未使用的内置样式（Word 默认模板带数十个未使用样式，全量返回会污染样式面板）。
 *
 * 依赖 `fflate`（解包，与 import-epub 同源）与 `@xmldom/xmldom`（XML 解析），
 * 均为工作区既有库，未引入新生态。
 */
import type { FeatureDeclarations, FeatureStyleId, NamedStyle, NamedStyleSet } from '@bibliotype/core';
import { DOMParser } from '@xmldom/xmldom';
import { strFromU8, unzipSync } from 'fflate';
import type { DocxInput } from './docx-html.js';

/** `@xmldom/xmldom` 未导出 `Element` 类型，这里只描述用到的结构 */
interface XmlNodeLike {
  nodeType: number;
  nextSibling: XmlNodeLike | null;
  firstChild: XmlNodeLike | null;
}

interface XmlElementLike extends XmlNodeLike {
  tagName: string;
  getAttribute(name: string): string | null;
}

/** 样式 id 前缀（与样式面板 / 序列化的命名空间一致） */
export const DOCX_STYLE_ID_PREFIX = 'ns-docx-';

/** 样式类名前缀（mammoth styleMap 输出到 HTML） */
export const DOCX_STYLE_CLASS_PREFIX = 'docx-style-';

/** 解析结果 */
export interface DocxStyleInfo {
  /** 正文实际引用到的命名样式（含其 basedOn 祖先） */
  namedStyles: NamedStyleSet;
  /** 正文引用的 Word 原始样式 id */
  usedStyleIds: ReadonlySet<string>;
  /** 传给 mammoth 的 styleMap 规则（仅已引用样式） */
  styleMap: string[];
}

interface ParsedStyle {
  rawId: string;
  name: string;
  basedOnRaw?: string;
  featureId: FeatureStyleId;
  declarations: FeatureDeclarations;
}

/** 原始字节 → Uint8Array */
function toBytes(input: DocxInput): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

/** 直接子元素（按限定标签名） */
function childOf(parent: XmlElementLike, tagName: string): XmlElementLike | undefined {
  for (let node = parent.firstChild; node !== null; node = node.nextSibling) {
    if (node.nodeType !== 1) continue;
    const element = node as XmlElementLike;
    if (element.tagName === tagName) return element;
  }
  return undefined;
}

/** 读取属性（缺省 / 空串归一为 undefined） */
function attrOf(element: XmlElementLike | undefined, name: string): string | undefined {
  if (element === undefined) return undefined;
  const value = element.getAttribute(name);
  return value === null || value === '' ? undefined : value;
}

/** 样式 id 清洗：白名单外全部替换为 `-` */
function safeStyleId(raw: string): string {
  const cleaned = raw
    .replace(/[^A-Za-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned === '' ? 'style' : cleaned;
}

/** Word 半磅 → CSS px（1pt = 4/3 px） */
function halfPointsToPx(halfPoints: number): number {
  return Math.round((halfPoints / 2) * (4 / 3));
}

/** twips → CSS px（1pt = 20 twips = 4/3 px） */
function twipsToPx(twips: number): number {
  return Math.round((twips / 20) * (4 / 3));
}

/** 是否为「开」的 Word 布尔属性（`w:val="0"` / `false` 为关） */
function isOn(element: XmlElementLike | undefined): boolean {
  if (element === undefined) return false;
  const value = attrOf(element, 'w:val');
  return value === undefined || (value !== '0' && value !== 'false');
}

/** 段落 / 文字属性 → CSS 声明 */
function declarationsOf(style: XmlElementLike): FeatureDeclarations {
  const declarations: FeatureDeclarations = {};

  const rPr = childOf(style, 'w:rPr');
  if (rPr !== undefined) {
    if (isOn(childOf(rPr, 'w:b'))) declarations['font-weight'] = '700';
    if (isOn(childOf(rPr, 'w:i'))) declarations['font-style'] = 'italic';
    if (isOn(childOf(rPr, 'w:u'))) declarations['text-decoration'] = 'underline';
    const size = Number(attrOf(childOf(rPr, 'w:sz'), 'w:val'));
    if (Number.isFinite(size) && size > 0) {
      declarations['font-size'] = `${halfPointsToPx(size)}px`;
    }
    const color = attrOf(childOf(rPr, 'w:color'), 'w:val');
    if (color !== undefined && /^[0-9A-Fa-f]{6}$/.test(color)) {
      declarations['color'] = `#${color.toLowerCase()}`;
    }
  }

  const pPr = childOf(style, 'w:pPr');
  if (pPr !== undefined) {
    const firstLine = Number(attrOf(childOf(pPr, 'w:ind'), 'w:firstLine'));
    if (Number.isFinite(firstLine) && firstLine > 0) {
      declarations['text-indent'] = `${twipsToPx(firstLine)}px`;
    }

    const spacing = childOf(pPr, 'w:spacing');
    const before = Number(attrOf(spacing, 'w:before'));
    const after = Number(attrOf(spacing, 'w:after'));
    if (Number.isFinite(before) && before > 0) {
      declarations['margin-top'] = `${twipsToPx(before)}px`;
    }
    if (Number.isFinite(after) && after > 0) {
      declarations['margin-bottom'] = `${twipsToPx(after)}px`;
    }
    const line = Number(attrOf(spacing, 'w:line'));
    const lineRule = attrOf(spacing, 'w:lineRule') ?? 'auto';
    if (Number.isFinite(line) && line > 0) {
      if (lineRule === 'auto') {
        const multiple = Math.round((line / 240) * 100) / 100;
        if (multiple > 0) declarations['line-height'] = String(multiple);
      } else {
        declarations['line-height'] = `${twipsToPx(line)}px`;
      }
    }

    const align = attrOf(childOf(pPr, 'w:jc'), 'w:val');
    if (align === 'center') declarations['text-align'] = 'center';
    else if (align === 'right' || align === 'end') declarations['text-align'] = 'right';
    else if (align === 'both' || align === 'justify') declarations['text-align'] = 'justify';
  }

  return declarations;
}

/** 由样式名 / id 推断功能样式（标题级别） */
function featureIdOf(name: string, rawId: string): FeatureStyleId {
  const match = /^(?:heading|标题)\s*([1-6])$/i.exec(name) ?? /^Heading([1-6])$/i.exec(rawId);
  if (match !== null) {
    return `block.heading.${match[1]}` as FeatureStyleId;
  }
  return 'block.paragraph';
}

/** 解析 styles.xml → 中间结构 */
function parseStylesXml(xml: string): ParsedStyle[] {
  let document;
  try {
    document = new DOMParser().parseFromString(xml, 'text/xml');
  } catch {
    return [];
  }

  const nodes = document.getElementsByTagName('w:style');
  const styles: ParsedStyle[] = [];
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index] as unknown as XmlElementLike | undefined;
    if (node === undefined) continue;
    /* 只收段落样式：字符样式无法落到块级 styleId */
    if (attrOf(node, 'w:type') !== 'paragraph') continue;
    const rawId = attrOf(node, 'w:styleId');
    if (rawId === undefined) continue;
    const name = attrOf(childOf(node, 'w:name'), 'w:val') ?? rawId;
    const basedOnRaw = attrOf(childOf(node, 'w:basedOn'), 'w:val');
    styles.push({
      rawId,
      name,
      ...(basedOnRaw === undefined ? {} : { basedOnRaw }),
      featureId: featureIdOf(name, rawId),
      declarations: declarationsOf(node),
    });
  }
  return styles;
}

/** 正文引用的 Word 段落样式 id（`<w:pStyle w:val="…"/>`） */
function collectUsedStyleIds(xml: string): Set<string> {
  const used = new Set<string>();
  const pattern = /<w:pStyle\s+[^>]*w:val="([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml)) !== null) {
    const value = match[1];
    if (value !== undefined && value !== '') used.add(value);
  }
  return used;
}

/**
 * 解析 DOCX 的样式信息
 *
 * - 缺少 `word/styles.xml` 时返回空集合（不报错）；
 * - 单个样式解析失败只跳过该样式；
 * - 返回的 `namedStyles` 已按正文引用过滤，并保留 basedOn 祖先链。
 */
export function parseDocxStyleInfo(input: DocxInput): DocxStyleInfo {
  const empty: DocxStyleInfo = {
    namedStyles: { version: 1, styles: [] },
    usedStyleIds: new Set(),
    styleMap: [],
  };

  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(toBytes(input));
  } catch {
    return empty;
  }

  const documentXml = files['word/document.xml'];
  const usedStyleIds =
    documentXml === undefined ? new Set<string>() : collectUsedStyleIds(strFromU8(documentXml));

  const stylesXml = files['word/styles.xml'];
  if (stylesXml === undefined) {
    return { ...empty, usedStyleIds };
  }

  const parsed = parseStylesXml(strFromU8(stylesXml));
  if (parsed.length === 0) {
    return { ...empty, usedStyleIds };
  }

  const known = new Set(parsed.map((style) => style.rawId));
  const styles: NamedStyle[] = parsed.map((style) => ({
    id: `${DOCX_STYLE_ID_PREFIX}${safeStyleId(style.rawId)}`,
    name: style.name,
    featureId: style.featureId,
    ...(style.basedOnRaw !== undefined && known.has(style.basedOnRaw)
      ? { basedOn: `${DOCX_STYLE_ID_PREFIX}${safeStyleId(style.basedOnRaw)}` }
      : {}),
    declarations: style.declarations,
  }));

  /* 只保留正文引用样式及其 basedOn 祖先 */
  const byId = new Map(styles.map((style) => [style.id, style]));
  const keep = new Set<string>();
  for (const rawId of usedStyleIds) {
    let current: NamedStyle | undefined = byId.get(`${DOCX_STYLE_ID_PREFIX}${safeStyleId(rawId)}`);
    while (current !== undefined && !keep.has(current.id)) {
      keep.add(current.id);
      current = current.basedOn === undefined ? undefined : byId.get(current.basedOn);
    }
  }

  /* 祖先即使无声明也保留，避免 basedOn 指向被过滤掉的 id（悬空引用） */
  const namedStyles: NamedStyleSet = {
    version: 1,
    styles: styles.filter((style) => keep.has(style.id)),
  };

  const styleMap: string[] = [];
  for (const style of namedStyles.styles) {
    /* mammoth styleMap 用单引号包裹样式名，含引号的名字跳过（极少数） */
    if (style.name.includes("'")) continue;
    styleMap.push(
      `p[style-name='${style.name}'] => p.${DOCX_STYLE_CLASS_PREFIX}${style.id.slice(DOCX_STYLE_ID_PREFIX.length)}`,
    );
  }

  return { namedStyles, usedStyleIds, styleMap };
}
