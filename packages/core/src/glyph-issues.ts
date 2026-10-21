/**
 * 缺字采集与报告（K6）
 *
 * 导出前把「字体与 IDS 都画不出的字」逐处列出来，给作者一个可执行的返修清单
 * （补字、换字体、或在宿主侧登记 IDS 描述）。
 *
 * 与 `analyzeGlyphCoverage`（D10）的分工：后者按整段文本做「逐字命中统计」，
 * 面向调试面板；本模块面向 IR 文档，输出**带位置与上下文**的问题清单。
 */
import type { BookDocument } from './ir/document.js';
import { NODE_TYPES } from './ir/node-types.js';
import type { BookNode } from './ir/nodes.js';
import { formatCodePoint } from './font-coverage.js';
import {
  resolveGlyphFallback,
  type GlyphFallbackOptions,
  type GlyphFallbackStage,
} from './glyph-fallback.js';

/** 单条缺字问题 */
export interface GlyphIssue {
  /** 缺字字符 */
  char: string;
  /** Unicode 码位（数值） */
  codePoint: number;
  /** Unicode 码位（`U+2B739`） */
  code: string;
  /** IR 节点路径（`0.2.1`：root 的子索引链，供定位） */
  path: string;
  /** 上下文（前后各若干字，已去除换行） */
  context: string;
  /** 回退阶段（`ids` 表示能合成、`tofu` 表示画不出来；`font` 命中不进报告） */
  stage: Exclude<GlyphFallbackStage, 'font'>;
  /** 是否位于私用区 */
  privateUse: boolean;
}

/** 采集选项 */
export interface CollectGlyphIssuesOptions extends GlyphFallbackOptions {
  /** 上下文长度（前后各取多少字，缺省 6） */
  contextLength?: number;
  /** 是否按字符去重（缺省 true，同一字符只报首次出现处） */
  unique?: boolean;
}

/** 空白 / 控制符不参与缺字检查 */
function isBlank(char: string): boolean {
  return /^\s$/u.test(char) || /^[\u0000-\u001f\u007f]$/u.test(char);
}

/** 取字符在文本中的上下文 */
function contextOf(text: string, offset: number, length: number, radius: number): string {
  const start = Math.max(0, offset - radius);
  const end = Math.min(text.length, offset + length + radius);
  return text.slice(start, end).replace(/\s+/gu, ' ');
}

/**
 * 采集文档中的缺字
 *
 * 遍历全部文本节点（含注释、标题、页眉页脚——导出时它们都会被排版），
 * 跳过空白；按 `unique` 决定同一字符是否只报一次。
 *
 * @param document IR 文档
 * @param options 字体链、探测端口、IDS 解析器
 * @returns 文档顺序的缺字清单
 */
export function collectGlyphIssues(
  document: BookDocument,
  options: CollectGlyphIssuesOptions,
): GlyphIssue[] {
  const result: GlyphIssue[] = [];
  const seen = new Set<string>();
  const { contextLength = 6, unique = true } = options;

  const walk = (node: BookNode, path: string): void => {
    if (node.type === NODE_TYPES.TEXT) {
      const text = node.text ?? '';
      let offset = 0;
      for (const char of text) {
        const length = char.length;
        if (!isBlank(char) && (unique === false || !seen.has(char))) {
          const resolution = resolveGlyphFallback(char, options);
          if (resolution.stage !== 'font') {
            seen.add(char);
            result.push({
              char,
              codePoint: resolution.codePoint,
              code: resolution.code ?? formatCodePoint(resolution.codePoint),
              path,
              context: contextOf(text, offset, length, contextLength),
              stage: resolution.stage,
              privateUse: resolution.privateUse,
            });
          }
        }
        offset += length;
      }
      return;
    }

    const children = node.children ?? [];
    for (let index = 0; index < children.length; index += 1) {
      walk(children[index]!, path === '' ? String(index) : `${path}.${index}`);
    }
  };

  if (document.root !== undefined) walk(document.root, '');
  return result;
}

/**
 * 缺字清单 → 中文摘要（导出前提示 / 日志）
 *
 * @example
 * summarizeGlyphIssues(issues);
 * // '缺字 2 处：𫞩（U+2B739，可 IDS 合成）；𠀋（U+2000B，私用区）'
 */
export function summarizeGlyphIssues(issues: readonly GlyphIssue[]): string {
  if (issues.length === 0) return '未发现缺字';
  const parts = issues.map((issue) => {
    const tags = [issue.code];
    if (issue.stage === 'ids') tags.push('可 IDS 合成');
    if (issue.privateUse) tags.push('私用区');
    return `${issue.char}（${tags.join('，')}）`;
  });
  return `缺字 ${issues.length} 处：${parts.join('；')}`;
}
