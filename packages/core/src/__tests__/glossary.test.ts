/**
 * 术语一致性：异写命中、用量统计、统一 / 未使用判定与表校验。
 */
import { describe, expect, it } from 'vitest';
import { createEmptyDocument, type BookDocument } from '../ir/document.js';
import type { BookNode } from '../ir/nodes.js';
import { NODE_TYPES } from '../ir/node-types.js';
import { checkGlossary, validateGlossary } from '../ir/glossary.js';

function paragraph(text: string, id?: string): BookNode {
  return id === undefined
    ? { type: NODE_TYPES.PARAGRAPH, children: [{ type: NODE_TYPES.TEXT, text }] }
    : { type: NODE_TYPES.PARAGRAPH, id, children: [{ type: NODE_TYPES.TEXT, text }] };
}

function documentWith(blocks: BookNode[]): BookDocument {
  const doc = createEmptyDocument({ title: '稿' });
  doc.root.children = [
    { type: NODE_TYPES.CHAPTER, id: 'chap-1', attrs: { title: '一' }, children: blocks },
  ];
  return doc;
}

describe('checkGlossary', () => {
  it('异写命中带建议与锚点，规范写法单独计数', () => {
    const doc = documentWith([
      paragraph('本纪第一。', 'p-1'),
      paragraph('本记第二，又作本记。', 'p-2'),
    ]);
    const report = checkGlossary(doc, [{ preferred: '本纪', variants: ['本记'] }]);

    expect(report.issues).toHaveLength(2);
    expect(report.issues[0]?.term).toBe('本记');
    expect(report.issues[0]?.suggestion).toBe('本纪');
    expect(report.issues[0]?.nodeId).toBe('p-2');
    expect(report.issues[0]?.anchor).toMatchObject({ nodeId: 'p-2', offset: 0, length: 2 });

    const usage = report.terms[0];
    expect(usage?.preferredCount).toBe(1);
    expect(usage?.variants).toEqual([
      expect.objectContaining({ term: '本记', count: 2 }),
    ]);
    expect(usage?.consistent).toBe(false);
    expect(report.inconsistentCount).toBe(1);
    expect(report.unusedCount).toBe(0);
  });

  it('只出现规范写法时判为已统一；未出现的术语单独统计', () => {
    const doc = documentWith([paragraph('笺注三种。')]);
    const report = checkGlossary(doc, [
      { preferred: '笺注', variants: ['笺註'] },
      { preferred: '校勘', variants: ['校勘记'] },
    ]);

    expect(report.issues).toHaveLength(0);
    expect(report.terms[0]?.consistent).toBe(true);
    expect(report.terms[0]?.preferredCount).toBe(1);
    expect(report.terms[1]?.unused).toBe(true);
    expect(report.unusedCount).toBe(1);
    expect(report.inconsistentCount).toBe(0);
  });

  it('includeUnused: false 剔除未使用术语', () => {
    const doc = documentWith([paragraph('笺注。')]);
    const report = checkGlossary(
      doc,
      [
        { preferred: '笺注' },
        { preferred: '校勘' },
      ],
      { includeUnused: false },
    );
    expect(report.terms.map((term) => term.preferred)).toEqual(['笺注']);
    expect(report.unusedCount).toBe(1);
  });

  it('默认检查注释，notes: false 时跳过注文', () => {
    const doc = documentWith([
      paragraph('正文。'),
      {
        type: NODE_TYPES.FOOTNOTE,
        id: 'fn-1',
        children: [paragraph('注文作笺註。')],
      },
    ]);
    expect(checkGlossary(doc, [{ preferred: '笺注', variants: ['笺註'] }]).issues).toHaveLength(1);
    expect(
      checkGlossary(doc, [{ preferred: '笺注', variants: ['笺註'] }], { notes: false }).issues,
    ).toHaveLength(0);
  });

  it('空术语表返回空报告，不抛错', () => {
    const report = checkGlossary(documentWith([paragraph('正文')]), []);
    expect(report).toEqual({ issues: [], terms: [], inconsistentCount: 0, unusedCount: 0 });
  });

  it('同一异写被多个术语声明时按各自条目计数', () => {
    const doc = documentWith([paragraph('引作通假。')]);
    const report = checkGlossary(doc, [
      { preferred: '通假', variants: ['通叚'] },
      { preferred: '假借', variants: ['通假'] },
    ]);
    /* 「通假」既是规范写法也是另一术语的异写：仍按条目分别统计 */
    expect(report.terms[0]?.preferredCount).toBe(1);
    expect(report.terms[1]?.variants[0]).toMatchObject({ term: '通假', count: 1 });
  });
});

describe('validateGlossary', () => {
  it('空规范写法 / 重复定义 / 异写等于规范写法都报出', () => {
    expect(validateGlossary([])).toEqual([]);
    const problems = validateGlossary([
      { preferred: ' ' },
      { preferred: '本纪', variants: ['本纪'] },
      { preferred: '本纪' },
    ]);
    expect(problems).toHaveLength(3);
    expect(problems[0]).toContain('规范写法为空');
    expect(problems[1]).toContain('异写与其规范写法相同');
    expect(problems[2]).toContain('重复定义');
  });
});
