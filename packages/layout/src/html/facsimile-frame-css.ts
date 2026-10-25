/**
 * 古籍仿真版式的装饰图层样式（版框 / 界行 / 版心）
 *
 * 设计要点：
 * - **纯装饰**：版框与界行画在页边距内（伪元素 + `--bt-fs-*` 内缩变量），
 *   不侵占版心、不参与分页；只有版心带宽影响主轴（由 style-builder 扣减）；
 * - **作用域隔离**：所有选择器都带调用方传入的容器前缀，禁止全局规则
 *   （避免泄漏到同页的编辑画布，见 docs/14 第 2 条）；
 * - **双闸门**：由 `book-css` 在校验 `pageDecoration` 与 `facsimile` 后才调用，
 *   未启用时本模块不产出任何字符。
 */
import type { LayoutOptions } from '../layout-options.js';
import {
  FACSIMILE_FRAMES,
  FACSIMILE_RULES,
  GUTTER_FISH_TAIL_STYLES,
  GUTTER_MOUTHS,
  type FacsimileOptions,
} from '../facsimile.js';
import {
  resolveFacsimileFrameThickness,
  resolveFacsimileGutterSize,
} from '../facsimile-geometry.js';

/** 装饰图层样式生成输入 */
export interface BuildFacsimileDecorationCssOptions {
  /** 布局选项（须已确认启用仿真版式） */
  options: LayoutOptions;
  /** 主题令牌值表（取版框 / 界行 / 版心颜色） */
  tokens: Readonly<Record<string, string | undefined>>;
  /** 根容器选择器（页面元素，如 `.bt-reader-page`） */
  containerSelector: string;
}

/** 版心口子上下墨条宽度（px）：细黑口 ≈ 细象鼻线；大黑口 ≈ 粗象鼻条（元刻本） */
const MOUTH_BAR_WIDTHS: Readonly<Record<string, number>> = {
  [GUTTER_MOUTHS.BLACK]: 5,
  [GUTTER_MOUTHS.BLACK_WIDE]: 14,
};

/** 默认版框墨色（令牌缺省时的兜底） */
const DEFAULT_FRAME_COLOR = '#3b322a';

/** 版框边框声明（按形态给四边线型；`double` 需 ≥3px 才画出双线） */
function frameBorderDeclarations(
  facsimile: FacsimileOptions,
  thickness: { x: number; y: number },
  color: string,
): string {
  if (facsimile.frame === FACSIMILE_FRAMES.SINGLE) {
    return `  border: ${thickness.y}px solid ${color};`;
  }
  if (facsimile.frame === FACSIMILE_FRAMES.DOUBLE) {
    return `  border: ${thickness.x}px double ${color};`;
  }
  /* left-right：上下单边、左右双边 */
  return [
    `  border-top: ${thickness.y}px solid ${color};`,
    `  border-bottom: ${thickness.y}px solid ${color};`,
    `  border-left: ${thickness.x}px double ${color};`,
    `  border-right: ${thickness.x}px double ${color};`,
  ].join('\n');
}

/**
 * 生成仿真装饰图层样式
 *
 * @returns CSS 文本；未配置版框 / 界行 / 版心时返回空串（调用方按需拼接）。
 */
export function buildFacsimileDecorationCss(
  input: BuildFacsimileDecorationCssOptions,
): string {
  const { options, tokens, containerSelector } = input;
  const facsimile = options.facsimile;
  if (facsimile === undefined) return '';

  const rules: string[] = [];
  const scoped = (selector: string): string => `${containerSelector} ${selector}`;
  const frameColor = `var(--bt-page-frame-color, ${DEFAULT_FRAME_COLOR})`;
  const ruleColor = `var(--bt-page-rule-color, ${DEFAULT_FRAME_COLOR})`;
  const gutterColor = `var(--bt-gutter-color, ${DEFAULT_FRAME_COLOR})`;
  const gutter = facsimile.gutter;
  const gutterSize = resolveFacsimileGutterSize(options);

  /* 绝对定位图层需要有定位祖先（页面元素自身；已有定位时本声明被更高优先级规则覆盖） */
  if (facsimile.frame !== FACSIMILE_FRAMES.NONE || gutterSize > 0) {
    rules.push(`${containerSelector} {\n  position: relative;\n}`);
  }

  /* ---------- 1. 版框（画在页边距内，不侵占版心） ---------- */
  if (facsimile.frame !== FACSIMILE_FRAMES.NONE) {
    const thickness = resolveFacsimileFrameThickness(options, tokens);
    rules.push(
      `${containerSelector}::before {\n  content: '';\n  position: absolute;\n  inset: var(--bt-fs-frame-inset);\n${frameBorderDeclarations(
        facsimile,
        thickness,
        frameColor,
      )}\n  pointer-events: none;\n}`,
    );
  }

  /*
   * ---------- 1.5 纸纹（可选） ----------
   *
   * 令牌 `page-texture` 的值原样作为 `background-image` 使用（渐变 / `url()`
   * 均可），铺在页面元素上、位于正文之下。纯视觉：不改变版心、不进度量签名。
   */
  const texture = (tokens['page-texture'] ?? '').trim();
  if (texture !== '') {
    rules.push(
      `${containerSelector} {\n  background-image: var(--bt-page-texture);\n  background-repeat: repeat;\n}`,
    );
  }

  /* ---------- 2. 界行（节距 = 字号 × 行距，锚定版心起始侧） ---------- */
  if (facsimile.rule !== FACSIMILE_RULES.NONE) {
    rules.push(
      `${containerSelector}::after {\n  content: '';\n  position: absolute;\n  inset: var(--bt-fs-rule-inset);\n  background-image: repeating-linear-gradient(\n    to left,\n    transparent 0 calc(var(--bt-fs-line-pitch) - 1px),\n    ${ruleColor} calc(var(--bt-fs-line-pitch) - 1px) var(--bt-fs-line-pitch)\n  );\n  pointer-events: none;\n}`,
    );
  }

  /* ---------- 3. 版心（书口）：竖向窄带 + 上下文字 + 鱼尾 ---------- */
  if (gutter !== undefined && gutterSize > 0) {
    const mouthBar = MOUTH_BAR_WIDTHS[gutter.mouth];
    const mouthRule =
      mouthBar !== undefined
        ? `  border-top: ${mouthBar}px solid ${gutterColor};\n  border-bottom: ${mouthBar}px solid ${gutterColor};\n`
        : '';
    rules.push(
      `${scoped('.bt-page-gutter')} {\n  position: absolute;\n  top: var(--bt-fs-inset-top);\n  bottom: var(--bt-fs-inset-bottom);\n  width: var(--bt-fs-gutter-size);\n  box-sizing: border-box;\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  justify-content: space-between;\n  padding: 0.35em 0;\n  writing-mode: vertical-rl;\n  font-size: 0.62em;\n  line-height: 1.2;\n  letter-spacing: 0.12em;\n  color: ${gutterColor};\n  overflow: hidden;\n  pointer-events: none;\n${mouthRule}}`,
    );
    rules.push(
      `${scoped(".bt-page-gutter[data-side='left']")} {\n  left: var(--bt-fs-inset-left);\n}\n${scoped(
        ".bt-page-gutter[data-side='right']",
      )} {\n  right: var(--bt-fs-inset-right);\n}`,
    );
    rules.push(
      `${scoped('.bt-page-gutter__field')} {\n  max-height: 8em;\n  overflow: hidden;\n  white-space: nowrap;\n}`,
    );
    if (gutter.fishTail !== 'none') {
      /*
       * 鱼尾（v2 批 5 扩展）：N 尾（1~4）沿版心带**均布**且上下**相向**交替
       * （奇数序尾叉口向下、偶数序尾垂直镜像向上——真实鱼尾的对向形制）；
       * 样式四态：黑（实心，缺省）/ 白（外框描线、内部镂空）/ 线（细线勾形）/
       * 花（花形剪裁）。定位百分比按 N 均分（留出天地余量）。
       */
      const count =
        gutter.fishTail === 'quadruple'
          ? 4
          : gutter.fishTail === 'triple'
            ? 3
            : gutter.fishTail === 'double'
              ? 2
              : 1;
      const style = gutter.fishTailStyle ?? GUTTER_FISH_TAIL_STYLES.BLACK;
      const shapeByStyle: Record<string, string> = {
        black: `  background: ${gutterColor};\n  clip-path: polygon(100% 0, 0 50%, 100% 100%, 100% 66%, 30% 50%, 100% 34%);\n`,
        white: `  background: transparent;\n  border: 1.5px solid ${gutterColor};\n  clip-path: polygon(100% 0, 0 50%, 100% 100%, 100% 66%, 30% 50%, 100% 34%);\n`,
        line: `  background: transparent;\n  border-block-end: 1.5px solid ${gutterColor};\n`,
        floral: `  background: ${gutterColor};\n  clip-path: polygon(50% 0, 68% 18%, 92% 14%, 88% 38%, 100% 50%, 88% 62%, 92% 86%, 68% 82%, 50% 100%, 32% 82%, 8% 86%, 12% 62%, 0 50%, 12% 38%, 8% 14%, 32% 18%);\n`,
      };
      const positionRules = Array.from({ length: count }, (_, index) => {
        /* 均布：把版心带除去两端余量后按 N+1 等分落位；偶数序尾垂直镜像相向 */
        const top = Math.round(((index + 1) * 100) / (count + 1));
        const flip = index % 2 === 1 ? '\n  transform: scaleY(-1);' : '';
        return `${scoped(`.bt-page-gutter__fish:nth-of-type(${index + 1})`)} {\n  top: ${top}%;${flip}\n}`;
      }).join('\n');
      rules.push(
        `${scoped('.bt-page-gutter__fish')} {\n  position: absolute;\n  left: 12%;\n  right: 12%;\n  height: 0.6em;\n${shapeByStyle[style] ?? shapeByStyle.black!}}${positionRules}`,
      );
    }
    /* 版心已承载叶次时，页脚页码重复显示 → 隐藏（页眉页脚配置不受影响） */
    if (gutter.fields.includes('pageNumber')) {
      rules.push(`${scoped('.bt-page-number')} {\n  display: none;\n}`);
    }
  }

  /* ---------- 4. 书耳（耳题）：版框外上角的小方框，题本页篇名 ---------- */
  if (facsimile.ear === true) {
    rules.push(
      `${scoped('.bt-page-ear')} {\n  position: absolute;\n  /* 版框外上角：外侧偏移 = 版框线厚 + 间隙（随版框形态） */\n  writing-mode: vertical-rl;\n  font-size: 0.62em;\n  letter-spacing: 0.1em;\n  color: ${frameColor};\n  border: 1px solid ${frameColor};\n  padding: 0.3em 0.12em;\n  max-height: 8em;\n  overflow: hidden;\n  white-space: nowrap;\n  pointer-events: none;\n}\n${scoped(`.bt-page-ear[data-side='left']`)} {\n  left: calc(var(--bt-fs-inset-left) - 1.6em);\n  top: var(--bt-fs-inset-top);\n}\n${scoped(`.bt-page-ear[data-side='right']`)} {\n  right: calc(var(--bt-fs-inset-right) - 1.6em);\n  top: var(--bt-fs-inset-top);\n}`,
    );
  }

  /* ---------- 5. 眉栏：版框上方天头处的横线区（套印本评点区界线） ---------- */
  if (facsimile.eyebrow === true) {
    rules.push(
      `${scoped('.bt-page-eyebrow')} {\n  position: absolute;\n  top: calc(var(--bt-fs-inset-top) / 2);\n  left: var(--bt-fs-inset-left);\n  right: var(--bt-fs-inset-right);\n  height: calc(var(--bt-fs-inset-top) / 2 - 0.4em);\n  border-block-end: 1px solid ${ruleColor};\n  overflow: hidden;\n  pointer-events: none;\n}`,
    );
  }

  /* ---------- 6. 眉批 / 旁批装饰位（v2 批 5，渲染层分流的承接容器） ----------
   *
   * 眉批（head-note）→ 天头容器（版框上方，多列小字横向并排）；旁批
   * （margin-note）→ 界行外窄条（版心带对侧）。渲染层把对应片段从行内流
   * 分流进容器（BtBookView / 打印 paged 同口径），编辑画布保持 flow 原位。
   * 眉批宿主用物理 translateY 上移到天头（页框书写方向无关）。
   */
  rules.push(
    `${scoped('.bt-page-eyebrow-host')} {\n  position: absolute;\n  top: var(--bt-fs-inset-top);\n  transform: translateY(calc(-100% - 0.3em));\n  left: var(--bt-fs-inset-left);\n  right: var(--bt-fs-inset-right);\n  display: flex;\n  flex-direction: row;\n  justify-content: flex-start;\n  gap: 0.6em;\n  writing-mode: vertical-rl;\n  font-size: 0.62em;\n  line-height: 1.4;\n  color: ${ruleColor};\n  max-height: calc(var(--bt-fs-inset-top) - 0.6em);\n  overflow: hidden;\n  pointer-events: none;\n}\n${scoped('.bt-page-eyebrow-host .bt-head-note')} {\n  display: block;\n  margin: 0;\n  padding: 0;\n  border: 0;\n  font-size: inherit;\n}\n${scoped('.bt-page-side-host')} {\n  position: absolute;\n  top: var(--bt-fs-inset-top);\n  bottom: var(--bt-fs-inset-bottom);\n  writing-mode: vertical-rl;\n  font-size: 0.62em;\n  line-height: 1.4;\n  color: ${ruleColor};\n  overflow: hidden;\n  pointer-events: none;\n}\n${scoped(`.bt-page-side-host[data-side='left']`)} {\n  right: calc(var(--bt-fs-inset-right) - 1.6em);\n  inline-size: 1.4em;\n}\n${scoped(`.bt-page-side-host[data-side='right']`)} {\n  left: calc(var(--bt-fs-inset-left) - 1.6em);\n  inline-size: 1.4em;\n}\n${scoped('.bt-page-side-host .bt-margin-note')} {\n  display: block;\n  margin: 0;\n  padding: 0;\n  font-size: inherit;\n}`,
  );

  return rules.join('\n\n');
}
