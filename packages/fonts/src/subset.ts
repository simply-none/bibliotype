/**
 * 字体包编排（E3）
 *
 * 链路：IR 用字统计 → 逐字体调用子集后端（宿主注入）→ 生成文件名 / @font-face
 * → 汇总覆盖报告与许可声明。产物 `FontBundle` 由导出器直接消费：
 * - `exporter-epub`：字体写入 `OEBPS/fonts/`，manifest 登记，CSS 前置；
 * - `exporter-site`：字体写入 `fonts/`，站点 CSS 前置。
 *
 * 本包不内置字体解析二进制：后端缺省时按原始字节嵌入并告警（导出仍可完成）。
 */
import { BibliotypeError, type BookDocument } from '@bibliotype/core';
import { collectDocumentChars } from './collect.js';
import { buildFontFaceCss } from './css.js';
import { createPreparedFace, normalizeFontDirectory, sniffFontFormat } from './format.js';
import { coverageIncompleteWarning, resolveFallbackChain } from './fallback.js';
import { buildFontLicenseText, buildFontRightsLine, FONT_LICENSE_FILE } from './license.js';
import type {
  FontAssetInput,
  FontBundle,
  FontCoverageReport,
  FontFamilyReport,
  FontFormat,
  FontSubsetBackend,
  PrepareFontBundleOptions,
  PreparedFontFace,
} from './types.js';

/**
 * 准备字体包（异步：子集后端可能是 wasm / 子进程）
 *
 * @param document 书稿（用字统计输入）
 * @param fonts 字体资产（宿主从资产端口读出后传入）
 * @param options 后端 / 目标格式 / 回退栈 / 字体目录等
 * @throws BibliotypeError `FONT_SUBSET_FAILED`（后端抛错或返回空字节）
 */
export async function prepareFontBundle(
  document: BookDocument,
  fonts: readonly FontAssetInput[],
  options: PrepareFontBundleOptions = {},
): Promise<FontBundle> {
  const usage = collectDocumentChars(document, {
    ...(options.extraChars === undefined ? {} : { extraChars: options.extraChars }),
  });
  const fontDirectory = normalizeFontDirectory(options.fontDirectory);
  const embeddedFamilies = new Set(fonts.map((font) => font.family));
  const faces: PreparedFontFace[] = [];
  const families: FontFamilyReport[] = [];
  const warnings: string[] = [];

  if (fonts.length === 0) return emptyBundle(usage);

  if (options.backend === undefined) {
    warnings.push('未提供子集化后端：字体按原始字节嵌入，未做子集化（体积不会下降）。');
  } else if (usage.chars === '') {
    warnings.push('文档没有可统计的文本：字体未子集化，按原始字节嵌入。');
  }
  const incomplete = coverageIncompleteWarning(options.backend);
  let coverageIncomplete = false;

  for (const font of fonts) {
    if (font.bytes.byteLength === 0) {
      warnings.push(`字体「${font.family}」字节为空，已跳过嵌入。`);
      continue;
    }
    const sourceFormat = font.format ?? sniffFontFormat(font.bytes) ?? 'ttf';
    let subsetBytes = font.bytes;
    let outputFormat: FontFormat = sourceFormat;
    let subsetted = false;
    let missingChars = '';
    const backend = options.backend;
    if (backend !== undefined && usage.chars !== '') {
      const result = await runSubset(backend, font, sourceFormat, usage.chars, options);
      if (result.bytes.byteLength === 0) {
        throw new BibliotypeError('FONT_SUBSET_FAILED', `字体「${font.family}」子集化产物为空。`, {
          details: { fontId: font.id, family: font.family, backend: backend.name },
          hint: '检查后端参数；产物为空会让 @font-face 指向空文件。',
        });
      }
      subsetBytes = result.bytes;
      outputFormat = result.format ?? options.targetFormat ?? 'woff2';
      subsetted = true;
      missingChars = result.missingChars ?? '';
      if (result.missingChars === undefined) coverageIncomplete = true;
    }

    const face = createPreparedFace(font, subsetBytes, outputFormat, {
      fontDirectory,
      ...(options.fileNamePrefix === undefined ? {} : { fileNamePrefix: options.fileNamePrefix }),
      ...(options.slugLength === undefined ? {} : { slugLength: options.slugLength }),
    });
    faces.push(face);

    const fallbackChain = resolveFallbackChain(
      options.fallbackStack,
      font.family,
      embeddedFamilies,
    );
    families.push({
      id: font.id,
      family: font.family,
      sourceBytes: font.bytes.byteLength,
      subsetBytes: subsetBytes.byteLength,
      missingChars,
      fallbackChain,
      subsetted,
    });
    if (missingChars !== '') {
      const detail = `字体「${font.family}」缺字 ${Array.from(missingChars).length} 个：${abbreviate(missingChars)}`;
      warnings.push(
        fallbackChain.length > 0
          ? `${detail}；已按回退链降级：${fallbackChain.join(' → ')}。`
          : `${detail}；未配置回退链（请传 fallbackStack 或补充系统字体）。`,
      );
    }
    if (font.license === undefined) {
      warnings.push(`字体「${font.family}」未声明许可，产物缺少该字体的许可声明。`);
    }
  }
  if (coverageIncomplete && incomplete !== undefined) warnings.push(incomplete);

  const css = buildFontFaceCss(faces, {
    ...(options.fontDisplay === undefined ? {} : { fontDisplay: options.fontDisplay }),
  });
  const license = buildFontLicenseText(fonts);
  const rights = buildFontRightsLine(fonts);
  return {
    faces,
    css,
    ...(license === undefined ? {} : { licensePath: `${fontDirectory}${FONT_LICENSE_FILE}` }),
    ...(license === undefined ? {} : { license }),
    ...(rights === undefined ? {} : { rights }),
    report: buildReport(usage, families),
    warnings,
  };
}

/** 调用后端并统一包裹错误（保留根因，附字体与后端信息） */
async function runSubset(
  backend: FontSubsetBackend,
  font: FontAssetInput,
  sourceFormat: FontFormat,
  chars: string,
  options: PrepareFontBundleOptions,
): Promise<{ bytes: Uint8Array; format?: FontFormat; missingChars?: string }> {
  try {
    return await backend.subset({
      bytes: font.bytes,
      format: sourceFormat,
      chars,
      targetFormat: options.targetFormat ?? 'woff2',
      family: font.family,
      weight: font.weight ?? 400,
      style: font.style ?? 'normal',
    });
  } catch (error) {
    throw new BibliotypeError('FONT_SUBSET_FAILED', `字体「${font.family}」子集化失败。`, {
      details: { fontId: font.id, family: font.family, backend: backend.name },
      hint: '检查后端是否支持该源格式；不确定时改用 ttf / otf 源，或换用能读 cmap 的后端。',
      cause: error,
    });
  }
}

/** 汇总覆盖报告（体积下降比例非负；未子集时为 0） */
function buildReport(
  usage: { chars: string; total: number; unique: number },
  families: readonly FontFamilyReport[],
): FontCoverageReport {
  const sourceBytes = families.reduce((sum, item) => sum + item.sourceBytes, 0);
  const subsetBytes = families.reduce((sum, item) => sum + item.subsetBytes, 0);
  const reduction = sourceBytes === 0 ? 0 : Math.max(0, 1 - subsetBytes / sourceBytes);
  return {
    chars: usage.chars,
    total: usage.total,
    unique: usage.unique,
    families: [...families],
    sourceBytes,
    subsetBytes,
    reduction,
    hasMissing: families.some((item) => item.missingChars !== ''),
  };
}

/** 无字体时的空包（导出器按「无字体」路径继续） */
function emptyBundle(usage: { chars: string; total: number; unique: number }): FontBundle {
  return {
    faces: [],
    css: '',
    report: buildReport(usage, []),
    warnings: [],
  };
}

/** 缺字展示截断（告警与报告不撑爆日志） */
function abbreviate(chars: string, limit = 20): string {
  const list = Array.from(chars);
  return list.length <= limit ? list.join('') : `${list.slice(0, limit).join('')}…（共 ${list.length} 个）`;
}
