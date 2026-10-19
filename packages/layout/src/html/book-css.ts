/**
 * 书册样式表生成（@bibliotype/layout/html）
 *
 * 将「主题令牌 + 布局选项」编译为可直接使用的 CSS 文本，
 * 供 EPUB（style.css）与 PDF（打印稿内联 <style>）共用：
 * - :root 输出 --bt-* 变量（令牌的 CSS Variables 层）；
 * - 根容器规则（默认 body，可经 containerSelector 替换）通过 var() 引用变量，
 *   书写方向 / 直排策略 / 分栏由布局选项决定；
 * - .bt-* 节点类与 html-serializer 的 class 输出配套，开箱即有基础排版；
 *   节点 / 角色选择器同样限定在根容器内，避免样式泄漏到容器之外
 *   （如同一页面中使用同名 bt-* 类的编辑画布）。
 */
import {
  COLOR_TOKENS,
  FONT_SIZE_TOKENS,
  FONT_TOKENS,
  LAYOUT_TOKENS,
  type FeatureStyleSheet,
  type NamedStyleSet,
} from '@bibliotype/core';
import { combineUprightCss } from '../combine-upright.js';
import type { LayoutOptions } from '../layout-options.js';
import { buildCssVariables, type StyleDeclaration } from '../style-builder.js';
import { isVerticalMode } from '../writing-mode.js';
import { buildFeatureCss } from './feature-selectors.js';

/** CSS 声明对象 → CSS 文本（每条声明一行，缩进两格） */
export function declarationToCss(declaration: StyleDeclaration): string {
  return Object.entries(declaration)
    .map(([property, value]) => `  ${property}: ${value};`)
    .join('\n');
}

/** 书册样式生成输入 */
export interface BuildBookCssOptions {
  /** 主题令牌值表（来自 ThemeAccessor.all() 或 DEFAULT_THEME，允许扩展键） */
  tokens: Readonly<Record<string, string | undefined>>;
  /** 布局选项 */
  options: LayoutOptions;
  /** 正文字体族令牌键（默认 FONT_TOKENS.BODY，古籍可传 CLASSICAL_BODY） */
  fontToken?: string;
  /** 根容器选择器（默认 'body'；阅读器视图可传自身容器，如 '.bt-reader-page'） */
  containerSelector?: string;
  /**
   * 扁平化 CSS 变量（导出 EPUB 用，默认 false）
   *
   * true 时把 `:root { --bt-* }` 变量层的值替换进所有 `var(--bt-*)` 引用并
   * 删除 `:root` 块：Adobe RMSDK / 微信读书的老引擎不支持 CSS Variables，
   * 含 `var()` 的声明会被整条丢弃（表现为「整本书无排版」），扁平化后
   * computed value 直写，现代与老引擎渲染一致。
   */
  flatten?: boolean;
  /**
   * 功能样式表（按功能粒度覆盖节点 / 标记 / 角色样式）
   *
   * 输出位置在默认规则之后（同优先级下靠层叠顺序胜出，不使用 `!important`：
   * 老引擎对 `!important` 与 `var()` 的组合行为不可靠）。`flatten` 开启时
   * 其中的 `var(--bt-*)` 引用一并被扁平化。
   */
  features?: FeatureStyleSheet;
  /** 命名样式集合（输出 `[data-style-id="…"]` 规则，优先级高于功能样式） */
  namedStyles?: NamedStyleSet;
}

/** 标题 1~6 相对 `--bt-font-size-heading` 的倍率（H1 为基准） */
const HEADING_LEVEL_SCALES: Readonly<Record<number, number>> = {
  1: 1,
  2: 0.82,
  3: 0.72,
  4: 0.64,
  5: 0.58,
  6: 0.54,
};

/** 生成书册基础样式表（变量层 + 根容器规则 + 节点类样式） */
export function buildBookCss(input: BuildBookCssOptions): string {
  const { tokens, options } = input;
  const fontToken = input.fontToken ?? FONT_TOKENS.BODY;
  const containerSelector = input.containerSelector ?? 'body';
  const vertical = isVerticalMode(options.writingMode);

  const rules: string[] = [];

  /* ---------- 1. 变量层：--bt-* ---------- */
  const variables = buildCssVariables(tokens);
  const variableLines = Object.entries(variables)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n');
  rules.push(`:root {\n${variableLines}\n}`);

  /* ---------- 2. 根容器基础规则 ---------- */
  const body: StyleDeclaration = {
    margin: '0',
    'font-family': `var(--bt-${fontToken})`,
    'font-size': `var(--bt-${FONT_SIZE_TOKENS.BODY})`,
    'line-height': `var(--bt-${LAYOUT_TOKENS.LINE_HEIGHT})`,
    'letter-spacing': `var(--bt-${LAYOUT_TOKENS.LETTER_SPACING})`,
    color: `var(--bt-${COLOR_TOKENS.TEXT})`,
    'background-color': `var(--bt-${COLOR_TOKENS.BACKGROUND})`,
    'writing-mode': options.writingMode,
  };
  if (vertical) {
    body['-webkit-writing-mode'] = options.writingMode;
    body['text-orientation'] = tokens['text-orientation'] ?? 'mixed';
    const combine = combineUprightCss(options.combineUpright);
    if (combine !== undefined) {
      body['text-combine-upright'] = combine;
    }
  }
  if (options.columns > 1) {
    body['column-count'] = String(options.columns);
    body['-webkit-column-count'] = String(options.columns);
    body['column-gap'] = `var(--bt-${LAYOUT_TOKENS.COLUMN_GAP})`;
  }
  rules.push(`${containerSelector} {\n${declarationToCss(body)}\n}`);

  /*
   * ---------- 3. 节点类样式（与 bt-* class 配套；经 scoped() 限定容器） ----------
   *
   * 另含「版式角色」选择器（data-role）约定，供书籍结构页与卷端题署标注：
   * - 结构页：cover-title / cover-subtitle / cover-creator / cover-publisher、
   *   title-page-title / title-page-creator / title-page-publisher、
   *   copyright-title / copyright-line、back-cover-line；
   * - 目录页：toc-title / toc-entry / toc-subentry；
   * - 卷端题署：volume-title / volume-creator。
   *
   * 全部节点 / 角色规则经 scoped() 前缀根容器选择器：样式只作用于容器内，
   * 避免泄漏到容器之外（如同一页面中同名 bt-* 类的编辑画布）。
   */
  const scoped = (selector: string): string => `${containerSelector} ${selector}`;

  rules.push(`${scoped('.bt-paragraph')} {
  margin: 0;
  text-indent: var(--bt-${LAYOUT_TOKENS.TEXT_INDENT});
}
${scoped('.bt-heading')} {
  font-family: var(--bt-${FONT_TOKENS.HEADING});
  font-size: var(--bt-${FONT_SIZE_TOKENS.HEADING});
  line-height: 1.4;
}
/*
 * 标题分级（R5 修复）：序列化器对 heading 输出 h1~h6 标签、class 恒为 bt-heading，
 * 此前只有一条 .bt-heading 规则 → 六级标题字号完全相同。此处按级别给倍率
 * （以 --bt-font-size-heading 为基准），先写静态 em 兜底、再写 calc 引用变量：
 * 老引擎忽略 calc 时用前者，现代引擎用后者，两者都跟随令牌缩放。
 */
${[1, 2, 3, 4, 5, 6]
  .map((level) => {
    const factor = HEADING_LEVEL_SCALES[level] ?? 1;
    const fallback = (1.75 * factor).toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
    return `${scoped(`h${level}.bt-heading`)} {\n  font-size: ${fallback}em;\n  font-size: calc(var(--bt-${FONT_SIZE_TOKENS.HEADING}) * ${factor});\n}`;
  })
  .join('\n')}
${scoped('.bt-quote')} {
  margin: 1em 2em;
  color: var(--bt-${COLOR_TOKENS.NOTE_TEXT});
}
${scoped('.bt-list')} {
  margin: 0.5em 0;
  padding-inline-start: 1.6em;
}
${scoped('.bt-code-block')} {
  font-family: var(--bt-${FONT_TOKENS.MONO});
  font-size: 0.85em;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: break-word;
}
${scoped('.bt-caption')},
${scoped('.bt-footnote')},
${scoped('.bt-endnote')},
${scoped('.bt-margin-note')} {
  font-size: var(--bt-${FONT_SIZE_TOKENS.NOTE});
  color: var(--bt-${COLOR_TOKENS.NOTE_TEXT});
}
${scoped('.bt-footnote')},
${scoped('.bt-endnote')},
${scoped('.bt-margin-note')} {
  display: block;
  margin: 0.5em 0;
}
${scoped('.bt-table')} {
  border-collapse: collapse;
  /* 逻辑外边距：横排为上下、直排为左右，表格与相邻块沿书写方向留白 */
  margin-block: 1em;
  margin-inline: 0;
  /* 表格随书写方向排布：直排下单元格文字竖排，列沿页宽方向展开 */
  writing-mode: inherit;
  table-layout: auto;
}
${scoped('.bt-table-cell')} {
  border: 1px solid var(--bt-${COLOR_TOKENS.TEXT});
  /* 逻辑内边距：横排上下 0.25em / 左右 0.6em；直排自动换算 */
  padding-block: 0.25em;
  padding-inline: 0.6em;
  /* 空单元格保留可点击 / 可测量面积，避免 Word 式空表塌成一条线 */
  min-inline-size: 2em;
  min-block-size: 1.6em;
}
${scoped('.bt-image')} {
  max-width: 100%;
}
${scoped('.bt-break')} {
  border: 0;
  border-block-start: 1px solid var(--bt-${COLOR_TOKENS.NOTE_TEXT});
  margin: 1em 0;
}
${scoped(".bt-break[data-variant='dashed']")} {
  border-block-start-style: dashed;
}
${scoped(".bt-break[data-variant='dotted']")} {
  border-block-start-style: dotted;
}
${scoped(".bt-break[data-variant='double']")} {
  border-block-start-style: double;
  border-block-start-width: 3px;
}
${scoped(".bt-break[data-variant='page']")} {
  border: 0;
  border-block-start: 1px dashed #999999;
}
${scoped('.bt-mark-underline')} {
  text-decoration: underline;
}
${scoped('.bt-mark-strikethrough')} {
  text-decoration: line-through;
}
${scoped('.bt-mark-highlight')} {
  background-color: rgba(255, 235, 130, 0.45);
}
${scoped('.bt-mark-link')} {
  color: var(--bt-${COLOR_TOKENS.ACCENT});
}
${scoped('.bt-math-block')} {
  margin: 1em 0;
  text-align: center;
}
${scoped('ruby > rt')} {
  font-size: 0.5em;
}

/* ---------- 4. 书籍结构页（封面/书名页/版权页/目录/卷端/封底） ---------- */
${scoped("[data-role='cover-title']")} {
  margin: 2.6em 0 0;
  text-align: center;
  font-size: 2.8em;
  letter-spacing: 0.4em;
  text-indent: 0.4em;
}
${scoped("[data-role='cover-subtitle']")},
${scoped("[data-role='title-page-subtitle']")} {
  margin: 1.4em 0 0;
  text-align: center;
  font-size: 1.1em;
  letter-spacing: 0.25em;
  color: var(--bt-${COLOR_TOKENS.NOTE_TEXT});
}
${scoped("[data-role='cover-creator']")} {
  margin: 3.5em 0 0;
  text-align: center;
  font-size: 0.95em;
  letter-spacing: 0.15em;
}
${scoped("[data-role='cover-publisher']")} {
  margin: 4em 0 0;
  text-align: center;
  font-size: 0.85em;
  letter-spacing: 0.2em;
  color: var(--bt-${COLOR_TOKENS.NOTE_TEXT});
}
${scoped("[data-role='title-page-title']")} {
  margin: 4em 0 0;
  text-align: center;
  font-size: 1.9em;
  letter-spacing: 0.3em;
}
${scoped("[data-role='title-page-creator']")} {
  margin: 1.8em 0 0;
  text-align: center;
  font-size: 0.95em;
  letter-spacing: 0.1em;
}
${scoped("[data-role='title-page-publisher']")} {
  margin: 6em 0 0;
  text-align: center;
  font-size: 0.85em;
  color: var(--bt-${COLOR_TOKENS.NOTE_TEXT});
}
${scoped("[data-role='copyright-title']")} {
  margin: 2em 0 1.4em;
  text-align: center;
  font-size: 1em;
  letter-spacing: 0.25em;
}
${scoped("[data-role='copyright-line']")} {
  margin: 0.35em 0;
  font-size: 0.78em;
  color: var(--bt-${COLOR_TOKENS.NOTE_TEXT});
}
${scoped("[data-role='toc-title']")} {
  margin: 1.2em 0 1em;
  text-align: center;
  font-size: 1.2em;
  letter-spacing: 0.4em;
  text-indent: 0.4em;
}
${scoped("[data-role='toc-entry']")} {
  margin: 0.55em 0;
  text-align: center;
  letter-spacing: 0.12em;
}
${scoped("[data-role='toc-subentry']")} {
  margin: 0.3em 0;
  text-align: center;
  font-size: 0.85em;
  color: var(--bt-${COLOR_TOKENS.NOTE_TEXT});
}
${scoped("[data-role='volume-title']")} {
  margin: 0.4em 0 0.2em;
  text-align: center;
  font-size: 1.3em;
  letter-spacing: 0.25em;
}
${scoped("[data-role='volume-creator']")} {
  margin: 0 0 1.2em;
  text-align: center;
  font-size: 0.82em;
  color: var(--bt-${COLOR_TOKENS.NOTE_TEXT});
}
${scoped("[data-role='back-cover-line']")} {
  margin: 0.5em 0;
  text-align: center;
  font-size: 0.8em;
  color: var(--bt-${COLOR_TOKENS.NOTE_TEXT});
}

/* ---------- 5. 古籍注文与标注 ---------- */
/*
 * 序列化器对无元素子节点的古典型容器（double-note / head-note /
 * collation-note / imprint / colophon）以 span 兜底，块级语义在此
 * 经 display: block 修正；行内载体（collation-mark / variant-char）保持行内。
 * 编辑保存后容器内直挂文本会规范化为「容器 + 段落」，故另以规则让
 * 容器内段落显式继承（text-indent 为继承属性）：直挂文本形态直接继承
 * 根容器的计算值（如 2em@16px＝32px），而段落形态若走基础 .bt-paragraph
 * 规则会按注文自身较小字号重算 em（2em@11.5px≈23px），故用 inherit
 * 锁定容器继承链上的同一计算值，保证两种形态首行缩进与换行一致
 * （reader 分块规则同步：见 @bibliotype/reader 的 TEXT_CONTAINER_TYPES）。
 */
${scoped('.bt-double-note')} {
  display: block;
  margin: 0.35em 0 0.45em 1.2em;
  font-size: 0.72em;
  line-height: 1.65;
  color: var(--bt-${COLOR_TOKENS.NOTE_TEXT});
  column-count: 2;
  column-gap: 1.6em;
}
${scoped('.bt-head-note')} {
  display: block;
  margin: 0.45em 1.6em;
  padding: 0.25em 0.7em;
  font-size: 0.72em;
  color: var(--bt-${COLOR_TOKENS.NOTE_TEXT});
  border: 1px solid #9a9488;
  /* color-mix 不被 RMSDK 支持 → 上一条为老引擎兜底，现代引擎取本条 */
  border: 1px solid color-mix(in srgb, var(--bt-${COLOR_TOKENS.NOTE_TEXT}) 40%, transparent);
  border-radius: 2px;
}
${scoped('.bt-collation-note')} {
  display: block;
  margin: 0.5em 0;
  padding-inline-start: 0.75em;
  font-size: 0.7em;
  color: var(--bt-${COLOR_TOKENS.NOTE_TEXT});
  border-inline-start: 2px solid #9a9488;
  border-inline-start: 2px solid color-mix(in srgb, var(--bt-${COLOR_TOKENS.NOTE_TEXT}) 55%, transparent);
}
${scoped('.bt-imprint')} {
  display: block;
  width: fit-content;
  margin: 1.2em auto;
  padding: 0.5em 1em;
  border: 1px solid #9a9488;
  border: 1px solid color-mix(in srgb, var(--bt-${COLOR_TOKENS.NOTE_TEXT}) 45%, transparent);
  font-size: 0.78em;
  text-align: center;
  letter-spacing: 0.1em;
  color: var(--bt-${COLOR_TOKENS.NOTE_TEXT});
}
${scoped('.bt-colophon')} {
  display: block;
  margin: 1.4em 0 0.6em;
  padding-block-start: 0.6em;
  border-block-start: 1px solid #9a9488;
  border-block-start: 1px solid color-mix(in srgb, var(--bt-${COLOR_TOKENS.NOTE_TEXT}) 35%, transparent);
  font-size: 0.78em;
  text-align: center;
  letter-spacing: 0.05em;
  color: var(--bt-${COLOR_TOKENS.NOTE_TEXT});
}
${scoped('.bt-double-note .bt-paragraph')},
${scoped('.bt-head-note .bt-paragraph')},
${scoped('.bt-tail-note .bt-paragraph')},
${scoped('.bt-collation-note .bt-paragraph')},
${scoped('.bt-imprint .bt-paragraph')},
${scoped('.bt-colophon .bt-paragraph')},
${scoped('.bt-footnote .bt-paragraph')},
${scoped('.bt-endnote .bt-paragraph')},
${scoped('.bt-margin-note .bt-paragraph')} {
  text-indent: inherit;
}
${scoped('.bt-collation-mark')} {
  margin-inline: 0.15em;
}
${scoped('.bt-collation-mark::after')} {
  content: attr(data-symbol);
}
${scoped('.bt-taboo-char')},
${scoped('.bt-mark-taboo')} {
  text-decoration: underline dashed;
  text-underline-offset: 3px;
}
${scoped('.bt-mark-variant')} {
  text-decoration: underline dotted;
  text-underline-offset: 3px;
}

/* 行内载体与装饰节点基样式：序列化产物已有 bt-* class，
 * 此前缺基样式导致「插入了但看不见 / 看不出区别」（R4）。
 * 其中 .bt-variant-char 与标记 .bt-mark-variant 对称，统一点状下划线。 */
${scoped('.bt-inline-note')} {
  font-size: 0.85em;
  color: var(--bt-${COLOR_TOKENS.NOTE_TEXT});
}
${scoped('.bt-variant-char')} {
  text-decoration: underline dotted;
  text-underline-offset: 3px;
}
${scoped('.bt-seal')} {
  display: inline-block;
  padding: 0.1em 0.3em;
  border: 1px solid currentColor;
  border-radius: 2px;
  line-height: 1;
}
${scoped('.bt-seal::after')} {
  content: attr(data-text);
}
${scoped('.bt-fish-tail')} {
  display: inline-block;
  width: 0.8em;
  height: 0.6em;
  border-top: 1px solid var(--bt-${COLOR_TOKENS.NOTE_TEXT});
  border-bottom: 1px solid var(--bt-${COLOR_TOKENS.NOTE_TEXT});
  position: relative;
  vertical-align: middle;
}
${scoped('.bt-fish-tail::after')} {
  content: "";
  position: absolute;
  left: 50%;
  top: 0;
  bottom: 0;
  border-left: 1px solid var(--bt-${COLOR_TOKENS.NOTE_TEXT});
}
${scoped('.bt-border-frame')} {
  border: 3px double var(--bt-${COLOR_TOKENS.TEXT});
  padding: 0.5em 0.75em;
  margin: 0.5em 0;
}
${scoped('.bt-tail-note')} {
  display: block;
  margin: 0.8em 0;
  padding-inline-start: 1.2em;
  font-size: 0.85em;
  color: var(--bt-${COLOR_TOKENS.NOTE_TEXT});
}
${scoped('.bt-mark-book-title')} {
  text-decoration: underline wavy;
  text-decoration-thickness: 1px;
  text-underline-offset: 4px;
}
${scoped('.bt-mark-circle-emphasis')} {
  text-emphasis: filled circle;
  text-emphasis-position: under right;
}
/*
 * 圈点样式变体（R6 修复）：circleEmphasis.attrs.style 一直在 schema / IR 里，
 * 序列化器也输出 data-style，但此前 CSS 写死 filled circle → 属性改了样式不变。
 * 值约定：circle（缺省）/ open-circle / dot / open-dot / double-circle / triangle / sesame。
 * 注意：本段位于模板字符串内部，注释里不可出现反引号（会提前闭合模板）。
 */
${scoped(".bt-mark-circle-emphasis[data-style='open-circle']")} {
  text-emphasis: open circle;
}
${scoped(".bt-mark-circle-emphasis[data-style='dot']")} {
  text-emphasis: filled dot;
}
${scoped(".bt-mark-circle-emphasis[data-style='open-dot']")} {
  text-emphasis: open dot;
}
${scoped(".bt-mark-circle-emphasis[data-style='double-circle']")} {
  text-emphasis: double-circle;
}
${scoped(".bt-mark-circle-emphasis[data-style='triangle']")} {
  text-emphasis: filled triangle;
}
${scoped(".bt-mark-circle-emphasis[data-style='sesame']")} {
  text-emphasis: sesame;
}
${scoped('.bt-mark-note-ref')} {
  font-size: 0.72em;
  vertical-align: super;
}

/* ---------- 6. 脚注（注线：与相邻注文相连时仅首条保留） ---------- */
${scoped('.bt-footnote')} {
  margin: 0.55em 0;
  padding-block-start: 0.4em;
  border-block-start: 1px solid #9a9488;
  border-block-start: 1px solid color-mix(in srgb, var(--bt-${COLOR_TOKENS.NOTE_TEXT}) 45%, transparent);
}
${scoped('.bt-footnote + .bt-footnote')} {
  border-block-start: 0;
  padding-block-start: 0;
}

/* ---------- 7. 页脚页码（固定横排显示，居中于页面物理底部） ---------- */
${scoped('.bt-page-number')} {
  position: absolute;
  bottom: 16px;
  left: 0;
  right: 0;
  writing-mode: horizontal-tb;
  text-align: center;
  font-size: 0.75em;
  letter-spacing: 0.15em;
  color: var(--bt-${COLOR_TOKENS.NOTE_TEXT});
}
/*
 * 页眉 / 页脚：由渲染层按页注入（编辑画布、打印稿、阅读预览同源），
 * 绝对定位在页面上下沿、不参与正文流。占位高度取 buildRootStyle 下发的
 * CSS 变量（与分页侧 resolvePageMainSize 的扣减同源），文本在条带内居中。
 * 细节（字号 / 对齐 / 分隔线 / 位置）由功能样式 role.page-header / role.page-footer 覆盖。
 */
${scoped('.bt-page-header')},
${scoped('.bt-page-footer')} {
  position: absolute;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  writing-mode: horizontal-tb;
  font-family: var(--bt-${FONT_TOKENS.BODY});
  font-size: 0.72em;
  letter-spacing: 0.08em;
  color: var(--bt-${COLOR_TOKENS.NOTE_TEXT});
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
}
${scoped('.bt-page-header')} {
  top: 0;
  height: var(--bt-page-header-size, 24px);
}
${scoped('.bt-page-footer')} {
  bottom: 0;
  height: var(--bt-page-footer-size, 24px);
}
`);

  /* ---------- 8. 专名号：横排标于字下 / 直排标于字左（GB 古籍整理规范） ---------- */
  rules.push(
    vertical
      ? `${scoped('.bt-mark-proper-name')} {\n  border-left: 1px solid currentColor;\n  padding-left: 1px;\n}`
      : `${scoped('.bt-mark-proper-name')} {\n  border-bottom: 1px solid currentColor;\n}`,
  );

  /*
   * ---------- 9. 用户覆盖：功能样式 + 命名样式 ----------
   *
   * 追加在最后：同优先级靠层叠顺序胜出（不用 !important——老引擎对
   * `!important` 与 `var()` 的组合行为不可靠）。命名样式排在其后，
   * 因而「挂到具体段落上的样式」能覆盖「按功能统一的样式」。
   */
  const featureCss = buildFeatureCss(input.features, {
    containerSelector,
    namedStyles: input.namedStyles,
    vertical,
  });
  if (featureCss !== '') {
    rules.push(`/* ---------- 用户样式覆盖（功能样式 / 命名样式） ---------- */\n${featureCss}`);
  }

  const css = `${rules.join('\n\n')}\n`;
  return input.flatten === true ? flattenCssVariables(css) : css;
}

/**
 * 扁平化 CSS 自定义属性
 *
 * 从 `:root { --x: v; }` 收集变量表，把所有 `var(--x)` / `var(--x, fallback)`
 * 引用替换为字面值（支持变量值互相引用，迭代至无 var 残留），删除 `:root` 块。
 * 用于导出路径的老引擎兼容（见 BuildBookCssOptions.flatten）。
 */
export function flattenCssVariables(css: string): string {
  const rootMatch = /:root\s*\{([^}]*)\}/.exec(css);
  if (rootMatch === null) return css;
  const vars = new Map<string, string>();
  for (const line of (rootMatch[1] ?? '').split(';')) {
    const m = /^\s*(--[\w-]+)\s*:\s*(.*?)\s*$/.exec(line);
    if (m?.[1] !== undefined && m[2] !== undefined) vars.set(m[1], m[2]);
  }
  if (vars.size === 0) return css.replace(rootMatch[0], '').replace(/\n{3,}/g, '\n\n');

  const withoutRoot = css.replace(rootMatch[0], '').replace(/\n{3,}/g, '\n\n');
  /* 迭代替换：变量值可能引用其他变量（迭代上限防环） */
  let result = withoutRoot;
  for (let round = 0; round < 5; round += 1) {
    if (!result.includes('var(')) break;
    result = result.replace(/var\((--[\w-]+)(?:\s*,\s*([^()]*))?\)/g, (_full, name: string, fallback?: string) => {
      const value = vars.get(name);
      if (value !== undefined) return value;
      /* fallback 可能是另一个 var(...)：保留形态交由下一轮解析 */
      return fallback !== undefined ? fallback.trim() : '';
    });
  }
  return result;
}
