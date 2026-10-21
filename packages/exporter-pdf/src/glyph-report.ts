/**
 * 导出前缺字报告（K6，PDF / 打印）
 *
 * PDF 走系统打印引擎或 Electron 渲染，缺字同样会变成方框；本模块复用
 * `core` 的采集纯函数，输出可直接展示的中文警告条目（不阻断导出）。
 */
import {
  collectGlyphIssues,
  summarizeGlyphIssues,
  type BookDocument,
  type GlyphIssue,
  type GlyphProbe,
} from '@bibliotype/core';

/** 缺字检查选项 */
export interface PdfGlyphCheckOptions {
  /** 字体回退链 */
  families: readonly string[];
  /** 单字探测端口（缺省视为全部命中） */
  probe?: GlyphProbe;
  /** 字符 → IDS 描述 */
  idsFor?: (char: string) => string | undefined;
  /** 上下文长度（缺省 6） */
  contextLength?: number;
  /** 是否按字符去重（缺省 true） */
  unique?: boolean;
}

/**
 * 收集 PDF 导出前的缺字条目
 *
 * @returns 文档顺序的缺字清单；可作为 `printHtml` / `downloadPdf` 前的提示
 */
export function collectPdfGlyphProblems(
  document: BookDocument,
  options: PdfGlyphCheckOptions,
): GlyphIssue[] {
  return collectGlyphIssues(document, {
    families: options.families,
    ...(options.probe === undefined ? {} : { probe: options.probe }),
    ...(options.idsFor === undefined ? {} : { idsFor: options.idsFor }),
    ...(options.contextLength === undefined ? {} : { contextLength: options.contextLength }),
    ...(options.unique === undefined ? {} : { unique: options.unique }),
  });
}

/**
 * 单行中文摘要（导出前 toast / 日志）
 *
 * @example
 * summarizePdfGlyphProblems(issues);
 * // '缺字 2 处：𫞩（U+2B7A9，可 IDS 合成）；𠀋（U+2000B）'
 */
export function summarizePdfGlyphProblems(issues: readonly GlyphIssue[]): string {
  return summarizeGlyphIssues(issues);
}
