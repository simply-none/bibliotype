/**
 * 功能标识 → CSS 选择器映射
 *
 * 与 `@bibliotype/core` 的 `FEATURE_STYLE_IDS` 一一对应，是「功能样式表」落到 CSS 的唯一入口。
 * 选择器口径来自 `html-serializer.ts`：
 * - 节点输出 `class="bt-{type}"`（type 为 IR 的 kebab-case 类型名）；
 * - 标记输出 `class="bt-mark-{type}"`（underline / strikethrough / highlight / link 有专属分支）；
 * - 结构页与页码等版式角色输出 `data-role="…"`；
 * - 标题标签为 `h1 ~ h6` 且 class 恒为 `bt-heading` —— **分级样式必须靠标签选择器**
 *   （`h2.bt-heading`），只用 `.bt-heading` 无法区分级别。
 */
import { resolveNamedStyleDeclarations } from '@bibliotype/core';
import type { FeatureStyleId, FeatureStyleSheet, NamedStyleSet } from '@bibliotype/core';
import type { StyleDeclaration } from '../style-builder.js';

/**
 * 声明对象 → CSS 文本
 *
 * 本文件与 `book-css.ts` 互相引用会形成循环依赖，故此处本地实现
 * （与 `declarationToCss` 输出格式一致：每条一行、缩进两格）。
 */
function declarationsToCss(declaration: StyleDeclaration): string {
  return Object.entries(declaration)
    .map(([property, value]) => `  ${property}: ${value};`)
    .join('\n');
}

/** 功能 → 选择器（不含根容器前缀） */
const FEATURE_SELECTORS: Readonly<Record<FeatureStyleId, string>> = {
  /* ---------- 块级 ---------- */
  'block.paragraph': '.bt-paragraph',
  'block.heading.1': 'h1.bt-heading',
  'block.heading.2': 'h2.bt-heading',
  'block.heading.3': 'h3.bt-heading',
  'block.heading.4': 'h4.bt-heading',
  'block.heading.5': 'h5.bt-heading',
  'block.heading.6': 'h6.bt-heading',
  'block.quote': '.bt-quote',
  'block.list': '.bt-list',
  'block.list-item': '.bt-list-item',
  'block.code-block': '.bt-code-block',
  'block.table': '.bt-table',
  'block.table-cell': '.bt-table-cell',
  'block.image': '.bt-image',
  'block.caption': '.bt-caption',
  'block.break': '.bt-break',
  'block.math-block': '.bt-math-block',
  'block.footnote': '.bt-footnote',
  'block.endnote': '.bt-endnote',
  'block.margin-note': '.bt-margin-note',

  /* ---------- 行内标记 ---------- */
  'mark.strong': '.bt-mark-strong',
  'mark.emphasis': '.bt-mark-emphasis',
  'mark.underline': '.bt-mark-underline',
  'mark.strikethrough': '.bt-mark-strikethrough',
  'mark.highlight': '.bt-mark-highlight',
  'mark.code': '.bt-mark-code',
  'mark.link': '.bt-mark-link',
  // 注音的实际排版对象是注文（`<rt>`），基字样式由正文字体链决定
  'mark.ruby': 'ruby > rt',

  /* ---------- 古籍标记 ---------- */
  'mark.proper-name': '.bt-mark-proper-name',
  'mark.book-title': '.bt-mark-book-title',
  'mark.circle-emphasis': '.bt-mark-circle-emphasis',
  'mark.note-ref': '.bt-mark-note-ref',
  'mark.variant': '.bt-mark-variant',
  'mark.taboo': '.bt-mark-taboo',

  /* ---------- 古籍节点 ---------- */
  'block.double-note': '.bt-double-note',
  'block.inline-note': '.bt-inline-note',
  'block.head-note': '.bt-head-note',
  'block.tail-note': '.bt-tail-note',
  'block.collation-note': '.bt-collation-note',
  'block.collation-mark': '.bt-collation-mark',
  'block.variant-char': '.bt-variant-char',
  'block.taboo-char': '.bt-taboo-char',
  'block.imprint': '.bt-imprint',
  'block.colophon': '.bt-colophon',
  'block.seal': '.bt-seal',
  'block.border-frame': '.bt-border-frame',
  'block.fish-tail': '.bt-fish-tail',

  /* ---------- 版式角色：页面装饰 ---------- */
  'role.page-number': '.bt-page-number',
  'role.page-header': '.bt-page-header',
  'role.page-footer': '.bt-page-footer',

  /* ---------- 版式角色：结构页 ---------- */
  'role.cover-title': "[data-role='cover-title']",
  'role.cover-subtitle': "[data-role='cover-subtitle']",
  'role.cover-creator': "[data-role='cover-creator']",
  'role.cover-publisher': "[data-role='cover-publisher']",
  'role.title-page-title': "[data-role='title-page-title']",
  'role.title-page-subtitle': "[data-role='title-page-subtitle']",
  'role.title-page-creator': "[data-role='title-page-creator']",
  'role.title-page-publisher': "[data-role='title-page-publisher']",
  'role.copyright-title': "[data-role='copyright-title']",
  'role.copyright-line': "[data-role='copyright-line']",
  'role.toc-title': "[data-role='toc-title']",
  'role.toc-entry': "[data-role='toc-entry']",
  'role.toc-subentry': "[data-role='toc-subentry']",
  'role.volume-title': "[data-role='volume-title']",
  'role.volume-creator': "[data-role='volume-creator']",
  'role.back-cover-line': "[data-role='back-cover-line']",
};

/**
 * 取功能对应的选择器（不含根容器前缀）
 *
 * 未知功能（如降级读到的未来版本 id）返回 `undefined` —— 调用方应跳过，
 * 而不是猜测一个选择器（猜错会污染无关元素）。
 */
export function resolveFeatureSelector(id: string): string | undefined {
  return FEATURE_SELECTORS[id as FeatureStyleId];
}

/** 已登记的全部功能选择器（测试与文档用） */
export function listFeatureSelectors(): ReadonlyArray<[string, string]> {
  return Object.entries(FEATURE_SELECTORS);
}

/**
 * 覆盖规则用的选择器（缺省与 FEATURE_SELECTORS 相同）
 *
 * 少数功能的默认规则带属性选择器（`.bt-mark-circle-emphasis[data-style=…]`、
 * `.bt-break[data-variant=…]`，优先级 0-2-0），若用户覆盖仍用单类选择器（0-1-0）
 * 就会「改了不生效」。这些功能改用同样带属性条件的覆盖选择器，保证同优先级、
 * 靠后输出 → 用户覆盖胜出。不影响没有该属性的元素（另有单类规则兜底）。
 */
const FEATURE_OVERRIDE_SELECTORS: Partial<Record<FeatureStyleId, string>> = {
  'mark.circle-emphasis': '.bt-mark-circle-emphasis[data-style]',
  'block.break': '.bt-break[data-variant]',
};

/**
 * 直排 / 横排的边向声明转写
 *
 * 专名号（以及同类以物理边实现的行内装饰）的基线规则按书写方向分别用
 * `border-bottom`（横排）与 `border-left`（直排）——物理属性才能在老引擎上稳定生效
 * （不使用逻辑属性：RMSDK 不支持 `border-block-end`）。用户只配一套边向声明，
 * 由本函数在另一方向下转写，避免「切直排后专名号样式失效」。
 */
const SIDE_ALIASES: ReadonlyArray<[string, string]> = [
  ['border-top', 'border-right'],
  ['border-right', 'border-top'],
  ['border-bottom', 'border-left'],
  ['border-left', 'border-bottom'],
  ['padding-top', 'padding-right'],
  ['padding-right', 'padding-top'],
  ['padding-bottom', 'padding-left'],
  ['padding-left', 'padding-bottom'],
];

/** 按书写方向转写边向声明（其余声明原样保留） */
export function translateSideDeclarations(
  declarations: StyleDeclaration,
  vertical: boolean,
): StyleDeclaration {
  const result: StyleDeclaration = {};
  for (const [property, value] of Object.entries(declarations)) {
    const direct = vertical
      ? SIDE_ALIASES.find(([from]) => from === property)?.[1]
      : undefined;
    if (direct !== undefined) {
      result[direct] = value;
      continue;
    }
    /* 带后缀的长写法（border-bottom-width 等） */
    let mapped = property;
    if (vertical) {
      for (const [from, to] of SIDE_ALIASES) {
        if (property.startsWith(`${from}-`)) {
          mapped = `${to}${property.slice(from.length)}`;
          break;
        }
      }
    }
    result[mapped] = value;
  }
  return result;
}

/** 生成功能样式覆盖规则输入 */
export interface BuildFeatureCssOptions {
  /** 根容器选择器（缺省 'body'），与书册样式保持同一作用域 */
  containerSelector?: string;
  /** 命名样式集合（输出 `[data-style-id="…"]` 规则） */
  namedStyles?: NamedStyleSet;
  /** 是否直排（影响专名号等物理边声明的转写；缺省 false） */
  vertical?: boolean;
}

/** 生成过程中的规则条目（选择器 + 声明） */
export interface FeatureCssRule {
  selector: string;
  declarations: StyleDeclaration;
}

/** 需要按书写方向转写边向声明的功能（基线规则使用物理边） */
const SIDE_SENSITIVE_FEATURES: ReadonlySet<string> = new Set(['mark.proper-name']);

/**
 * 收集功能样式规则
 *
 * 顺序约定（后写者胜出，靠层叠顺序而非 `!important`）：
 * 1. 功能样式表（按 `FEATURE_STYLE_IDS` 声明顺序遍历，保证输出稳定）；
 * 2. 命名样式（属性选择器与类选择器同优先级，排在后面 → 单个节点可覆盖功能统一样式）。
 */
export function collectFeatureRules(
  features: FeatureStyleSheet | undefined,
  namedStyles?: NamedStyleSet,
  containerSelector = 'body',
  vertical = false,
): FeatureCssRule[] {
  const rules: FeatureCssRule[] = [];

  if (features !== undefined) {
    for (const [id, declarations] of Object.entries(features)) {
      if (declarations === undefined) continue;
      if (Object.keys(declarations).length === 0) continue;
      const selector = resolveFeatureSelector(id);
      if (selector === undefined) continue;
      const overrideSelector = FEATURE_OVERRIDE_SELECTORS[id as FeatureStyleId] ?? selector;
      const resolved =
        vertical && SIDE_SENSITIVE_FEATURES.has(id)
          ? translateSideDeclarations(declarations, true)
          : declarations;
      rules.push({
        selector: `${containerSelector} ${overrideSelector}`,
        declarations: resolved,
      });
    }
  }

  if (namedStyles !== undefined) {
    for (const style of namedStyles.styles) {
      /*
       * CSS 无跨规则继承：这里必须把 basedOn 链扁平成一条声明。
       * 空声明（含「只写 basedOn、自身无声明」的子样式）解析后可能非空，
       * 故不能用 style.declarations 的键数提前跳过。
       */
      const declarations = resolveNamedStyleDeclarations(namedStyles, style.id);
      if (Object.keys(declarations).length === 0) continue;
      rules.push({
        selector: `${containerSelector} [data-style-id="${escapeSelectorValue(style.id)}"]`,
        declarations,
      });
    }
  }

  return rules;
}

/** 属性选择器值转义（命名样式 id 限安全字符，此处只做兜底） */
function escapeSelectorValue(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

/**
 * 生成功能样式 CSS 文本
 *
 * 返回空串表示没有任何覆盖（调用方据此跳过拼接，避免样式表里多出空行）。
 */
export function buildFeatureCss(
  features: FeatureStyleSheet | undefined,
  options: BuildFeatureCssOptions = {},
): string {
  const rules = collectFeatureRules(
    features,
    options.namedStyles,
    options.containerSelector ?? 'body',
    options.vertical === true,
  );
  if (rules.length === 0) return '';
  return rules.map((rule) => `${rule.selector} {\n${declarationsToCss(rule.declarations)}\n}`).join('\n\n');
}
