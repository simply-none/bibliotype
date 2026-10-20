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

  /* ---------- 2. 界行（节距 = 字号 × 行距，锚定版心起始侧） ---------- */
  if (facsimile.rule !== FACSIMILE_RULES.NONE) {
    rules.push(
      `${containerSelector}::after {\n  content: '';\n  position: absolute;\n  inset: var(--bt-fs-rule-inset);\n  background-image: repeating-linear-gradient(\n    to left,\n    transparent 0 calc(var(--bt-fs-line-pitch) - 1px),\n    ${ruleColor} calc(var(--bt-fs-line-pitch) - 1px) var(--bt-fs-line-pitch)\n  );\n  pointer-events: none;\n}`,
    );
  }

  /* ---------- 3. 版心（书口）：竖向窄带 + 上下文字 + 鱼尾 ---------- */
  if (gutter !== undefined && gutterSize > 0) {
    const scoped = (selector: string): string => `${containerSelector} ${selector}`;
    const mouthRule =
      gutter.mouth === 'black'
        ? `  border-top: 5px solid ${gutterColor};\n  border-bottom: 5px solid ${gutterColor};\n`
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
      rules.push(
        `${scoped('.bt-page-gutter__fish')} {\n  position: absolute;\n  left: 12%;\n  right: 12%;\n  height: 0.6em;\n  background: ${gutterColor};\n  clip-path: polygon(100% 0, 0 50%, 100% 100%, 100% 66%, 30% 50%, 100% 34%);\n}\n${scoped(
          ".bt-page-gutter__fish:nth-of-type(1)",
        )} {\n  top: 26%;\n}\n${scoped(
          ".bt-page-gutter__fish:nth-of-type(2)",
        )} {\n  top: 62%;\n}`,
      );
    }
    /* 版心已承载叶次时，页脚页码重复显示 → 隐藏（页眉页脚配置不受影响） */
    if (gutter.fields.includes('pageNumber')) {
      rules.push(`${scoped('.bt-page-number')} {\n  display: none;\n}`);
    }
  }

  return rules.join('\n\n');
}
