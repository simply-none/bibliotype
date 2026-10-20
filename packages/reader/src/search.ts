/**
 * 全文搜索的纯函数内核
 *
 * 与 `Reader` 解耦：这里只做「查询 → 正则」「文本 → 命中区间 / 摘录 / 范围收集」，
 * 便于独立测试与在导出 / 预览侧复用。`Reader.search` 负责遍历分页结果。
 */
import type { BookNode } from '@bibliotype/core';
import { findNodeById } from './find-node.js';

/** 搜索选项 */
export interface ReaderSearchOptions {
  /** 结果上限（默认 50） */
  limit?: number;
  /** 摘录上下文半径（命中词前后各取多少字符，默认 12） */
  contextLength?: number;
  /** 把查询串按正则解释（默认 false = 字面匹配） */
  regex?: boolean;
  /** 大小写敏感（默认 true，与历史行为一致） */
  caseSensitive?: boolean;
  /**
   * 限定搜索范围：结构节点 id（或 extractBlocks 树路径），只搜其子树内的块
   *
   * 适合「本章内查找」；节点不存在时返回空结果。
   */
  scope?: string;
  /** 是否在结果中返回命中区间（默认 false，避免给既有调用方增加字段） */
  ranges?: boolean;
  /** 单个块最多返回的命中区间数（默认 20，防止超长段落撑爆结果） */
  maxRangesPerBlock?: number;
}

/** 命中区间（相对块纯文本，半开区间） */
export interface TextMatchRange {
  /** 起始偏移（含） */
  from: number;
  /** 结束偏移（不含） */
  to: number;
}

/** 搜索结果条目 */
export interface ReaderSearchResult {
  /** 命中块（叶块）节点 id，可直接用于 goToNode */
  nodeId: string;
  /** 命中块所在页（自 0 起） */
  pageIndex: number;
  /** 命中块节点类型 */
  blockType: string;
  /** 去掉首尾空白的命中上下文摘录（首尾越界处以省略号标记） */
  excerpt: string;
  /** 该块内命中次数 */
  matchCount: number;
  /** 命中区间（仅 `ranges: true` 时给出） */
  ranges?: TextMatchRange[];
}

/** 转义正则元字符（字面匹配用） */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 构造全局匹配正则
 *
 * @throws RangeError 查询串作为正则不合法（错误信息给出修复指向）
 */
export function buildSearchPattern(
  query: string,
  options: { regex?: boolean; caseSensitive?: boolean } = {},
): RegExp {
  const flags = options.caseSensitive === false ? 'gi' : 'g';
  if (!options.regex) {
    return new RegExp(escapeRegExp(query), flags);
  }
  try {
    return new RegExp(query, flags);
  } catch {
    throw new RangeError(`搜索失败：正则表达式不合法（${query}）。请检查括号 / 转义。`);
  }
}

/** 单块命中统计与区间 */
export interface MatchScanResult {
  /** 命中总数（不受 maxRanges 截断） */
  count: number;
  /** 命中区间（最多 maxRanges 个） */
  ranges: TextMatchRange[];
}

/** 扫描单块文本的命中（零宽匹配自动前进，避免死循环） */
export function findMatchRanges(
  text: string,
  pattern: RegExp,
  maxRanges = 20,
): MatchScanResult {
  const ranges: TextMatchRange[] = [];
  let count = 0;
  pattern.lastIndex = 0;
  let hit = pattern.exec(text);
  while (hit) {
    count += 1;
    if (ranges.length < maxRanges) {
      ranges.push({ from: hit.index, to: hit.index + hit[0].length });
    }
    if (hit[0].length === 0) {
      pattern.lastIndex += 1;
    }
    if (pattern.lastIndex > text.length) {
      break;
    }
    hit = pattern.exec(text);
  }
  return { count, ranges };
}

/** 截取命中上下文摘录 */
export function buildMatchExcerpt(
  text: string,
  from: number,
  to: number,
  contextLength: number,
): string {
  const start = Math.max(0, from - contextLength);
  const end = Math.min(text.length, to + contextLength);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${text.slice(start, end)}${suffix}`;
}

/**
 * 收集范围内子树的所有节点（按对象身份）
 *
 * 用身份集合判定「块是否在范围内」：`findNodeById` 返回的是同一棵树上的节点对象，
 * 因此无需重算树路径。范围节点不存在时返回 `undefined`，调用方据此直接返回空结果。
 */
export function collectSubtreeNodes(root: BookNode, scopeId: string): Set<BookNode> | undefined {
  const scope = findNodeById(root, scopeId);
  if (scope === undefined) {
    return undefined;
  }
  const nodes = new Set<BookNode>();
  const walk = (node: BookNode): void => {
    nodes.add(node);
    (node.children ?? []).forEach(walk);
  };
  walk(scope);
  return nodes;
}
