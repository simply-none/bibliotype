/**
 * 注释节点契约：类型归属、角色映射、注码格式与全书编号扫描。
 */
import { describe, expect, it } from 'vitest';
import { NODE_TYPES } from '../ir/node-types.js';
import type { BookNode } from '../ir/nodes.js';
import {
  NOTE_LABEL_STYLES,
  NOTE_NODE_TYPES,
  NOTE_ROLES,
  collectNotes,
  formatNoteLabel,
  isNoteNode,
  isNoteNodeType,
  nextNoteIndex,
  noteRoleOf,
} from '../ir/notes.js';

function paragraph(text: string): BookNode {
  return { type: NODE_TYPES.PARAGRAPH, children: [{ type: NODE_TYPES.TEXT, text }] };
}

function note(type: string, text: string, attrs?: BookNode['attrs']): BookNode {
  return attrs === undefined
    ? { type, children: [paragraph(text)] }
    : { type, attrs, children: [paragraph(text)] };
}

function root(children: BookNode[]): BookNode {
  return { type: NODE_TYPES.BOOK, children };
}

describe('注释类型归属', () => {
  it('三种注释类型都登记在案，其他类型不算注释', () => {
    expect([...NOTE_NODE_TYPES]).toEqual([
      NODE_TYPES.FOOTNOTE,
      NODE_TYPES.ENDNOTE,
      NODE_TYPES.MARGIN_NOTE,
    ]);
    expect(isNoteNodeType(NODE_TYPES.FOOTNOTE)).toBe(true);
    expect(isNoteNodeType(NODE_TYPES.ENDNOTE)).toBe(true);
    expect(isNoteNodeType(NODE_TYPES.MARGIN_NOTE)).toBe(true);
    expect(isNoteNodeType(NODE_TYPES.PARAGRAPH)).toBe(false);
    expect(isNoteNodeType(NODE_TYPES.TEXT)).toBe(false);
  });

  it('isNoteNode 对文本叶子恒为 false', () => {
    expect(isNoteNode(note(NODE_TYPES.FOOTNOTE, '注文'))).toBe(true);
    expect(isNoteNode({ type: NODE_TYPES.FOOTNOTE, text: '伪注文' })).toBe(false);
    expect(isNoteNode(paragraph('正文'))).toBe(false);
  });

  it('角色映射到 EPUB 3 结构语义词汇（边注 → sidebar）', () => {
    expect(noteRoleOf(NODE_TYPES.FOOTNOTE)).toBe(NOTE_ROLES.FOOTNOTE);
    expect(noteRoleOf(NODE_TYPES.ENDNOTE)).toBe(NOTE_ROLES.ENDNOTE);
    expect(noteRoleOf(NODE_TYPES.MARGIN_NOTE)).toBe(NOTE_ROLES.MARGIN_NOTE);
    expect(NOTE_ROLES.MARGIN_NOTE).toBe('sidebar');
    expect(noteRoleOf(NODE_TYPES.PARAGRAPH)).toBeUndefined();
  });
});

describe('formatNoteLabel', () => {
  it('阿拉伯数字缺省，非法序号按 1 处理', () => {
    expect(formatNoteLabel(1)).toBe('1');
    expect(formatNoteLabel(12)).toBe('12');
    expect(formatNoteLabel(0)).toBe('1');
    expect(formatNoteLabel(-3)).toBe('1');
    expect(formatNoteLabel(Number.NaN)).toBe('1');
  });

  it('圈码 1~20，越界回退下标括号', () => {
    expect(formatNoteLabel(1, NOTE_LABEL_STYLES.CIRCLED)).toBe('①');
    expect(formatNoteLabel(20, NOTE_LABEL_STYLES.CIRCLED)).toBe('⑳');
    expect(formatNoteLabel(21, NOTE_LABEL_STYLES.CIRCLED)).toBe('(21)');
  });

  it('中文数字：个位、整十与两位数', () => {
    expect(formatNoteLabel(3, NOTE_LABEL_STYLES.CHINESE)).toBe('三');
    expect(formatNoteLabel(10, NOTE_LABEL_STYLES.CHINESE)).toBe('十');
    expect(formatNoteLabel(11, NOTE_LABEL_STYLES.CHINESE)).toBe('十一');
    expect(formatNoteLabel(21, NOTE_LABEL_STYLES.CHINESE)).toBe('二十一');
    expect(formatNoteLabel(100, NOTE_LABEL_STYLES.CHINESE)).toBe('100');
  });
});

describe('collectNotes', () => {
  it('按类型分别编号，缺省 id 由序号推导', () => {
    const tree = root([
      note(NODE_TYPES.FOOTNOTE, '脚注一'),
      note(NODE_TYPES.ENDNOTE, '尾注一'),
      note(NODE_TYPES.FOOTNOTE, '脚注二'),
      paragraph('正文'),
      note(NODE_TYPES.MARGIN_NOTE, '边注一'),
    ]);
    const entries = collectNotes(tree);

    expect(entries.map((entry) => entry.type)).toEqual([
      NODE_TYPES.FOOTNOTE,
      NODE_TYPES.ENDNOTE,
      NODE_TYPES.FOOTNOTE,
      NODE_TYPES.MARGIN_NOTE,
    ]);
    expect(entries.map((entry) => entry.index)).toEqual([1, 1, 2, 1]);
    expect(entries.map((entry) => entry.label)).toEqual(['1', '1', '2', '1']);
    expect(entries.map((entry) => entry.id)).toEqual([
      `note-${NODE_TYPES.FOOTNOTE}-1`,
      `note-${NODE_TYPES.ENDNOTE}-1`,
      `note-${NODE_TYPES.FOOTNOTE}-2`,
      `note-${NODE_TYPES.MARGIN_NOTE}-1`,
    ]);
  });

  it('节点自带 id 与手写注码优先，序号仍照常递增', () => {
    const tree = root([
      note(NODE_TYPES.FOOTNOTE, '甲', { marker: '*' }),
      { ...note(NODE_TYPES.FOOTNOTE, '乙'), id: 'fn-2' },
    ]);
    const entries = collectNotes(tree, { labelStyle: NOTE_LABEL_STYLES.CIRCLED });

    expect(entries[0]?.label).toBe('*');
    expect(entries[0]?.id).toBe(`note-${NODE_TYPES.FOOTNOTE}-1`);
    expect(entries[1]?.label).toBe('②');
    expect(entries[1]?.id).toBe('fn-2');
  });

  it('注释内部不再下钻（避免嵌套注释重复计数）', () => {
    const nested = note(NODE_TYPES.FOOTNOTE, '外层');
    nested.children?.push(note(NODE_TYPES.FOOTNOTE, '内层'));
    expect(collectNotes(root([nested]))).toHaveLength(1);
  });

  it('无注释返回空数组', () => {
    expect(collectNotes(root([paragraph('正文')]))).toEqual([]);
  });
});

describe('nextNoteIndex', () => {
  it('按同类型现存数量 + 1，非注释类型回退 1', () => {
    const tree = root([
      note(NODE_TYPES.FOOTNOTE, '甲'),
      note(NODE_TYPES.FOOTNOTE, '乙'),
      note(NODE_TYPES.ENDNOTE, '丙'),
    ]);
    expect(nextNoteIndex(tree, NODE_TYPES.FOOTNOTE)).toBe(3);
    expect(nextNoteIndex(tree, NODE_TYPES.ENDNOTE)).toBe(2);
    expect(nextNoteIndex(tree, NODE_TYPES.MARGIN_NOTE)).toBe(1);
    expect(nextNoteIndex(tree, NODE_TYPES.PARAGRAPH)).toBe(1);
  });
});
