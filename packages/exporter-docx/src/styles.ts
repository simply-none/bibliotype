/**
 * Word 样式映射
 *
 * 导出侧只保证两件事：
 * 1. **语义层级**——标题走 Word 内置 `Heading1..6`（导航窗格、目录域、大纲级别全都能用）；
 * 2. **命名样式**——IR `attrs.styleId` 映射为同名 Word 段落样式，
 *    作者的「引文-楷体」「图表题注」等自定义样式不会在投稿时丢失。
 *
 * 功能样式（`FeatureStyleSheet`）不在这里展开：它是按类型统一的渲染层概念，
 * Word 侧用固定命名样式（BibliotypeBody 等）承接，改动样式表只改这一处即可。
 */
import {
  AlignmentType,
  LineRuleType,
  type IParagraphStyleOptions,
  type IParagraphStylePropertiesOptions,
  type IRunStylePropertiesOptions,
  type ISpacingProperties,
  type IStylesOptions,
} from 'docx';
import { findNamedStyle, type BookNode, type NamedStyleSet } from '@bibliotype/core';
import type { ResolvedDocxOptions } from './types.js';

/** 去掉只读修饰（docx 的选项类型全字段 readonly，拼装时需要可变视图） */
export type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** 固定命名样式 id（Word 样式面板可见） */
export const STYLE_IDS = {
  /** 正文 */
  body: 'BibliotypeBody',
  /** 引文 */
  quote: 'BibliotypeQuote',
  /** 图注 / 图表题 */
  caption: 'BibliotypeCaption',
  /** 代码块 */
  code: 'BibliotypeCode',
  /** 未引用注释的兜底段落 */
  note: 'BibliotypeNote',
} as const;

/** 代码字体（等宽） */
export const CODE_FONT = 'Consolas';

/** 标题字号（磅）：三号 / 小三 / 四号 / 小四 ×3 */
const HEADING_SIZES_PT = [16, 15, 14, 12, 12, 12] as const;

/** 标题段前距（缇） */
const HEADING_SPACE_BEFORE = [240, 240, 200, 160, 120, 120] as const;

/** 磅 → 缇（1pt = 20twips） */
export function ptToTwips(pt: number): number {
  return Math.round(pt * 20);
}

/** 磅 → 半磅（Word `w:sz` 单位） */
function ptToHalfPoints(pt: number): number {
  return Math.round(pt * 2);
}

/**
 * 命名样式 id → 合法 Word styleId
 *
 * Word 允许 styleId 使用字母、数字、连字符与下划线；其余字符替换为 `-`，
 * 首字符为数字时补 `S` 前缀（避免与内置样式的数字式 id 混淆）。
 */
export function toWordStyleId(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (cleaned === '') return 'BibliotypeStyle';
  const prefixed = /^[0-9]/.test(cleaned) ? `S${cleaned}` : cleaned;
  return prefixed.slice(0, 200);
}

/** 读取节点上的命名样式 id（`attrs.styleId`，兼容 rawAttrs 兜底容器） */
export function readStyleId(node: BookNode): string | undefined {
  const direct = node.attrs?.['styleId'];
  if (typeof direct === 'string' && direct.trim() !== '') return direct;

  const raw = node.attrs?.['rawAttrs'];
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    const nested = (raw as Record<string, unknown>)['styleId'];
    if (typeof nested === 'string' && nested.trim() !== '') return nested;
  }
  return undefined;
}

/**
 * 节点 → 命名样式对应的 Word styleId
 *
 * 样式表里查不到时返回 `undefined`（沿用途中的固定样式），
 * 不把来源不明的 styleId 写进 docx——Word 对未知 pStyle 的处理是静默忽略，
 * 但会让「样式面板里有一堆不存在的样式」误导作者。
 */
export function namedWordStyleId(
  node: BookNode,
  namedStyles: NamedStyleSet | undefined,
): string | undefined {
  const styleId = readStyleId(node);
  if (styleId === undefined) return undefined;
  const style = findNamedStyle(namedStyles, styleId);
  return style === undefined ? undefined : toWordStyleId(style.id);
}

/** 构建 docx 样式表（文档默认 + 标题层级 + 固定命名样式 + 用户命名样式） */
export function buildDocxStyles(options: ResolvedDocxOptions): IStylesOptions {
  const bodySize = ptToHalfPoints(options.bodyFontSizePt);
  const firstLine = Math.round(options.firstLineIndentChars * ptToTwips(options.bodyFontSizePt));

  const headingDefaults: Record<string, unknown> = {};
  for (let level = 1; level <= 6; level += 1) {
    headingDefaults[`heading${level}`] = {
      run: {
        font: options.headingFontFamily,
        size: ptToHalfPoints(HEADING_SIZES_PT[level - 1] ?? options.bodyFontSizePt),
        bold: true,
        color: '000000',
      },
      paragraph: {
        keepNext: true,
        keepLines: true,
        outlineLevel: level - 1,
        spacing: {
          before: HEADING_SPACE_BEFORE[level - 1] ?? 120,
          after: 120,
          line: 360,
          lineRule: LineRuleType.AUTO,
        },
      },
    };
  }

  const paragraphStyles: IParagraphStyleOptions[] = [
    {
      id: STYLE_IDS.body,
      name: '正文',
      quickFormat: true,
      run: { font: options.bodyFontFamily, size: bodySize },
      paragraph: {
        alignment: AlignmentType.JUSTIFIED,
        spacing: { line: 360, lineRule: LineRuleType.AUTO },
        indent: firstLine > 0 ? { firstLine } : undefined,
      },
    },
    {
      id: STYLE_IDS.quote,
      name: '引文',
      basedOn: STYLE_IDS.body,
      quickFormat: true,
      paragraph: {
        alignment: AlignmentType.START,
        indent: { left: 420, right: 420, firstLine: 0 },
        spacing: { before: 120, after: 120, line: 360, lineRule: LineRuleType.AUTO },
      },
    },
    {
      id: STYLE_IDS.caption,
      name: '图注',
      basedOn: STYLE_IDS.body,
      quickFormat: true,
      run: { size: ptToHalfPoints(10.5) },
      paragraph: {
        alignment: AlignmentType.CENTER,
        indent: { firstLine: 0 },
        spacing: { before: 120, after: 240, line: 300, lineRule: LineRuleType.AUTO },
      },
    },
    {
      id: STYLE_IDS.code,
      name: '代码块',
      basedOn: STYLE_IDS.body,
      quickFormat: true,
      run: { font: CODE_FONT, size: ptToHalfPoints(10), shading: { fill: 'F5F5F5' } },
      paragraph: {
        alignment: AlignmentType.START,
        indent: { left: 0, right: 0, firstLine: 0 },
        spacing: { before: 120, after: 120, line: 240, lineRule: LineRuleType.AUTO },
      },
    },
    {
      id: STYLE_IDS.note,
      name: '注文',
      basedOn: STYLE_IDS.body,
      run: { size: ptToHalfPoints(9) },
      paragraph: {
        alignment: AlignmentType.START,
        indent: { firstLine: 0 },
        spacing: { before: 60, after: 60, line: 300, lineRule: LineRuleType.AUTO },
      },
    },
  ];

  for (const style of options.namedStyles?.styles ?? []) {
    const mapped = declarationsToProps(style.declarations);
    paragraphStyles.push({
      id: toWordStyleId(style.id),
      name: style.name,
      basedOn: style.basedOn === undefined ? STYLE_IDS.body : toWordStyleId(style.basedOn),
      quickFormat: true,
      paragraph: mapped.paragraph,
      run: mapped.run,
    });
  }

  return {
    default: {
      document: {
        run: { font: options.bodyFontFamily, size: bodySize },
        paragraph: { spacing: { line: 360, lineRule: LineRuleType.AUTO } },
      },
      footnoteText: {
        run: { font: options.bodyFontFamily, size: ptToHalfPoints(9) },
        paragraph: { spacing: { line: 300, lineRule: LineRuleType.AUTO } },
      },
      ...headingDefaults,
    },
    paragraphStyles,
  };
}

/** 样式声明 → Word 段落 / 字符属性（未识别属性忽略） */
export function declarationsToProps(declarations: Record<string, string>): {
  paragraph: IParagraphStylePropertiesOptions;
  run: IRunStylePropertiesOptions;
} {
  const paragraph: Mutable<IParagraphStylePropertiesOptions> = {};
  const run: Mutable<IRunStylePropertiesOptions> = {};
  const indent: Mutable<NonNullable<IParagraphStylePropertiesOptions['indent']>> = {};
  const spacing: Mutable<ISpacingProperties> = {};

  for (const [rawKey, rawValue] of Object.entries(declarations)) {
    const key = rawKey.trim().toLowerCase();
    const value = rawValue.trim();
    if (value === '') continue;

    switch (key) {
      case 'font-family': {
        const family = firstFontFamily(value);
        if (family !== undefined) run.font = family;
        break;
      }
      case 'font-size': {
        const pt = lengthToPt(value);
        if (pt !== undefined) run.size = ptToHalfPoints(pt);
        break;
      }
      case 'font-weight': {
        const weight = Number.parseInt(value, 10);
        if (value === 'bold' || (Number.isFinite(weight) && weight >= 600)) run.bold = true;
        break;
      }
      case 'font-style':
        if (value === 'italic' || value === 'oblique') run.italics = true;
        break;
      case 'color': {
        const hex = colorToHex(value);
        if (hex !== undefined) run.color = hex;
        break;
      }
      case 'background-color': {
        const hex = colorToHex(value);
        if (hex !== undefined) run.shading = { fill: hex };
        break;
      }
      case 'text-decoration': {
        if (value.includes('underline')) run.underline = { type: 'single' };
        if (value.includes('line-through')) run.strike = true;
        break;
      }
      case 'letter-spacing': {
        const twips = lengthToTwips(value);
        if (twips !== undefined) run.characterSpacing = twips;
        break;
      }
      case 'text-align': {
        const alignment = alignmentOf(value);
        if (alignment !== undefined) paragraph.alignment = alignment;
        break;
      }
      case 'text-indent': {
        const twips = lengthToTwips(value, declarations['font-size']);
        if (twips !== undefined) indent.firstLine = twips;
        break;
      }
      case 'margin-left': {
        const twips = lengthToTwips(value, declarations['font-size']);
        if (twips !== undefined) indent.left = twips;
        break;
      }
      case 'margin-right': {
        const twips = lengthToTwips(value, declarations['font-size']);
        if (twips !== undefined) indent.right = twips;
        break;
      }
      case 'margin-top': {
        const twips = lengthToTwips(value, declarations['font-size']);
        if (twips !== undefined) spacing.before = twips;
        break;
      }
      case 'margin-bottom': {
        const twips = lengthToTwips(value, declarations['font-size']);
        if (twips !== undefined) spacing.after = twips;
        break;
      }
      case 'line-height': {
        const line = lineHeightToTwips(value, declarations['font-size']);
        if (line !== undefined) {
          spacing.line = line.value;
          spacing.lineRule = line.rule;
        }
        break;
      }
      default:
        break;
    }
  }

  if (Object.keys(indent).length > 0) paragraph.indent = indent;
  if (Object.keys(spacing).length > 0) paragraph.spacing = spacing;
  return { paragraph, run };
}

/** 取第一个字体族（去掉引号） */
function firstFontFamily(value: string): string | undefined {
  const first = value.split(',')[0]?.trim().replace(/^['"]|['"]$/g, '');
  return first === undefined || first === '' ? undefined : first;
}

/** CSS 长度 → 磅 */
function lengthToPt(value: string, baseFontSize?: string): number | undefined {
  const twips = lengthToTwips(value, baseFontSize);
  return twips === undefined ? undefined : twips / 20;
}

/** CSS 长度 → 缇（`em` 以当前字号为基准） */
function lengthToTwips(value: string, baseFontSize?: string): number | undefined {
  const match = /^(-?\d*\.?\d+)\s*(pt|px|em|rem|cm|mm|in)?$/i.exec(value.trim());
  if (match === null) return undefined;
  const amount = Number.parseFloat(match[1] ?? '');
  if (!Number.isFinite(amount)) return undefined;
  const unit = (match[2] ?? 'px').toLowerCase();
  switch (unit) {
    case 'pt':
      return Math.round(amount * 20);
    case 'px':
      return Math.round(amount * 15);
    case 'em':
    case 'rem': {
      const base = baseFontSize === undefined ? 12 : (lengthToPt(baseFontSize) ?? 12);
      return Math.round(amount * base * 20);
    }
    case 'cm':
      return Math.round(amount * 567);
    case 'mm':
      return Math.round(amount * 56.7);
    case 'in':
      return Math.round(amount * 1440);
    default:
      return undefined;
  }
}

/** 行高 → 缇（无单位按倍数，长度按固定值） */
function lineHeightToTwips(
  value: string,
  baseFontSize?: string,
): { value: number; rule: (typeof LineRuleType)[keyof typeof LineRuleType] } | undefined {
  if (value === 'normal') return undefined;
  if (/^-?\d*\.?\d+$/.test(value)) {
    const multiple = Number.parseFloat(value);
    if (!Number.isFinite(multiple) || multiple <= 0) return undefined;
    return { value: Math.round(multiple * 240), rule: LineRuleType.AUTO };
  }
  const twips = lengthToTwips(value, baseFontSize);
  return twips === undefined ? undefined : { value: twips, rule: LineRuleType.EXACT };
}

/** CSS 颜色 → 6 位十六进制 */
function colorToHex(value: string): string | undefined {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (hex !== null) {
    const raw = hex[1] ?? '';
    const full = raw.length === 3 ? raw.split('').map((ch) => ch + ch).join('') : raw;
    return full.toUpperCase();
  }
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i.exec(value.trim());
  if (rgb === null) return undefined;
  const channels = [rgb[1], rgb[2], rgb[3]].map((channel) => {
    const parsed = Number.parseInt(channel ?? '0', 10);
    return Math.max(0, Math.min(255, Number.isFinite(parsed) ? parsed : 0));
  });
  return channels.map((channel) => channel.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** CSS text-align → Word 对齐 */
function alignmentOf(value: string): (typeof AlignmentType)[keyof typeof AlignmentType] | undefined {
  switch (value.toLowerCase()) {
    case 'left':
    case 'start':
      return AlignmentType.START;
    case 'right':
    case 'end':
      return AlignmentType.END;
    case 'center':
      return AlignmentType.CENTER;
    case 'justify':
      return AlignmentType.JUSTIFIED;
    default:
      return undefined;
  }
}
