/**
 * 句读 / 专名建议测试（K3 纯函数层）
 *
 * 覆盖：规则命中位置、已有标点不重复、专名最长匹配与模型端口合并、
 * 建议 id 确定性、IR 块收集范围（不含注释）。
 */
import { describe, expect, it } from 'vitest';
import { NODE_TYPES, createEmptyDocument, type BookDocument } from '@bibliotype/core';
import {
  buildAnnotationSuggestions,
  collectSuggestionBlocks,
  countSuggestions,
} from '../annotation-suggestions.js';
import { judouMarkerRange, suggestJudou } from '../judou-rules.js';
import {
  BUILTIN_PROPER_NAME_TERMS,
  detectProperNames,
  type ProperNameDetector,
} from '../proper-names.js';

describe('suggestJudou', () => {
  it('句末语气词 → 句号，提示语 → 冒号，连词 → 其前逗号', () => {
    const text = '子曰学而时习之不亦说乎';
    const candidates = suggestJudou(text);

    const byOffset = new Map(candidates.map((item) => [item.offset, item]));
    // 「曰」后 → 冒号
    expect(byOffset.get(2)?.symbol).toBe('：');
    // 「而」前 → 逗号（插入偏移即词首）
    expect(byOffset.get(3)?.symbol).toBe('，');
    // 文末「乎」→ 句号
    expect(byOffset.get(text.length)?.symbol).toBe('。');
    // 置信度落在 0~1
    for (const item of candidates) {
      expect(item.confidence).toBeGreaterThan(0);
      expect(item.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('已有标点之后不再建议，同一偏移只保留最高置信度', () => {
    const candidates = suggestJudou('子曰：学而时习之。');
    // 「曰」后已是冒号 → 不再建议冒号
    expect(candidates.some((item) => item.offset === 2 && item.symbol === '：')).toBe(false);
    // 文末已是句号 → 不再补句号
    expect(candidates.some((item) => item.symbol === '。')).toBe(false);
    const offsets = candidates.map((item) => item.offset);
    expect(new Set(offsets).size).toBe(offsets.length);
  });

  it('空文本与全标点文本返回空数组', () => {
    expect(suggestJudou('')).toEqual([]);
    expect(suggestJudou('，。；')).toEqual([]);
  });

  it('limit 按偏移升序截断', () => {
    const candidates = suggestJudou('子曰学而时习之不亦说乎', { limit: 1 });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.offset).toBe(2);
  });

  it('judouMarkerRange 包裹候选标点前的字', () => {
    expect(judouMarkerRange({ offset: 3 }, '子曰学')).toEqual({ start: 2, end: 3 });
    expect(judouMarkerRange({ offset: 0 }, '子曰学')).toBeUndefined();
    expect(judouMarkerRange({ offset: 99 }, '子曰学')).toBeUndefined();
  });
});

describe('detectProperNames', () => {
  it('字典最长优先命中人名与书名', () => {
    const matches = detectProperNames('孔子曰：朱熹註論語');
    const names = matches.map((item) => item.name);
    expect(names).toContain('孔子');
    expect(names).toContain('朱熹');
    expect(names).toContain('論語');
    expect(matches.every((item) => item.source === 'dictionary')).toBe(true);
    // 区间互不重叠
    for (let index = 1; index < matches.length; index += 1) {
      expect(matches[index]!.start).toBeGreaterThanOrEqual(matches[index - 1]!.end);
    }
  });

  it('模型端口结果与字典合并，同区间以模型为准', () => {
    const detector: ProperNameDetector = () => [
      { start: 0, end: 2, name: '孔子', kind: 'person', source: 'model', confidence: 0.99 },
      { start: 3, end: 5, name: '學而', kind: 'book', source: 'model', confidence: 0.6 },
      // 越界结果应被丢弃
      { start: 99, end: 120, name: '越界', kind: 'person', source: 'model', confidence: 0.5 },
    ];
    const matches = detectProperNames('孔子曰學而', { detector });
    const kong = matches.find((item) => item.name === '孔子');
    expect(kong?.source).toBe('model');
    expect(matches.some((item) => item.name === '越界')).toBe(false);
    expect(matches.map((item) => item.name)).toContain('學而');
  });

  it('空文本返回空数组', () => {
    expect(detectProperNames('')).toEqual([]);
  });
});

describe('buildAnnotationSuggestions', () => {
  it('同时产出句读与专名建议，id 确定性可复现', () => {
    const blocks = [{ id: 'p-1', text: '孔子曰学而时习之不亦说乎' }];
    const first = buildAnnotationSuggestions(blocks);
    const second = buildAnnotationSuggestions(blocks);

    expect(first.map((item) => item.id)).toEqual(second.map((item) => item.id));
    expect(first.some((item) => item.kind === 'judou')).toBe(true);
    expect(first.some((item) => item.kind === 'proper-name' && item.text === '孔子')).toBe(true);
    expect(first.every((item) => item.source === 'auto')).toBe(true);

    const counts = countSuggestions(first);
    expect(counts.judou).toBeGreaterThan(0);
    expect(counts['proper-name']).toBe(1);
  });

  it('句读建议包裹前一个字，专名建议覆盖词形本身', () => {
    const suggestions = buildAnnotationSuggestions([{ id: 'p-1', text: '孔子曰學' }]);
    const judou = suggestions.find((item) => item.kind === 'judou');
    expect(judou?.text).toBe('曰');
    expect(judou?.symbol).toBe('：');
    const proper = suggestions.find((item) => item.kind === 'proper-name');
    expect(proper?.text).toBe('孔子');
    expect(proper?.start).toBe(0);
    expect(proper?.end).toBe(2);
  });

  it('可按类别关闭建议', () => {
    const suggestions = buildAnnotationSuggestions(
      [{ id: 'p-1', text: '孔子曰學' }],
      { judou: false },
    );
    expect(suggestions.every((item) => item.kind === 'proper-name')).toBe(true);
  });
});

describe('collectSuggestionBlocks', () => {
  it('只收集有 id 的段落，跳过标题与注释', () => {
    const doc: BookDocument = createEmptyDocument({ title: '论语' });
    doc.root.children = [
      { type: NODE_TYPES.HEADING, id: 'h-1', attrs: { title: '学而' }, children: [] },
      {
        type: NODE_TYPES.PARAGRAPH,
        id: 'p-1',
        children: [{ type: 'text', text: '孔子曰学而时习之' }],
      },
      { type: NODE_TYPES.PARAGRAPH, children: [{ type: 'text', text: '无 id 段落' }] },
      { type: NODE_TYPES.PARAGRAPH, id: 'p-2', children: [{ type: 'text', text: '   ' }] },
      {
        type: NODE_TYPES.FOOTNOTE,
        id: 'fn-1',
        children: [{ type: 'text', text: '注文' }],
      },
    ];

    expect(collectSuggestionBlocks(doc)).toEqual([
      { id: 'p-1', text: '孔子曰学而时习之' },
    ]);
  });

  it('内置字典至少覆盖常见人物与典籍（防御性下限）', () => {
    expect(BUILTIN_PROPER_NAME_TERMS.length).toBeGreaterThanOrEqual(20);
  });
});
