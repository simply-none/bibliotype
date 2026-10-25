/**
 * 古籍仿真直排的行款网格对齐层
 *
 * 界行（见 `facsimile-frame-css`）是**静态定距网格**：从版心右缘起每隔
 * 「字号 × 行距」（`resolveLinePitch`）画一条线。文字列要落在界行之间，
 * 必须保证**每个行盒的块轴厚度与所有块轴间距都是列距的整数倍**——而基础
 * 样式天然破坏该不变量：倍数行高会按各后代自身字号重算行盒厚度、双行
 * 小注的多栏块宽不是整格、引文 / 眉批等的块轴（直排下为左右）外距 / 边框
 * 任意宽。任何一处破坏都会让后续所有列相对界行永久错相（文字骑线）。
 *
 * 本层在仿真直排时逐类修正（根行高的绝对化由 `style-builder` /
 * `book-css` 的根规则承担，未显式设行高的后代自动落格）：
 * - 显式行高的类（标题 / 代码块 / 注区）归一到列距；字号大于列距的
 *   （标题分级、封面 / 书名页大字）在构建期按「字号 ÷ 列距」向上取整 k，
 *   落到 k × 列距；
 * - 双行夹注已行内化（v2 批 1）：随文落在段落内、行盒继承根行高（px 列距）
 *   天然落格；列内双行（小字半号、n 字占 n/2 字位）由批 2 列盒渲染器承担；
 * - 块轴装饰归零（引文 / 眉批 / 牌记 / 题跋 / 注区的左右 margin /
 *   padding / border），行内轴（上下）的间距与配色保留。
 *
 * 与装饰层同一闸门（`pageDecoration && facsimile && 直排`），由 `book-css`
 * 在用户覆盖层之前调用——用户功能样式仍可覆盖本层。纯函数、构建期算值，
 * 不依赖 CSS 运行时分支；表格 / 插图等非文本块不强制落格（已知限制，
 * 见 docs/22「界行对齐」一节）。
 */
import { FONT_SIZE_TOKENS } from '@bibliotype/core';
import type { LayoutOptions } from '../layout-options.js';
import { resolveLinePitch } from '../facsimile-geometry.js';
import { HEADING_LEVEL_SCALES } from './heading-scales.js';

/** 网格对齐层输入 */
export interface BuildFacsimileGridCssOptions {
  /** 布局选项（须已确认启用仿真版式且为直排） */
  options: LayoutOptions;
  /** 主题令牌值表（取正文字号与标题字号折算落格行高） */
  tokens: Readonly<Record<string, string | undefined>>;
  /** 根容器选择器（页面元素，如 `.bt-reader-page`） */
  containerSelector: string;
}

/** 保留两位小数（与 facsimile-geometry 的 round2 同口径，避免浮点尾差进 CSS） */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * 令牌字号 → px（em / 纯数字按正文字号折算，px 原样；无法解析回退正文字号）
 *
 * `font-size-heading` 缺省是 `1.75em` 这类相对值，落格计算须先折到与列距
 * 同一量纲。
 */
function resolveFontSizePx(
  value: string | undefined,
  bodyPx: number,
): number {
  const raw = (value ?? '').trim();
  if (raw === '') return bodyPx;
  const em = /^(\d+(?:\.\d+)?)em$/.exec(raw);
  if (em !== null) return bodyPx * Number(em[1]);
  const px = /^(\d+(?:\.\d+)?)px$/.exec(raw);
  if (px !== null) return Number(px[1]);
  const plain = Number.parseFloat(raw);
  return Number.isFinite(plain) ? bodyPx * plain : bodyPx;
}

/** 正文字号（px，令牌缺失回退 16 与几何层兜底一致） */
function resolveBodyPx(tokens: Readonly<Record<string, string | undefined>>): number {
  const raw = (tokens[FONT_SIZE_TOKENS.BODY] ?? '').trim();
  const match = /^(\d+(?:\.\d+)?)px$/.exec(raw);
  return match === null ? 16 : Number(match[1]);
}

/**
 * 字号 → 落格行高：k × 列距（k = ⌈字号 ÷ 列距⌉，至少 1；浮点容差防
 * 「恰等于列距」被误进位，如汲古阁本标题 35px 对列距 34px 应落 2 格）
 */
function gridLineHeight(fontPx: number, pitch: number): number {
  const k = Math.max(1, Math.ceil(fontPx / pitch - 1e-6));
  return round2(k * pitch);
}

/**
 * 生成行款网格对齐层样式
 *
 * @returns CSS 文本（scoped 到容器内）；列距非正时返回空串（防御，正常
 *   不会发生——`resolveLinePitch` 恒为正）。
 */
export function buildFacsimileGridCss(input: BuildFacsimileGridCssOptions): string {
  const { tokens, containerSelector } = input;
  const scoped = (selector: string): string => `${containerSelector} ${selector}`;

  const pitch = resolveLinePitch(tokens);
  if (!(pitch > 0)) return '';
  const bodyPx = resolveBodyPx(tokens);

  const rules: string[] = [];

  /* ---------- 1. 显式行高归格 ---------- */
  /* 标题：行高落格 + 块轴（直排下的左右）外距归零——h1~h6 的 UA
   * margin-block（0.83em）在直排落在水平方向，恰是 ≈0.6 格的隐性漂移源 */
  const headingPx = resolveFontSizePx(tokens[FONT_SIZE_TOKENS.HEADING], bodyPx);
  rules.push(
    `${scoped('.bt-heading')} {\n  line-height: ${gridLineHeight(headingPx, pitch)}px;\n  margin-block: 0;\n}`,
  );
  /* 分级标题：字号超过列距的级别单独落 k 格（未超的继承 .bt-heading 的落格行高） */
  const levelRules = [1, 2, 3, 4, 5, 6]
    .map((level) => {
      const scale = HEADING_LEVEL_SCALES[level] ?? 1;
      const line = gridLineHeight(headingPx * scale, pitch);
      return line > pitch
        ? `${scoped(`h${level}.bt-heading`)} {\n  line-height: ${line}px;\n}`
        : '';
    })
    .filter((rule) => rule !== '');
  if (levelRules.length > 0) rules.push(levelRules.join('\n'));

  rules.push(`${scoped('.bt-code-block')} {\n  line-height: ${pitch}px;\n}`);

  /*
   * 双行夹注已行内化（v2 批 1：随文落在段落内，横排括注随文）——列内
   * 双行（小字 0.5em、n 字占 n/2 字位、右列满高续左列）由批 2 的列盒
   * 渲染器（buildPageColumns + splitDoubleNoteLines）承担，本层不再
   * 输出块级夹注规则；行内夹注的行盒厚度继承根行高（px 列距），天然落格。
   */

  /* 页底注区：行盒归列距；块轴（右缘）的分隔线与占位归零 */
  rules.push(
    `${scoped('.bt-page-notes')} {\n  margin-block-start: 0;\n  padding-block-start: 0;\n  border-block-start: 0;\n  line-height: ${pitch}px;\n}`,
  );

  /* 注音（ruby）注记行高收进字距空隙，避免行盒超过列距 */
  rules.push(`${scoped('ruby > rt')} {\n  line-height: 1;\n}`);

  /* ---------- 2. 块轴（直排下为左右）装饰归零 ---------- */
  rules.push(
    `${scoped('.bt-quote')} {\n  margin: 1em 0;\n}`,
    `${scoped('.bt-head-note')} {\n  margin: 0.45em 0;\n  padding: 0.25em 0;\n  border: 0;\n}`,
    `${scoped('.bt-imprint')} {\n  padding: 0.5em 0;\n  border: 0;\n}`,
    `${scoped('.bt-colophon')} {\n  padding-block-start: 0;\n  border-block-start: 0;\n}`,
    `${scoped('.bt-border-frame')} {\n  border: 0;\n  padding: 0.5em 0;\n}`,
    `${scoped('.bt-footnote')} {\n  padding-block-start: 0;\n  border-block-start: 0;\n}`,
  );

  /* 分隔线的 block-start（右缘）线宽归零：各变体选择器特异性更高，须一并覆盖 */
  rules.push(
    [
      scoped('.bt-break'),
      scoped(".bt-break[data-variant='dashed']"),
      scoped(".bt-break[data-variant='dotted']"),
      scoped(".bt-break[data-variant='double']"),
      scoped(".bt-break[data-variant='page']"),
    ].join(',\n') + ' {\n  border-block-start: 0;\n}',
  );

  /* 表格：单元格块轴内距归零，把漂移压到左右边框 2px（已知限制：表格自身
   * 不参与行款网格） */
  rules.push(`${scoped('.bt-table-cell')} {\n  padding-block: 0;\n}`);

  /* ---------- 3. 结构页大字按 k 格行高（仅超过一格时输出） ---------- */
  const bigRoles: ReadonlyArray<{ attr: string; em: number }> = [
    { attr: 'cover-title', em: 2.8 },
    { attr: 'title-page-title', em: 1.9 },
  ];
  const roleRules = bigRoles
    .map(({ attr, em }) => {
      const line = gridLineHeight(bodyPx * em, pitch);
      return line > pitch
        ? `${scoped(`[data-role='${attr}']`)} {\n  line-height: ${line}px;\n}`
        : '';
    })
    .filter((rule) => rule !== '');
  if (roleRules.length > 0) rules.push(roleRules.join('\n'));

  return `/* 行款网格对齐：行盒厚度与块轴间距恒为列距（${pitch}px）的整数倍，界行与文字列严格咬合 */\n${rules.join('\n\n')}\n`;
}
