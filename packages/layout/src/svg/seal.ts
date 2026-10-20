/**
 * 印章印谱 SVG（K5）
 *
 * 纯字符串拼接、零依赖、零随机：同输入必须字节一致（测试直接比对）。
 * 取代原 `.bt-seal::after { content: attr(data-text) }` 的 CSS 假印章——
 * CSS 只能画方框 + 文字，无法做**白文**（朱底留白）与回文排字。
 *
 * 字形用系统 serif（`STSong` / `SimSun` / `serif`），不引入字体文件；
 * 印面按传统读序排字：方印「右上 → 右下 → 左上 → 左下」。
 */

/** 印章风格：朱文（红字白底）/ 白文（红底白字） */
export type SealStyle = 'zhu' | 'bai';

/** 排字方向：方印回文 / 竖排两列或单列 */
export type SealLayout = 'square' | 'column';

/** 边框粗细 */
export type SealBorder = 'none' | 'thin' | 'thick';

/** 印章 SVG 选项 */
export interface SealSvgOptions {
  /** 印文（取前 4 字；空串返回空字符串，由调用方退化为文字印章） */
  text: string;
  /** 朱文 / 白文（缺省朱文） */
  style?: SealStyle;
  /** 方印回文 / 竖排（缺省方印） */
  layout?: SealLayout;
  /** 边框（缺省粗边） */
  border?: SealBorder;
  /** 显式像素尺寸（缺省 1.6em，随字号缩放） */
  size?: number;
}

/** 传统印泥色（朱砂） */
const SEAL_RED = '#b03a2e';

/** XML 文本转义（属性与文本共用） */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 方印回文坐标：右上 → 右下 → 左上 → 左下 */
const SQUARE_POSITIONS: ReadonlyArray<readonly [number, number]> = [
  [75, 36],
  [75, 70],
  [25, 36],
  [25, 70],
];

/** 单字 / 两字 / 三字在方印中的字号（四字为 34） */
function squareFontSize(count: number): number {
  if (count === 1) return 52;
  if (count === 2 || count === 3) return 38;
  return 34;
}

/** 生成印章 SVG */
export function renderSealSvg(options: SealSvgOptions): string {
  const chars = [...options.text.trim()].slice(0, 4);
  if (chars.length === 0) return '';

  const style = options.style ?? 'zhu';
  const layout = options.layout ?? 'square';
  const border = options.border ?? 'thick';
  const dimension = options.size === undefined ? '1.6em' : String(options.size);

  /* 印面：白文必须铺底朱色；朱文只在有边框时描边 */
  let background = '';
  if (style === 'bai') {
    background = `<rect x="2" y="2" width="96" height="96" rx="4" fill="${SEAL_RED}" />`;
  } else if (border !== 'none') {
    const strokeWidth = border === 'thick' ? 5 : 2;
    background =
      `<rect x="4" y="4" width="92" height="92" rx="3" fill="none" ` +
      `stroke="${SEAL_RED}" stroke-width="${strokeWidth}" />`;
  }

  const fill = style === 'bai' ? '#ffffff' : SEAL_RED;

  let glyphs = '';
  if (layout === 'square') {
    const fontSize = squareFontSize(chars.length);
    chars.forEach((char, index) => {
      const [x, y] = SQUARE_POSITIONS[index] ?? [50, 50];
      glyphs += `<text x="${x}" y="${y}" text-anchor="middle" font-size="${fontSize}" fill="${fill}">${escapeXml(char)}</text>`;
    });
  } else {
    const fontSize = chars.length <= 2 ? 34 : 26;
    const step = 72 / chars.length;
    chars.forEach((char, index) => {
      const y = Math.round((22 + step * (index + 0.72)) * 10) / 10;
      glyphs += `<text x="50" y="${y}" text-anchor="middle" font-size="${fontSize}" fill="${fill}">${escapeXml(char)}</text>`;
    });
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" ` +
    `width="${dimension}" height="${dimension}" role="img" ` +
    `aria-label="印章：${escapeXml(options.text.trim())}" class="bt-seal-svg" ` +
    `font-family="STSong, SimSun, serif">${background}${glyphs}</svg>`
  );
}
