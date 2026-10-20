/**
 * 「古籍直排 / 现代横排」基线夹具
 *
 * 用途：把改造完成时的古典产出**锁死**，后续任何改动只要碰到古典路径
 * （多一条声明、少一个 token 键、尺寸算错 1px）就会让
 * `classical-isolation.test.ts` 的基线快照断言变红。
 *
 * 说明：改造前的逐字符原文无法回溯，因此这里固化的是「改造后、且已由
 * 不变量断言证明与改造前等价」的产出；两者配合即构成完整的零影响守护。
 */
import { DEFAULT_THEME } from '@bibliotype/core';

/** 古典主题代表性令牌（含 demo 的版框令牌） */
export const CLASSICAL_BASELINE_TOKENS: Readonly<Record<string, string>> = {
  ...DEFAULT_THEME,
  'page-border': '3px double #b09a76',
};

/** 基线样式表的作用域容器 */
export const CLASSICAL_BASELINE_CONTAINER = '.bt-reader-page';

/** 基线样式表的正文字体令牌键 */
export const CLASSICAL_BASELINE_FONT_TOKEN = 'font-family-classical-body';

/**
 * 基线 CSS 全文的 FNV-1a 哈希
 *
 * 2026-10-20 更新：表格新增「单元格对齐 / 表头行」两条规则（无表头的古典文档
 * 渲染不受影响，但样式表全文变化），基线随之重锁。
 *
 * 2026-10-20 二次更新：新增注释注码规则 `.bt-note-marker`（仅在文档含注码时命中），
 * 样式表全文变化，基线重锁。
 *
 * 2026-10-20 三次更新：新增目录链接规则 `.bt-toc .bt-mark-link`（目录条目链接跟随目录版式），
 * 样式表全文变化，基线重锁。
 *
 * 2026-10-20 四次更新：新增注引用 `.bt-mark-noteref` 与注文回跳 `.bt-note-backref` 两条规则，
 * 样式表全文变化，基线重锁。
 */
export const CLASSICAL_CSS_FNV = 'ca77fe18';

/** 基线度量签名的 FNV-1a 哈希 */
export const CLASSICAL_SIGNATURE_FNV = 'c6b7f9f4';

/** 基线版心主轴尺寸（页宽 − 边距 − 版框） */
export const CLASSICAL_MAIN_SIZE = 581;

/** 基线版心交叉轴尺寸（页高 − 边距 − 版框） */
export const CLASSICAL_CROSS_SIZE = 881;

/** 基线页底溢出（直排恒为 0：溢出吃的是外边距，不默认开放） */
export const CLASSICAL_BOTTOM_SLACK = 0;

/**
 * FNV-1a 32 位哈希（十六进制 8 位）
 *
 * 用哈希而非全文快照：断言更稳（不因换行风格 / 编辑器格式化误报），
 * 同时任何字符级变化都能被发现。
 */
export function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
