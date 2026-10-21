/**
 * 字形探测端口适配（D10）
 *
 * `document.fonts.check(font, text)` 是浏览器里唯一可用的「某字体是否有某字形」
 * 查询：字体未注册 / 未加载 / 环境不支持时返回 false（会被误判为缺字），
 * 因此这里做**保守降级**——能力缺失时一律视为命中，宁可漏报也不误报。
 *
 * 探测结果依赖宿主字体环境，属于「不确定输入」，所以 core 只收端口、不内置实现。
 */
import type { GlyphProbe } from '@bibliotype/core';

/** 探测用字号（`check` 需要完整 font 简写，与真实渲染无关） */
const PROBE_FONT_SIZE = 12;

/**
 * 把 `font-family` 令牌拆成族名数组
 *
 * 只处理引号与逗号，不做字体名规范化：`"Songti SC", serif` → `['Songti SC', 'serif']`。
 *
 * @param stack CSS `font-family` 声明值（可含引号、逗号与多余空格）
 */
export function splitFontFamilyList(stack: string): string[] {
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
 * 创建基于 `document.fonts.check` 的探测
 *
 * @param doc 目标文档（缺省 `document`；SSR / 测试可注入）
 * @returns 所有字符都视为命中的降级实现（环境不支持时）
 */
export function createFontCheckProbe(doc?: Document): GlyphProbe {
  const target = doc ?? (typeof document === 'undefined' ? undefined : document);
  const fontSet = target?.fonts;
  if (fontSet === undefined || typeof fontSet.check !== 'function') {
    return () => true;
  }
  return (char, fontFamily) => {
    try {
      return fontSet.check(`${PROBE_FONT_SIZE}px ${fontFamily}`, char);
    } catch {
      // 非法族名 / 内核不支持：按命中处理，避免整屏假缺字
      return true;
    }
  };
}
