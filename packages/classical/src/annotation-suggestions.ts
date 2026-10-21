/**
 * 句读 / 专名建议模型（K3，纯函数）
 *
 * 把「句读规则」与「专名识别」的结果归一成**同一种建议结构**，供审阅面板
 * 逐条接受 / 拒绝：
 *
 * - 建议只存在于内存，不写文档、不写存储；
 * - `id` 由「类别 + 块 id + 区间 + 符号」确定性生成（不含时间 / 随机数），
 *   便于批量接受、拒绝与测试复现；
 * - 偏移均为**段内 UTF-16 code unit**，与 ProseMirror 位置口径一致。
 */
import { NODE_TYPES, type BookDocument, type BookNode } from '@bibliotype/core';
import { judouMarkerRange, suggestJudou, type JudouSymbol } from './judou-rules.js';
import {
  detectProperNames,
  type ProperNameDetector,
  type ProperNameKind,
  type ProperNameTerm,
} from './proper-names.js';

/** 建议类别 */
export type SuggestionKind = 'judou' | 'proper-name';

/** 参与建议的文本块 */
export interface SuggestionBlock {
  /** 块节点 id（接受建议时据此定位） */
  id: string;
  /** 块内纯文本 */
  text: string;
}

/** 单条建议 */
export interface AnnotationSuggestion {
  /** 确定性 id：`<kind>:<blockId>:<start>:<end>[:<symbol>]` */
  id: string;
  /** 类别 */
  kind: SuggestionKind;
  /** 所属块 id */
  blockId: string;
  /** 段内起始偏移（含） */
  start: number;
  /** 段内结束偏移（不含） */
  end: number;
  /** 覆盖的原文 */
  text: string;
  /** 句读符号（`kind === 'judou'`） */
  symbol?: JudouSymbol;
  /** 专名词形（`kind === 'proper-name'`） */
  name?: string;
  /** 专名类别（`kind === 'proper-name'`） */
  nameKind?: ProperNameKind;
  /** 命中规则 id（句读） */
  rule?: string;
  /** 置信度 0~1 */
  confidence: number;
  /** 来源恒为自动（人工补标不产生建议） */
  source: 'auto';
}

/** 构建建议的选项 */
export interface BuildSuggestionOptions {
  /** 自定义专名字典（缺省内置） */
  terms?: readonly ProperNameTerm[];
  /** 专名模型端口（宿主注入） */
  detector?: ProperNameDetector;
  /** 是否生成句读建议（缺省 true） */
  judou?: boolean;
  /** 是否生成专名建议（缺省 true） */
  properNames?: boolean;
}

/** 递归收集节点文本（行内容器一并展开） */
function collectText(node: BookNode): string {
  if (node.type === NODE_TYPES.TEXT) return node.text ?? '';
  let text = '';
  for (const child of node.children ?? []) text += collectText(child);
  return text;
}

/**
 * 从 IR 文档收集可标注的文本块
 *
 * 只取 `paragraph`：标题、注释、封面、目录等不参与句读建议（避免给书名页
 * 或注文重复断句）；块无 id 时跳过（无法定位落点）。
 *
 * @returns 文档顺序的块列表
 */
export function collectSuggestionBlocks(document: BookDocument): SuggestionBlock[] {
  const blocks: SuggestionBlock[] = [];
  const walk = (node: BookNode): void => {
    if (node.type === NODE_TYPES.PARAGRAPH) {
      const text = collectText(node);
      const id = node.id;
      if (id !== undefined && id !== '' && text.trim() !== '') blocks.push({ id, text });
      return;
    }
    for (const child of node.children ?? []) walk(child);
  };
  if (document.root !== undefined) walk(document.root);
  return blocks;
}

/**
 * 生成句读与专名建议
 *
 * @param blocks 块文本（通常来自 {@link collectSuggestionBlocks}）
 * @param options 见 {@link BuildSuggestionOptions}
 * @returns 按块顺序、块内偏移升序排列的建议
 */
export function buildAnnotationSuggestions(
  blocks: readonly SuggestionBlock[],
  options: BuildSuggestionOptions = {},
): AnnotationSuggestion[] {
  const { judou = true, properNames = true, terms, detector } = options;
  const result: AnnotationSuggestion[] = [];

  for (const block of blocks) {
    if (judou) {
      for (const candidate of suggestJudou(block.text)) {
        const range = judouMarkerRange(candidate, block.text);
        if (range === undefined) continue;
        result.push({
          id: `judou:${block.id}:${range.start}:${range.end}:${candidate.symbol}`,
          kind: 'judou',
          blockId: block.id,
          start: range.start,
          end: range.end,
          text: block.text.slice(range.start, range.end),
          symbol: candidate.symbol,
          rule: candidate.rule,
          confidence: candidate.confidence,
          source: 'auto',
        });
      }
    }

    if (properNames) {
      const matches = detectProperNames(block.text, {
        ...(terms === undefined ? {} : { terms }),
        ...(detector === undefined ? {} : { detector }),
      });
      for (const match of matches) {
        result.push({
          id: `proper-name:${block.id}:${match.start}:${match.end}`,
          kind: 'proper-name',
          blockId: block.id,
          start: match.start,
          end: match.end,
          text: block.text.slice(match.start, match.end),
          name: match.name,
          nameKind: match.kind,
          confidence: match.confidence,
          source: 'auto',
        });
      }
    }
  }

  return result;
}

/** 统计各类建议数量（面板角标用） */
export function countSuggestions(
  suggestions: readonly AnnotationSuggestion[],
): Record<SuggestionKind, number> {
  let judou = 0;
  let properName = 0;
  for (const suggestion of suggestions) {
    if (suggestion.kind === 'judou') judou += 1;
    else properName += 1;
  }
  return { judou, 'proper-name': properName };
}
