/**
 * 缺字采集测试（K6）
 *
 * 覆盖：遍历文本节点（含注释）、上下文与路径、按字符去重、可合成与不可合成
 * 两类的区分，以及空文档 / 全命中的空结果。
 */
import { describe, expect, it } from 'vitest';
import { NODE_TYPES, createEmptyDocument, type BookDocument } from '../index.js';
import type { GlyphProbe } from '../font-coverage.js';
import { collectGlyphIssues, summarizeGlyphIssues } from '../glyph-issues.js';

/** 只对样例中的扩展区字形未命中，普通汉字正常命中 */
const MISSING_CHARS = new Set(['𫞩', '𠀋']);
const missAll: GlyphProbe = (char) => !MISSING_CHARS.has(char);

/** 样本文档：正文两个缺字 + 注释一个缺字 */
function sampleDoc(): BookDocument {
  const doc = createEmptyDocument({ title: '缺字' });
  doc.root.children = [
    {
      type: NODE_TYPES.PARAGRAPH,
      id: 'p-1',
      children: [{ type: 'text', text: '山𫞩水𠀋山' }],
    },
    {
      type: NODE_TYPES.FOOTNOTE,
      id: 'fn-1',
      children: [{ type: 'text', text: '注：𫞩' }],
    },
  ];
  return doc;
}

describe('collectGlyphIssues', () => {
  it('列出缺字并带路径、上下文与码位', () => {
    const issues = collectGlyphIssues(sampleDoc(), {
      families: ['Songti'],
      probe: missAll,
      idsFor: (char) => (char === '𫞩' ? '⿰王卂' : undefined),
    });

    // 去重后两个字符：𫞩（可合成）、𠀋（方框）
    expect(issues).toHaveLength(2);
    const first = issues[0]!;
    expect(first.char).toBe('𫞩');
    expect(first.stage).toBe('ids');
    expect(first.code).toBe('U+2B7A9');
    expect(first.path).toBe('0.0');
    expect(first.context).toContain('山');
    expect(issues[1]?.stage).toBe('tofu');
    expect(issues[1]?.code).toBe('U+2000B');
  });

  it('unique=false 时逐处报告（含注释）', () => {
    const issues = collectGlyphIssues(sampleDoc(), {
      families: ['Songti'],
      probe: missAll,
      unique: false,
    });
    expect(issues.length).toBeGreaterThan(2);
    expect(issues.some((issue) => issue.path.startsWith('1'))).toBe(true);
  });

  it('全部命中或空文档时返回空数组', () => {
    const hitAll: GlyphProbe = () => true;
    expect(
      collectGlyphIssues(sampleDoc(), { families: ['Songti'], probe: hitAll }),
    ).toEqual([]);

    const empty = createEmptyDocument({ title: '空' });
    expect(collectGlyphIssues(empty, { families: ['Songti'], probe: missAll })).toEqual([]);
  });

  it('摘要给出数量与逐字说明', () => {
    const issues = collectGlyphIssues(sampleDoc(), {
      families: ['Songti'],
      probe: missAll,
      idsFor: (char) => (char === '𫞩' ? '⿰王卂' : undefined),
    });
    const summary = summarizeGlyphIssues(issues);
    expect(summary).toContain('缺字 2 处');
    expect(summary).toContain('可 IDS 合成');
    expect(summarizeGlyphIssues([])).toBe('未发现缺字');
  });
});
