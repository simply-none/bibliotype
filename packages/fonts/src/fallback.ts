/**
 * 字体回退链（E3，与 K6 缺字回退共用字体栈口径）
 *
 * 主题令牌的 `font-family` 值即回退链：自定义字体在前，系统字体在后。
 * 子集后仍缺字时，报告「已按回退链降级」，而不是假装覆盖完整。
 */
import type { FontSubsetBackend } from './types.js';

/**
 * 把 `font-family` 声明值拆成族名数组
 *
 * 只处理引号与逗号，不做字体名规范化：`"Songti SC", Kaiti, serif`
 * → `['Songti SC', 'Kaiti', 'serif']`。与 vue 的 `splitFontFamilyList`
 * 同口径（该实现依赖 vue 包，此处独立实现避免反向依赖）。
 */
export function splitFontFamilyStack(stack: string): string[] {
  const families: string[] = [];
  let current = '';
  let quote: '"' | "'" | '' = '';
  for (const char of stack) {
    if (quote !== '') {
      if (char === quote) quote = '';
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ',') {
      if (current.trim() !== '') families.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim() !== '') families.push(current.trim());
  return families;
}

/**
 * 计算某字体族的回退链
 *
 * 返回主题字体栈中位于该族之后、且不在已嵌入族集合中的族名。
 * 未传字体栈 / 栈中不含该族时返回空数组（调用方按「无回退信息」处理）。
 */
export function resolveFallbackChain(
  stack: string | undefined,
  family: string,
  embedded: ReadonlySet<string> = new Set(),
): string[] {
  if (stack === undefined || stack.trim() === '') return [];
  const families = splitFontFamilyStack(stack);
  const index = families.findIndex((item) => item.toLowerCase() === family.toLowerCase());
  if (index < 0) return [];
  return families.slice(index + 1).filter((item) => !embedded.has(item));
}

/**
 * 判断字符是否都在回退链中至少一个族里可用
 *
 * `probe` 由宿主注入（浏览器用 `document.fonts.check`，Node 用字体解析器）；
 * 未注入时视为全部可回退（保守：宁可少报，不误报）。
 */
export function isFallbackCovered(
  chars: string,
  fallbackChain: readonly string[],
  probe?: (char: string, family: string) => boolean,
): boolean {
  if (chars === '' || fallbackChain.length === 0) return false;
  if (probe === undefined) return true;
  for (const char of chars) {
    if (!fallbackChain.some((family) => probe(char, family))) return false;
  }
  return true;
}

/** 后端未提供覆盖信息时的提示（写入 warnings，避免假阴性） */
export function coverageIncompleteWarning(backend: FontSubsetBackend | undefined): string | undefined {
  if (backend === undefined) return undefined;
  return `子集化后端「${backend.name}」未返回覆盖信息，缺字报告可能不完整（可改用能读 cmap 的后端）。`;
}
