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
import { buildCjkTypographyCss } from '@bibliotype/typography-cjk';
import { combineUprightCss } from '../combine-upright.js';
import type { LayoutOptions } from '../layout-options.js';
import { WRITING_MODES } from '../writing-mode.js';
import { buildCssVariables, resolvePageCrossSize, resolvePageMainSize, type StyleDeclaration } from '../style-builder.js';
import { isVerticalMode } from '../writing-mode.js';
import { isFacsimileEnabled } from '../facsimile.js';
import { resolveFacsimileCssVariables, resolveLinePitch } from '../facsimile-geometry.js';
import { buildFeatureCss } from './feature-selectors.js';
import { buildFacsimileDecorationCss } from './facsimile-frame-css.js';
import { buildFacsimileGridCss } from './facsimile-grid-css.js';
import { HEADING_LEVEL_SCALES } from './heading-scales.js';

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
  /**
   * 单色模式（v2 批 6，默认 false）
   *
   * true 时跳过套印墨色规则（`data-ink` 色层）——批注 / 圈点回归全墨
   * （继承正文色），用于单色印刷交付。
   */
  monoInk?: boolean;
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
  /**
   * 是否输出古籍仿真装饰图层（版框 / 界行 / 版心，默认 `false`）
   *
   * 只有「固定分页渲染路径」显式开启：阅读视图 `BtBookView`、编辑分页
   * `PagedCanvas`、打印 `paged` 模式。EPUB（reflow）、连续编辑画布、
   * 量尺表一律不开启——且还须布局里真的带 `facsimile`（双闸门），
   * 因此「现代横排 / 古籍直排」的产物逐字符不变。
   */
  pageDecoration?: boolean;
  /**
   * 装饰图层的挂载选择器（缺省同 `containerSelector`）
   *
   * 打印稿的书册根规则挂在 `body`（页面盒由 `buildPrintCss` 的 `.bt-page` 承担），
   * 而版框 / 界行必须逐页绘制，故打印路径单独传 `.bt-page`——既不改既有根规则，
   * 又保证装饰落在每一页上。
   */
  decorationSelector?: string;
  /**
   * CJK 排印可选能力开关（缺省全关）
   *
   * 声明值来自 `@bibliotype/typography-cjk` 的 `buildCjkTypographyCss`。
   * 缺省不输出任何可选声明——既有产物的字符级稳定由基线快照守护；
   * 基础禁则兜底（line-break / word-break / overflow-wrap）不受本开关控制，
   * 恒在根容器规则输出。
   */
  cjkTypography?: CjkTypographySwitches;
}

/** CJK 排印可选能力（CSS Text 4 系，旧引擎忽略即退化为不启用，不会报错） */
export interface CjkTypographySwitches {
  /** 标点挤压：输出 `text-spacing-trim: space-first` */
  punctuationCompression?: boolean;
  /** 中西文混排间距：输出 `text-autospace: normal` */
  mixedSpacing?: boolean;
  /** 行首行尾标点悬挂：输出 `hanging-punctuation: first last` */
  hangingPunctuation?: boolean;
}

/** 生成书册基础样式表（变量层 + 根容器规则 + 节点类样式） */
export function buildBookCss(input: BuildBookCssOptions): string {
  const { tokens, options } = input;
  const fontToken = input.fontToken ?? FONT_TOKENS.BODY;
  const containerSelector = input.containerSelector ?? 'body';
  const vertical = isVerticalMode(options.writingMode);
  /* 仿真行款网格：装饰 / 网格对齐 / 根行高绝对化共用的三重闸门
   * （pageDecoration 由分页渲染路径显式开启 + 布局带 facsimile + 直排） */
  const facsimileGrid =
    input.pageDecoration === true && isFacsimileEnabled(options) && vertical;

  /*
   * 图片按版心物理宽高限幅：EPUB 原图常远大于版心（扫描件可达上千 px），
   * 仅给 `max-width: 100%` 时主轴方向仍按原图撑开（直排下替换元素的百分比
   * 还与书写方向转置），而图片块不可拆 → 空页强制放入后越出版心 / 纸面。
   * 上下限写死为版心尺寸（px），量尺与渲染共用本样式，实测尺寸随之收敛。
   */
  const pageMain = resolvePageMainSize(options, tokens);
  const pageCross = resolvePageCrossSize(options, tokens);
  const imageMaxWidth = Math.max(1, Math.round(vertical ? pageMain : pageCross));
  const imageMaxHeight = Math.max(1, Math.round(vertical ? pageCross : pageMain));

  const rules: string[] = [];

  /* ---------- 1. 变量层：--bt-* ---------- */
  const variables = buildCssVariables(tokens);
  /*
   * 古籍仿真几何变量（列距 / 图层内缩 / 版心带宽）只在「启用 + 直排」时并入
   * 变量层；未启用时 `:root` 变量表与改造前逐字符一致（隔离矩阵第 5 条），
   * 横排即便误带 facsimile 也不产出仿真变量（仿真版式只在直排下成立）。
   */
  if (facsimileGrid) {
    Object.assign(variables, resolveFacsimileCssVariables(options, tokens));
  }
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
    /* 两端对齐（书排惯例）：中文正文逐字均匀分布、左右缘齐版心；不影响
     * 换行点与行数（justify 只在行内分配空隙），分页几何不变。
     * 仅横排启用：直排行内流里断列标记（bt-vbreak）留下的短列是容器的
     * 「中间行」，justify 会把它拉伸到整列高——字距脱界行网格，古籍
     * 仿真的逐字对齐被破坏；直排保持自然列高。 */
    ...(vertical ? {} : { 'text-align': 'justify' }),
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
  /*
   * 行款网格（仿真直排）：根行高绝对化为列距 px——倍数行高按各后代自身
   * 字号重算行盒厚度，注文小字等行随之偏离界行节距；与预览页框 inline
   * （buildRootStyle）同值，打印 paged 与屏幕逐字一致。
   */
  if (facsimileGrid) {
    body['line-height'] = `${resolveLinePitch(tokens)}px`;
  }
  /*
   * CJK 禁则兜底（@bibliotype/typography-cjk 声明层接线）：
   * - line-break: strict —— 避头尾的浏览器侧兜底，横排 / 直排都输出；
   * - word-break: normal —— 防宿主样式 break-all 污染书册断行；
   * - overflow-wrap: break-word —— 收编全书一处（原散落在 .bt-code-block，
   *   该属性可继承，根容器声明后代码块行为不变）。
   * 可选能力（text-spacing-trim / text-autospace / hanging-punctuation）经
   * cjkTypography 开关输出，缺省全关。
   */
  Object.assign(body, buildCjkTypographyCss(input.cjkTypography));
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
  /* margin 显式化：UA 对 h1~h6 的缺省外边距逐级不同且跨引擎不一致——
   * 分页推进量（估算路径 blockSpacing / 打印稿）与真实渲染因此漂移；
   * 取 UA h2 量级作全书统一值，视觉接近既有形态且跨引擎确定 */
  margin: 0.83em 0;
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
/*
 * 行款属性降级（直排 v2 批 4：横排 / EPUB / 流式导出的低格呈现）
 *
 * 直排行内流把低格渲染为段首空位盒（批 2）；非直排路径（横排 / EPUB reflow /
 * 打印 auto）按 IR attrs 的 data-* 属性降级为首行缩进：indent 1~4 枚举输出，
 * 挪抬（data-lift='space'）在**无低格并存**时补 1em（并存时 space 被吸收——
 * 敬语段不设低格的排版惯例，与直排行内流的相加口径差异记录于 docs/03）。
 * 属性选择器特异性 (0,2,0) 高于 .bt-paragraph 令牌规则 (0,1,0)——低格覆盖
 * 令牌缩进 ✓；无行款属性的段落不受影响（EPUB 老引擎 flatten 路径不含 var()，
 * 老引擎忽略属性规则时退化为令牌缩进，安全降级）。
 */
${[1, 2, 3, 4]
  .map(
    (n) =>
      `${scoped(`.bt-paragraph[data-indent='${n}']`)} {\n  text-indent: ${n}em;\n}\n${scoped(`.bt-quote[data-indent='${n}']`)} {\n  text-indent: ${n}em;\n}`,
  )
  .join('\n')}
${scoped(".bt-paragraph[data-lift='space']:not([data-indent])")},
${scoped(".bt-quote[data-lift='space']:not([data-indent])")} {
  text-indent: 1em;
}
/*
 * 跨页续排片段顶格（与序列化器 data-continued 配套）：块按行拆分跨页后，
 * 后继片段是同一句话的中段——首行缩进（令牌 / 低格 / 挪抬）都属于原段
 * 首行，续片一律顶格；带缩进渲染还会让片段实际行数超过分页记账
 * （页底空行带 / 末行裁切）。两条规则分别压过令牌规则 (0,1,0)、
 * data-indent 规则 (0,2,0) 与挪抬规则 (0,3,0)——同特异性靠源序取胜，
 * 故必须排在其后。
 */
${scoped('.bt-paragraph[data-continued]')},
${scoped('.bt-quote[data-continued]')} {
  text-indent: 0;
}
${scoped('.bt-paragraph[data-continued][data-lift]')},
${scoped('.bt-quote[data-continued][data-lift]')} {
  text-indent: 0;
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
  /* 长词溢出换行已收编到根容器规则（该属性可继承，行为不变） */
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
/* 注码：与注文首行同起（序列化器已把 span 注入首个段落内），
 * 用 logical 外边距保证直排下间距落在正确方向 */
${scoped('.bt-note-marker')} {
  margin-inline-end: 0.4em;
  font-size: 0.9em;
  letter-spacing: 0.02em;
}
/* 注文末回跳链接（点击回到正文引用处） */
${scoped('.bt-note-backref')} {
  margin-inline-start: 0.35em;
  font-size: 0.85em;
  text-decoration: none;
  color: var(--bt-${COLOR_TOKENS.NOTE_TEXT});
}
/*
 * 注释激活态（D9）：点击注码 / 回跳时由阅读器加 bt-note-active 类，约 2s 后移除。
 * 进入快、退出慢（由移除类后的过渡承担），保证「点完知道落在哪」又不长期染色。
 */
${scoped('.bt-note-active')} {
  border-radius: 2px;
  background-color: color-mix(in srgb, var(--bt-${COLOR_TOKENS.ACCENT}) 18%, transparent);
  transition: background-color 200ms ease;
}
${scoped('.bt-mark-noteref.bt-note-active')},
${scoped('.bt-note-marker.bt-note-active')} {
  background-color: color-mix(in srgb, var(--bt-${COLOR_TOKENS.ACCENT}) 32%, transparent);
}
@media (prefers-reduced-motion: reduce) {
  ${scoped('.bt-note-active')} {
    transition: none;
  }
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
/* 单元格对齐：序列化器输出 data-align（不写废弃的 align 属性） */
${scoped(".bt-table-cell[data-align='center']")} {
  text-align: center;
}
${scoped(".bt-table-cell[data-align='right']")} {
  text-align: right;
}
${scoped(".bt-table-cell[data-align='left']")} {
  text-align: left;
}
/* 表头行：<thead> 内单元格为 th，缺少 UA 样式时仍保持加粗 / 底色 */
${scoped('.bt-table-row[data-header="true"]')} {
  font-weight: 600;
  /* 老引擎兜底 + color-mix（与注记边框同一策略） */
  background: #f3f2ef;
  background: color-mix(in srgb, var(--bt-${COLOR_TOKENS.NOTE_TEXT}) 8%, transparent);
}
${scoped('.bt-image')} {
  /* 块级化：消除行盒基线留白（inline 图片会使行盒高于图片本身，页底虚增一行） */
  display: block;
  margin-inline: auto;
  max-width: ${imageMaxWidth}px;
  max-height: ${imageMaxHeight}px;
}
/*
 * 插图版式（v2 批 7，§4）：整幅独占版心宽 / 半幅居中；嵌入（缺省）走基础
 * 限幅。上图下文 / 左图右文 / 双面连式等复合版式由结构层承担（两截本
 * bands / 对页），data-layout 由 image attrs 透传。
 */
${scoped(".bt-image[data-layout='full-width']")} {
  inline-size: 100%;
  object-fit: contain;
}
${scoped(".bt-image[data-layout='half-width']")} {
  inline-size: 50%;
  object-fit: contain;
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
/* 分栏符：多栏正文流里强制另起一栏；单栏时 break-before 不生效，退化为细分隔标记 */
${scoped(".bt-break[data-variant='column']")} {
  border: 0;
  border-inline-start: 1px dashed #999999;
  break-before: column;
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
/* ---------- 修订标记（C5）：插入 / 删除 / 格式变更 ---------- */
${scoped('.bt-mark-insertion')} {
  text-decoration: underline;
  text-decoration-color: #2f6b4f;
  text-underline-offset: 0.18em;
}
${scoped('.bt-mark-deletion')} {
  text-decoration: line-through;
  text-decoration-color: #a33a2a;
  color: #8a8073;
}
${scoped('.bt-mark-format-change')} {
  text-decoration: underline;
  text-decoration-style: dashed;
  text-decoration-color: #b07a21;
  text-underline-offset: 0.18em;
}
${scoped('.bt-mark-link')} {
  color: var(--bt-${COLOR_TOKENS.ACCENT});
}
/* 目录条目上的链接只是跳转载体：跟随目录版式（居中 / 层级字号），不另加颜色与下划线 */
${scoped('.bt-toc .bt-mark-link')} {
  color: inherit;
  text-decoration: none;
}
/* 注引用：正文上标，跟随文字颜色（不做成蓝色链接）；直排下 super 会落到字符上方一侧 */
${scoped('.bt-mark-noteref')} {
  font-size: 0.75em;
  line-height: 0;
  vertical-align: super;
  text-decoration: none;
  color: inherit;
}
${scoped('.bt-math-block')} {
  margin: 1em 0;
  text-align: center;
}
${scoped('ruby > rt')} {
  font-size: 0.5em;
  /* 注文行盒不继承正文大行距：否则注音行被撑高数倍，均高估算与实测行盒都失真 */
  line-height: 1.2;
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
 * 序列化器对无元素子节点的古典型容器（head-note / collation-note /
 * imprint / colophon）以 span 兜底，块级语义在此经 display: block 修正。
 * 双行夹注（double-note）已**行内化**（v2 批 1）：随文落在段落内，
 * 横排以括注随文呈现（古籍点校整理规范），直排列内双行连排属批 2
 * （列盒渲染器）；墨钉（ink-nail）为 1em 占位黑块。
 * 编辑保存后容器内直挂文本会规范化为「容器 + 段落」，故另以规则让
 * 容器内段落显式继承（text-indent 为继承属性）：直挂文本形态直接继承
 * 根容器的计算值（如 2em@16px＝32px），而段落形态若走基础 .bt-paragraph
 * 规则会按注文自身较小字号重算 em（2em@11.5px≈23px），故用 inherit
 * 锁定容器继承链上的同一计算值，保证两种形态首行缩进与换行一致
 * （reader 分块规则同步：见 @bibliotype/reader 的 TEXT_CONTAINER_TYPES）。
 */
${scoped('.bt-double-note')} {
  font-size: 0.72em;
  color: var(--bt-${COLOR_TOKENS.NOTE_TEXT});
}
/* 横排括注随文：夹注首尾括号（直排批 2 改列内双行时由列盒层接管） */
${scoped('.bt-double-note::before')} {
  content: '（';
}
${scoped('.bt-double-note::after')} {
  content: '）';
}
/* 墨钉：未定字的占位黑块（1em 实心方，颜色随墨色） */
${scoped('.bt-ink-nail')} {
  display: inline-block;
  width: 1em;
  height: 1em;
  background: currentColor;
  vertical-align: -0.15em;
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
${scoped('.bt-general-review')} {
  /* 卷末总评（v2 批 6）：与跋语并列的结构部件——多段总评文字以分隔线起首 */
  display: block;
  margin: 1.4em 0 0.6em;
  padding-block-start: 0.6em;
  border-block-start: 1px solid #9a9488;
  border-block-start: 1px solid color-mix(in srgb, var(--bt-${COLOR_TOKENS.NOTE_TEXT}) 35%, transparent);
  font-size: 0.85em;
  color: var(--bt-${COLOR_TOKENS.NOTE_TEXT});
}
/*
 * 套印墨色（v2 批 6）：注 / 批类节点带 data-ink 属性时按色层着色
 * （朱墨套印——批注圈点用朱，可扩蓝黄多评家分色）。单色模式（monoInk）
 * 跳过本段即回归全墨；色值走主题可覆盖变量（--bt-ink-*）。
 */
${
  input.monoInk === true
    ? ''
    : [
        ['red', '#a33a2a'],
        ['blue', '#2f5a8f'],
        ['yellow', '#8a6d1f'],
      ]
        .map(
          ([color, fallback]) =>
            `${scoped(`[data-ink='${color}']`)} {\n  color: var(--bt-ink-${color}, ${fallback});\n}`,
        )
        .join('\n')
}
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
/* 索引词：点线下标，阅读态可见但不打断行款（打印可选中隐藏，由导出侧决定） */
${scoped('.bt-mark-index-term')} {
  text-decoration: underline dotted;
  text-underline-offset: 3px;
}
${scoped('.bt-variant-char')} {
  text-decoration: underline dotted;
  text-underline-offset: 3px;
}
${scoped('.bt-seal')} {
  display: inline-block;
  line-height: 1;
}
/*
 * 缺字合成字形（K6）：IDS 拼出的方框字按 1em 内联，与正文基线略下沉对齐；
 * SVG 用 currentColor，换主题不需要额外颜色规则。
 */
${scoped('.bt-glyph')} {
  display: inline-block;
  width: 1em;
  height: 1em;
  vertical-align: -0.15em;
}
${scoped('.bt-glyph > svg')} {
  display: block;
  width: 100%;
  height: 100%;
}
/*
 * 行内字图（K6）：缺字替代图按一字位内联，硬限幅 1em——原图再大也不超
 * 两侧文字的高 / 宽；object-fit 防非方形图变形；基线口径与 .bt-glyph 同款。
 */
${scoped('.bt-glyph-image')} {
  display: inline-block;
  width: 1em;
  height: 1em;
  max-width: 1em;
  max-height: 1em;
  object-fit: contain;
  vertical-align: -0.15em;
}
/* 内联 SVG 印谱：随字号缩放，基线下沉一点与正文对齐 */
${scoped('.bt-seal > svg')} {
  display: block;
  width: 1.6em;
  height: 1.6em;
}
/* 兜底（EPUB2 / 关闭 SVG）：空载体回退为文字方框印章 */
${scoped('.bt-seal:empty')} {
  padding: 0.1em 0.3em;
  border: 1px solid currentColor;
  border-radius: 2px;
}
${scoped('.bt-seal:empty::after')} {
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
 * 句读候选（K3）：标记包裹候选标点前的字，伪元素显示淡色候选符号。
 * 采纳为标点后标记被移除，正文只留真实字符；导出未采纳的文档时该伪元素
 * 仍会画出淡色符号，提示「建议尚未处理」。
 */
${scoped('.bt-mark-judou')}::after {
  content: attr(data-symbol);
  color: var(--bt-${COLOR_TOKENS.ACCENT});
  opacity: 0.55;
  font-weight: 400;
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
/*
 * 圈点双位（v2 批 6，§11.4）：句读标记居字右下（缺省，见基础规则
 * text-emphasis-position: under right）；文法符号（密圈 / 密点 / 抹）居字右
 * （直排惯行）——两类符号各安其位、不争空间。data-position 由 mark attrs
 * 透传（编辑侧 setMarkAttrs('circle-emphasis', { position: 'grammar' })）。
 * 直排下 over / under 被忽略、right 关键字生效：基础规则已满足「文法居字右」；
 * 横排无「居字右」位（合法关键字仅 over / under × right / left 组合），故
 * data-position='grammar' 不再单列声明——曾写的双关键字组合含非法关键字
 * （center 不是本属性的合法值），所有浏览器整条丢弃（行为上从未生效），
 * 删除并在此记录语义边界。
 */
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

/* ---------- 7. 页脚页码（横排居中于页面物理底部；直排移到页侧竖排显示） ---------- */
${
  vertical
    ? /* 直排：右起（vertical-rl）页码竖排于**左侧**、左起（vertical-lr）于**右侧**
       * ——古籍书面叶次随排文方向走，不占版心下缘。字形直立向下读，
       * 沿页面中线垂直居中；位于页边距内，不与末列争位。 */
      `${scoped('.bt-page-number')} {
  position: absolute;
  top: 0;
  bottom: 0;
  ${options.writingMode === WRITING_MODES.VERTICAL_LR ? 'right' : 'left'}: 16px;
  writing-mode: vertical-rl;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75em;
  letter-spacing: 0.15em;
  color: var(--bt-${COLOR_TOKENS.NOTE_TEXT});
}`
    : `${scoped('.bt-page-number')} {
  position: absolute;
  bottom: 16px;
  left: 0;
  right: 0;
  writing-mode: horizontal-tb;
  text-align: center;
  font-size: 0.75em;
  letter-spacing: 0.15em;
  color: var(--bt-${COLOR_TOKENS.NOTE_TEXT});
}`
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

  /*
   * ---------- 7.5 页底注区（footnote area） ----------
   *
   * 注区排在版心底部、与正文等宽；首条以分隔线与正文隔开。注文沿用 .bt-footnote
   * 等既有类（字号 / 行距由 §6 控制），此处只管容器与续注标记。直排下注区沿列宽
   * 收束、分隔线落在注区上缘（logical 边界），故全部用 logical 属性。
   */
  rules.push(
    `/* ---------- 页底注区（footnote area） ---------- */
${scoped('.bt-page-notes')} {
  margin-block-start: 0.8em;
  padding-block-start: 0.5em;
  border-block-start: 1px solid color-mix(in srgb, var(--bt-${COLOR_TOKENS.NOTE_TEXT}) 40%, transparent);
  font-size: var(--bt-${FONT_SIZE_TOKENS.NOTE});
  line-height: 1.5;
}
${scoped('.bt-page-notes--overflow')} {
  /* 注区超上限：仅标记，截断交回分页器；可见告警便于宿主排查 */
  box-shadow: inset 0 2px 0 color-mix(in srgb, var(--bt-${COLOR_TOKENS.NOTE_TEXT}) 70%, transparent);
}
${scoped('.bt-page-note')} {
  margin: 0.3em 0;
  text-indent: 0;
}
${scoped('.bt-page-note')} > .bt-footnote,
${scoped('.bt-page-note')} > .bt-endnote,
${scoped('.bt-page-note')} > .bt-margin-note {
  margin: 0;
  padding-block-start: 0;
  border-block-start: 0;
}
${scoped('.bt-note-continued')} {
  font-size: 0.85em;
  color: var(--bt-${COLOR_TOKENS.NOTE_TEXT});
  opacity: 0.7;
  letter-spacing: 0.05em;
}
${scoped('.bt-note-continued--prev')} {
  text-align: end;
}`,
  );

  /* ---------- 8. 专名号：横排标于字下 / 直排标于字左（GB 古籍整理规范） ---------- */
  rules.push(
    vertical
      ? `${scoped('.bt-mark-proper-name')} {\n  border-left: 1px solid currentColor;\n  padding-left: 1px;\n}`
      : `${scoped('.bt-mark-proper-name')} {\n  border-bottom: 1px solid currentColor;\n}`,
  );

  /*
   * ---------- 9. 古籍仿真装饰（版框 / 界行 / 版心） ----------
   *
   * 双闸门：`pageDecoration` 由分页渲染路径显式开启，且布局里真的带
   * `facsimile` 且为直排；三者缺一即不输出任何字符 —— 「现代横排 /
   * 古籍直排」的样式表因此逐字符不变。
   */
  if (facsimileGrid) {
    const decoration = buildFacsimileDecorationCss({
      options,
      tokens,
      containerSelector: input.decorationSelector ?? containerSelector,
    });
    if (decoration !== '') {
      rules.push(`/* ---------- 古籍仿真装饰（版框 / 界行 / 版心） ---------- */\n${decoration}`);
    }
    /*
     * ---------- 9.5 行款网格对齐（界行与文字列咬合） ----------
     *
     * 界行是静态定距网格，本层把行盒厚度与块轴间距修正为列距的整数倍
     * （标题 / 双行小注 / 注区 / 引文等，见 facsimile-grid-css）。放在
     * 用户覆盖层（§10）之前——功能样式与命名样式仍可按需覆盖。
     */
    const grid = buildFacsimileGridCss({ options, tokens, containerSelector });
    if (grid !== '') {
      rules.push(grid);
    }
  }

  /*
   * ---------- 9.6 直排行内流（连排 / 低格 / 抬头 / 双行夹注） ----------
   *
   * 直排（古籍直排 + 仿真）下页内容以行内流连排（serializeVerticalFlow
   * 产物）：段落行内化（.bt-vpara）、夹注为「1 大字位宽的双列小字盒」
   * （.bt-vnote）、提行 / 平抬断列（br.bt-vbreak）、抬升列首空位
   * （.bt-vpad）。容器 .bt-vflow 的行盒厚度由根行高（= 列距）决定，
   * 列与界行网格天然咬合。横排不输出（产物逐字符不变）。
   */
  if (vertical) {
    rules.push(
      `/* ---------- 直排行内流（连排 / 低格 / 抬头 / 双行夹注） ---------- */
${scoped('.bt-vflow')} {
  /* 连排容器：行内流自然换列；白空间折叠避免片段衔接出缝 */
  white-space: normal;
}
${scoped('.bt-vpara')} {
  display: inline;
}
${scoped('.bt-vflow')} .bt-heading {
  /* 章题随文连排（古籍形制：另起一列顶格、题后同列接排正文）：
   * - display: inline —— 块级呈现会让题独占整列，题后正文被迫另起一列，
   *   每道题白扔一整列（满版目标的首要残源）；
   * - margin: 0 —— 块的 0.83em 外边距在直排里落在列宽方向，会撑宽题列；
   * - line-height 锁列距 —— 继承的倍数行高按 2em 字号重算（1.9em×2 =
   *   60.8px = 两列），一列被撑成两列、界行网格逐列错位。锁死后行盒恒
   *   1 列，2em 字形左右各出边 0.8px（可接受，网格不错位）。
   * 用后代选择器（非直接子代）：编辑画布把每个片段包在 .bt-paged-frag 里，
   * 题盒与容器之间多一层，直接子代匹配不中。 */
  display: inline;
  margin: 0;
  line-height: ${resolveLinePitch(tokens)}px;
}
/* 页首断列标记：页流本身已从列首起排（分页器的 breakColumn 在空页上
 * 也不占列），再断一次会白扔一整列。量尺表里因块包装器 display:contents
 * 包住标记而不命中——相对测量不受首列空置影响。 */
.bt-reader-page__flow > .bt-vbreak:first-child,
.bt-page__flow > .bt-vbreak:first-child {
  display: none;
}
${scoped('.bt-vnote')} {
  /* 双行夹注盒：恒 1 大字位宽 × 动态高度的多对双列小字（「从上排到底」
   * 的古籍形制）。竖排逻辑轴：inline 轴 = 纵向（列高）、block 轴 = 横向
   * （列宽方向）——block-size: 1em 即 1 大字位宽（对内两小列各半），
   * inline-size 收缩为内容高（多对时由各对子列内容撑出，auto 即随文）；
   * 内部多个 block 子列沿块轴自右向左并列（DOM 序即阅读序）。小字步进
   * 取自身 1em（= 半个大字位，与容量口径 charsPerColumn×2 = 版心高÷大字
   * 字位×2 严格互逆），n 字占 ceil(n/2) 字位高。
   * 已知限制：夹注盒为原子 inline-block，列中剩余高度不足时整体推到下一
   * 列（前列底部留白）——纯 CSS 双轨道随文断列不可行，行中起注由注首
   * 低一格（indentFirstPair）标记语义。 */
  display: inline-block;
  vertical-align: top;
  block-size: 1em;
  inline-size: auto;
  writing-mode: vertical-rl;
}
${scoped('.bt-vnote-col')} {
  display: block;
  /* 单小列厚度 = 半个大字位：自身字号 0.5em（正文之半）下的 1em，
   * 两列合计恰为 .bt-vnote 的 1 大字位宽 */
  block-size: 1em;
  font-size: 0.5em;
  /* 小字沿列步进取自身 1em（无额外字距）——容量口径按「版心高 ÷ 大字
   * 字号 × 2」折算，小字步进必须恰为半个大字位；曾用的
   * calc(var(--bt-vnote-pitch)/2 - 0.5em) 依赖从未定义的 --bt-vnote-pitch
   * （恒走 2em 回退，步进超量 47%，尾部被裁）。溢出保持可见：若容量口径
   * 与实渲漂移宁可露出，不做静默裁字。 */
  letter-spacing: 0;
}
${scoped('.bt-vpad')} {
  /* 空位盒：低格 / 挪抬的列首空位与抬升列首——沿 inline 轴（直排纵向）
   * 占 N 个字位步进、沿 block 轴占 1 字位厚度（与正文字同宽，不撑行盒）。
   * 字位步进 = 自身 1em + 全局字距（与正文字逐字步进同式，曾把 inline /
   * block 两轴写反且用 1lh 当字位——列距 ≠ 字位，低格一格被放大成 1.5+ 字位）。 */
  display: inline-block;
  inline-size: calc(var(--bt-vpad-n, 1) * (1em + var(--bt-${LAYOUT_TOKENS.LETTER_SPACING}, 0em)));
  block-size: 1em;
}
${scoped(`.bt-vpad[data-n='1']`)} { --bt-vpad-n: 1; }
${scoped(`.bt-vpad[data-n='2']`)} { --bt-vpad-n: 2; }
${scoped(`.bt-vpad[data-n='3']`)} { --bt-vpad-n: 3; }
${scoped(`.bt-vpad[data-n='4']`)} { --bt-vpad-n: 4; }`,
    );
  }

  /*
   * ---------- 10. 用户覆盖：功能样式 + 命名样式 ----------
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
 * 引用替换为字面值，删除 `:root` 块。用于导出路径的老引擎兼容（见
 * BuildBookCssOptions.flatten）。
 *
 * 实现：`var(` 的实际参数以「配平括号」取到匹配右括号（回退值可含
 * `calc(1em + 2px)` 这类带括号函数——曾用 `[^()]*` 量化的正则匹配不到
 * 带括号回退，整条 `var(` 原样残留，老引擎把整条声明丢弃，恰违背本
 * 功能的初衷）；变量值互相引用与嵌套回退经递归解析（深度上限防环）。
 */
export function flattenCssVariables(css: string): string {
  const rootMatch = /:root\s*\{([^}]*)\}/.exec(css);
  if (rootMatch === null) return css;
  const vars = parseRootVariables(rootMatch[1] ?? '');
  const withoutRoot = css.replace(rootMatch[0], '').replace(/\n{3,}/g, '\n\n');
  if (vars.size === 0) return withoutRoot;
  return replaceVarReferences(withoutRoot, vars, 0);
}

/** 递归深度上限（变量互引 / 嵌套回退的环保护） */
const FLATTEN_MAX_DEPTH = 8;

/** 按「括号深度 0 的分号」切分声明，产出 `名 → 值` 表（值可含括号函数） */
function parseRootVariables(body: string): Map<string, string> {
  const vars = new Map<string, string>();
  let depth = 0;
  let start = 0;
  for (let i = 0; i <= body.length; i += 1) {
    const char = i < body.length ? body[i] : ';';
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    else if (char === ';' && depth <= 0) {
      const declaration = body.slice(start, i);
      const m = /^\s*(--[\w-]+)\s*:\s*([\s\S]*?)\s*$/.exec(declaration);
      if (m?.[1] !== undefined && m[2] !== undefined) vars.set(m[1], m[2]);
      start = i + 1;
    }
  }
  return vars;
}

/**
 * 替换文本中全部 `var(...)` 引用
 *
 * 每个 `var(` 以括号配平取实际参数；顶层逗号切分变量名与回退值。
 * 命中变量表 → 递归解析变量值（值可再引用变量）；未命中但有回退 →
 * 递归解析回退（回退可嵌套 `var(...)` 或含括号函数）；都无 → 空串
 * （与 CSS 无效变量的计算值语义一致）。超过深度上限保留原样（环保护）。
 */
function replaceVarReferences(text: string, vars: Map<string, string>, depth: number): string {
  if (depth > FLATTEN_MAX_DEPTH || !text.includes('var(')) return text;
  let result = '';
  let cursor = 0;
  for (;;) {
    const open = text.indexOf('var(', cursor);
    if (open === -1) {
      result += text.slice(cursor);
      break;
    }
    const close = matchingParen(text, open + 3);
    if (close === -1) {
      /* 括号不配平（截断的产物）：原样保留并跳过 */
      result += text.slice(cursor, open + 4);
      cursor = open + 4;
      continue;
    }
    result += text.slice(cursor, open);
    const inner = text.slice(open + 4, close);
    const comma = topLevelComma(inner);
    const name = (comma === -1 ? inner : inner.slice(0, comma)).trim();
    const fallback = comma === -1 ? undefined : inner.slice(comma + 1).trim();
    const value = vars.get(name);
    if (value !== undefined) {
      result += replaceVarReferences(value, vars, depth + 1);
    } else if (fallback !== undefined) {
      result += replaceVarReferences(fallback, vars, depth + 1);
    }
    cursor = close + 1;
  }
  return result;
}

/** 取与 start 位置左括号配平的右括号下标（无配平返回 -1） */
function matchingParen(text: string, start: number): number {
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** 顶层（括号深度 0）第一个逗号的下标（无则 -1） */
function topLevelComma(text: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') depth -= 1;
    else if (text[i] === ',' && depth === 0) return i;
  }
  return -1;
}
