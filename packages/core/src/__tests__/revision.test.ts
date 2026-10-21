/**
 * 修订模式：采集、三视图投影、接受 / 拒绝矩阵（含选择性处理）。
 */
import { describe, expect, it } from 'vitest';
import { NODE_TYPES, MARK_TYPES } from '../ir/node-types.js';
import { createEmptyDocument } from '../ir/document.js';
import type { BookDocument } from '../ir/document.js';
import type { BookNode } from '../ir/nodes.js';
import {
  REVISION_MARK_TYPES,
  REVISION_VIEWS,
  buildChangeId,
  collectRevisions,
  resolveMarksForView,
} from '../revision/revision-marks.js';
import {
  acceptRevisions,
  hasRevisions,
  projectRevisionView,
  rejectRevisions,
} from '../revision/accept-reject.js';

function text(value: string, marks?: BookNode['marks']): BookNode {
  return marks === undefined ? { type: 'text', text: value } : { type: 'text', text: value, marks };
}

/** 一段包含三类修订的文档 */
function revisionDoc(): BookDocument {
  const doc = createEmptyDocument({ title: '修订样本' });
  doc.root.children = [
    {
      type: NODE_TYPES.PARAGRAPH,
      id: 'p-1',
      children: [
        text('保留'),
        text('新增', [{ type: MARK_TYPES.INSERTION, attrs: { changeId: 'c-ins', author: '甲', timestamp: 1 } }]),
        text('删除', [{ type: MARK_TYPES.DELETION, attrs: { changeId: 'c-del', author: '乙', timestamp: 2 } }]),
        text('格式', [
          {
            type: MARK_TYPES.FORMAT_CHANGE,
            attrs: { changeId: 'c-fmt', previous: JSON.stringify([{ type: MARK_TYPES.EMPHASIS }]) },
          },
          { type: MARK_TYPES.STRONG },
        ]),
        text('尾部'),
      ],
    },
  ];
  return doc;
}

/** 拼接某段父节点的文本 */
function plainText(doc: BookDocument): string {
  const parts: string[] = [];
  const walk = (node: BookNode): void => {
    if (node.type === 'text') {
      parts.push(node.text ?? '');
      return;
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(doc.root);
  return parts.join('');
}

/** 取首个段落里带指定标记的文本 */
function markedText(doc: BookDocument, type: string): string {
  const found: string[] = [];
  const walk = (node: BookNode): void => {
    if (node.type === 'text') {
      if ((node.marks ?? []).some((mark) => mark.type === type)) found.push(node.text ?? '');
      return;
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(doc.root);
  return found.join('');
}

describe('collectRevisions', () => {
  it('按遍历顺序采集三类修订与元信息', () => {
    const entries = collectRevisions(revisionDoc());
    expect(entries.map((entry) => entry.type)).toEqual([
      REVISION_MARK_TYPES.INSERTION,
      REVISION_MARK_TYPES.DELETION,
      REVISION_MARK_TYPES.FORMAT_CHANGE,
    ]);
    expect(entries[0]?.changeId).toBe('c-ins');
    expect(entries[0]?.author).toBe('甲');
    expect(entries[0]?.path).toContain('root.children[0].children[1]');
    expect(entries[1]?.text).toBe('删除');
    expect(hasRevisions(revisionDoc())).toBe(true);
    expect(hasRevisions(createEmptyDocument({ title: '空' }))).toBe(false);
  });

  it('changeId 确定性：同作者 / 时间 / 序号同 id', () => {
    const first = buildChangeId({ author: '甲', timestamp: 1000, index: 1 });
    expect(buildChangeId({ author: '甲', timestamp: 1000, index: 1 })).toBe(first);
    expect(buildChangeId({ author: '乙', timestamp: 1000, index: 1 })).not.toBe(first);
  });
});

describe('resolveMarksForView', () => {
  it('marked 原样保留', () => {
    const marks = [{ type: MARK_TYPES.DELETION, attrs: { changeId: 'c' } }];
    expect(resolveMarksForView(marks, REVISION_VIEWS.MARKED)).toEqual({ hidden: false, marks });
  });

  it('final 隐藏删除、去掉修订痕迹', () => {
    expect(
      resolveMarksForView([{ type: MARK_TYPES.DELETION }], REVISION_VIEWS.FINAL).hidden,
    ).toBe(true);
    expect(
      resolveMarksForView(
        [{ type: MARK_TYPES.INSERTION }, { type: MARK_TYPES.STRONG }],
        REVISION_VIEWS.FINAL,
      ),
    ).toEqual({ hidden: false, marks: [{ type: MARK_TYPES.STRONG }] });
  });

  it('original 隐藏插入、还原格式变更前的标记', () => {
    expect(
      resolveMarksForView([{ type: MARK_TYPES.INSERTION }], REVISION_VIEWS.ORIGINAL).hidden,
    ).toBe(true);
    expect(
      resolveMarksForView(
        [
          { type: MARK_TYPES.FORMAT_CHANGE, attrs: { previous: JSON.stringify([{ type: 'emphasis' }]) } },
          { type: MARK_TYPES.STRONG },
        ],
        REVISION_VIEWS.ORIGINAL,
      ).marks,
    ).toEqual([{ type: 'emphasis' }]);
  });
});

describe('acceptRevisions / rejectRevisions', () => {
  it('接受全部：删除内容消失、插入保留且去标记', () => {
    const accepted = acceptRevisions(revisionDoc());
    expect(plainText(accepted)).toBe('保留新增格式尾部');
    expect(markedText(accepted, MARK_TYPES.DELETION)).toBe('');
    expect(markedText(accepted, MARK_TYPES.INSERTION)).toBe('');
    expect(markedText(accepted, MARK_TYPES.FORMAT_CHANGE)).toBe('');
  });

  it('拒绝全部：插入内容消失、删除内容复原、格式回滚到变更前', () => {
    const rejected = rejectRevisions(revisionDoc());
    expect(plainText(rejected)).toBe('保留删除格式尾部');
    expect(markedText(rejected, MARK_TYPES.INSERTION)).toBe('');
    expect(markedText(rejected, MARK_TYPES.DELETION)).toBe('');
    expect(markedText(rejected, MARK_TYPES.STRONG)).toBe('');
    expect(markedText(rejected, MARK_TYPES.EMPHASIS)).toBe('格式');
  });

  it('只接受指定修订，其余保留', () => {
    const accepted = acceptRevisions(revisionDoc(), ['c-del']);
    expect(plainText(accepted)).toBe('保留新增格式尾部');
    expect(markedText(accepted, MARK_TYPES.INSERTION)).toBe('新增');
    expect(markedText(accepted, MARK_TYPES.FORMAT_CHANGE)).toBe('格式');
  });

  it('空 id 列表为无操作（返回同一引用）', () => {
    const doc = revisionDoc();
    expect(acceptRevisions(doc, [])).toBe(doc);
    expect(rejectRevisions(doc, [])).toBe(doc);
  });

  it('视图投影与接受 / 拒绝一致', () => {
    const doc = revisionDoc();
    expect(plainText(projectRevisionView(doc, REVISION_VIEWS.FINAL))).toBe('保留新增格式尾部');
    expect(plainText(projectRevisionView(doc, REVISION_VIEWS.ORIGINAL))).toBe('保留删除格式尾部');
    expect(projectRevisionView(doc, REVISION_VIEWS.MARKED)).toBe(doc);
  });

  it('整段被删除时连块移除，不留空段落', () => {
    const doc = createEmptyDocument({ title: '整块' });
    doc.root.children = [
      {
        type: NODE_TYPES.PARAGRAPH,
        children: [text('整段删除', [{ type: MARK_TYPES.DELETION, attrs: { changeId: 'c1' } }])],
      },
      { type: NODE_TYPES.PARAGRAPH, children: [text('保留段')] },
    ];
    const accepted = acceptRevisions(doc);
    expect(accepted.root.children).toHaveLength(1);
    expect(plainText(accepted)).toBe('保留段');
  });
});
