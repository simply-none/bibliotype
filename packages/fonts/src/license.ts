/**
 * 字体许可声明（E3）
 *
 * 自出版字体多为 SIL OFL / 商业授权，产物必须随包携带许可与版权行：
 * - `licenseText`：完整声明，写入 `fonts/LICENSE.txt`；
 * - `rightsLine`：简短一行，写入 OPF `dc:rights`。
 */
import type { FontAssetInput } from './types.js';

/** 标题行（许可文件首行，便于读者与审核识别） */
const LICENSE_TITLE = '字体许可声明';

/** 许可文件名（与字体同目录，EPUB manifest / 站点清单据此登记） */
export const FONT_LICENSE_FILE = 'LICENSE.txt';

/**
 * 生成许可声明全文
 *
 * 无任何字体声明许可时返回 undefined（调用方不写许可文件，并在告警中提示）。
 */
export function buildFontLicenseText(fonts: readonly FontAssetInput[]): string | undefined {
  const licensed = fonts.filter((font) => font.license !== undefined);
  if (licensed.length === 0) return undefined;
  const blocks = licensed.map((font) => {
    const license = font.license;
    if (license === undefined) return '';
    const lines = [`${font.family}（${font.id}）`, `  许可：${license.name}`];
    if (license.url !== undefined && license.url !== '') lines.push(`  许可地址：${license.url}`);
    if (license.copyright !== undefined && license.copyright !== '') {
      lines.push(`  版权：${license.copyright}`);
    }
    return lines.join('\n');
  });
  return `${LICENSE_TITLE}\n${'='.repeat(LICENSE_TITLE.length)}\n\n${blocks.join('\n\n')}\n`;
}

/** 生成简短版权行（OPF `dc:rights`；多字体去重后以「；」分隔） */
export function buildFontRightsLine(fonts: readonly FontAssetInput[]): string | undefined {
  const parts: string[] = [];
  for (const font of fonts) {
    const license = font.license;
    if (license === undefined) continue;
    const part = `${font.family}：${license.name}`;
    if (!parts.includes(part)) parts.push(part);
  }
  return parts.length === 0 ? undefined : parts.join('；');
}
