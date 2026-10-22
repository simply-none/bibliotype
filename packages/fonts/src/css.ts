/**
 * `@font-face` 生成（E3）
 *
 * 字体目录相对 CSS 文件：EPUB 的 `OEBPS/style.css` 与站点的根 `style.css`
 * 都在各自包的根层，字体统一放 `fonts/`，因此同一份 CSS 可直接复用。
 */
import { fontFormatKeyword } from './format.js';
import type { PreparedFontFace } from './types.js';

/** `@font-face` 生成选项 */
export interface FontFaceCssOptions {
  /** 字体展示策略（缺省 `swap`：正文先用回退字体渲染，字体就绪再换） */
  fontDisplay?: 'auto' | 'block' | 'swap' | 'fallback' | 'optional';
  /**
   * 是否附加 `unicode-range`
   *
   * 缺省关闭：输出 `unicode-range` 需要后端提供覆盖区间，端口暂不返回；
   * 强行按字符集拼区间会因缺字而误伤回退链。
   */
  unicodeRange?: boolean;
}

/** CSS 字符串转义（族名与 URL 用单引号包裹） */
function quoteCss(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** 生成一条 `@font-face` */
export function buildFontFaceRule(face: PreparedFontFace, options: FontFaceCssOptions = {}): string {
  const display = options.fontDisplay ?? 'swap';
  return [
    '@font-face {',
    `  font-family: ${quoteCss(face.family)};`,
    `  src: url(${quoteCss(face.href)}) format('${fontFormatKeyword(face.format)}');`,
    `  font-weight: ${face.weight};`,
    `  font-style: ${face.style};`,
    `  font-display: ${display};`,
    '}',
  ].join('\n');
}

/** 生成全部 `@font-face`（字体面为空时返回空串） */
export function buildFontFaceCss(
  faces: readonly PreparedFontFace[],
  options: FontFaceCssOptions = {},
): string {
  if (faces.length === 0) return '';
  return faces.map((face) => buildFontFaceRule(face, options)).join('\n\n');
}
