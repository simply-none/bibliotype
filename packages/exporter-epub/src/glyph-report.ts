/**
 * 导出前缺字报告（K6，EPUB）
 *
 * 只警告、不阻断：字体与 IDS 都画不出的字在阅读器里会变成豆腐块，
 * 但作者仍可能选择「先导出、后补字」，所以走 `ValidationProblem` 的
 * `warning` 通道，而不是让 `exportEpub` 失败。
 *
 * 探测端口由宿主提供（浏览器 `document.fonts.check`），本包不绑定环境。
 */
import {
  collectGlyphIssues,
  type BookDocument,
  type GlyphProbe,
} from '@bibliotype/core';
import type { ValidationProblem } from './validate.js';

/** 缺字检查选项 */
export interface EpubGlyphCheckOptions {
  /** 字体回退链（顺序即 CSS 声明顺序） */
  families: readonly string[];
  /** 单字探测端口（缺省视为全部命中，不产生问题） */
  probe?: GlyphProbe;
  /** 字符 → IDS 描述（宿主提供，能在阅读器外合成） */
  idsFor?: (char: string) => string | undefined;
  /** 上下文长度（缺省 6） */
  contextLength?: number;
  /** 是否按字符去重（缺省 true） */
  unique?: boolean;
}

/**
 * 收集 EPUB 导出前的缺字问题
 *
 * @returns `warning` 级问题清单（文档顺序）；无缺字时为空数组
 */
export function collectEpubGlyphProblems(
  document: BookDocument,
  options: EpubGlyphCheckOptions,
): ValidationProblem[] {
  const issues = collectGlyphIssues(document, {
    families: options.families,
    ...(options.probe === undefined ? {} : { probe: options.probe }),
    ...(options.idsFor === undefined ? {} : { idsFor: options.idsFor }),
    ...(options.contextLength === undefined ? {} : { contextLength: options.contextLength }),
    ...(options.unique === undefined ? {} : { unique: options.unique }),
  });

  return issues.map((issue) => ({
    severity: 'warning',
    code: issue.stage === 'ids' ? 'GLYPH-IDS' : 'GLYPH-MISSING',
    message:
      `${issue.char}（${issue.code}）缺字：` +
      (issue.stage === 'ids' ? '可用 IDS 合成显示' : '无可回退字形，阅读器会显示豆腐块') +
      `；位置 ${issue.path}，上下文「${issue.context}」`,
    path: issue.path,
  }));
}
