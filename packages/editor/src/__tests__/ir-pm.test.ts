/**
 * IR ⇄ ProseMirror 转换测试（含无损往返）
 */
import { describe, expect, it } from 'vitest';
import { MARK_TYPES, NODE_TYPES, type BookNode } from '@bibliotype/core';
import { buildEditorSchema } from '../default-schema.js';
import { irNodeToPm } from '../ir-to-pm.js';
import { pmNodeToIr } from '../pm-to-ir.js';

/** 构造样本文档树（《论语·学而》）：含 id、标题、标记、未知属性 */
function sampleRoot(): BookNode {
  return {
    type: NODE_TYPES.BOOK,
    children: [
      {
        type: NODE_TYPES.VOLUME,
        id: 'vol-1',
        attrs: { title: '卷一', custom: 'extra-val' }, // custom 未声明 → rawAttrs
        children: [
          {
            type: NODE_TYPES.CHAPTER,
            id: 'chap-1',
            attrs: { title: '学而第一' },
            children: [
              {
                type: NODE_TYPES.HEADING,
                id: 'h-1',
                children: [{ type: 'text', text: '学而第一' }],
              },
              {
                type: NODE_TYPES.PARAGRAPH,
                id: 'p-1',
                children: [
                  { type: 'text', text: '子曰：' },
                  {
                    type: 'text',
                    text: '学而时习之',
                    marks: [{ type: MARK_TYPES.STRONG }],
                  },
                  { type: 'text', text: '，不亦说乎？' },
                  {
                    type: 'text',
                    text: '（《论语》）',
                    marks: [{ type: MARK_TYPES.LINK, attrs: { href: 'https://example.com' } }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

describe('irNodeToPm', () => {
  it('基本结构转换（type / id / title / textContent）', () => {
    const schema = buildEditorSchema();
    const pm = irNodeToPm(sampleRoot(), schema);

    expect(pm.type.name).toBe(NODE_TYPES.BOOK);
    const volume = pm.child(0);
    expect(volume.type.name).toBe(NODE_TYPES.VOLUME);
    expect(volume.attrs.id).toBe('vol-1');
    expect(volume.attrs.title).toBe('卷一');
    expect(pm.textContent).toBe('学而第一子曰：学而时习之，不亦说乎？（《论语》）');
  });

  it('未声明属性打包进 rawAttrs', () => {
    const schema = buildEditorSchema();
    const pm = irNodeToPm(sampleRoot(), schema);
    expect(pm.child(0).attrs.rawAttrs).toEqual({ custom: 'extra-val' });
  });

  it('文本标记映射为 PM marks（strong / link href）', () => {
    const schema = buildEditorSchema();
    const pm = irNodeToPm(sampleRoot(), schema);
    const paragraph = pm.child(0).child(0).child(1);

    expect(paragraph.child(0).marks).toHaveLength(0);
    expect(paragraph.child(1).marks[0]?.type.name).toBe(MARK_TYPES.STRONG);
    expect(paragraph.child(3).marks[0]?.attrs.href).toBe('https://example.com');
  });

  it('未注册的节点 / 标记类型抛出 RangeError', () => {
    const schema = buildEditorSchema();
    expect(() => irNodeToPm({ type: 'classical:jiaozhu', children: [] }, schema)).toThrow(
      RangeError,
    );
    expect(() =>
      irNodeToPm(
        {
          type: NODE_TYPES.PARAGRAPH,
          children: [{ type: 'text', text: 'x', marks: [{ type: 'unknown-mark' }] }],
        },
        schema,
      ),
    ).toThrow(RangeError);
  });

  it('空文本叶子被规范化跳过', () => {
    const schema = buildEditorSchema();
    const pm = irNodeToPm(
      { type: NODE_TYPES.PARAGRAPH, children: [{ type: 'text', text: '' }] },
      schema,
    );
    expect(pm.childCount).toBe(0);
  });

  it('块容器内的行内内容聚合为段落（IR 宽松树 → PM 严格树）', () => {
    const schema = buildEditorSchema();
    const pm = irNodeToPm(
      {
        type: NODE_TYPES.QUOTE,
        children: [
          { type: 'text', text: '注文一' },
          { type: NODE_TYPES.PARAGRAPH, children: [{ type: 'text', text: '既有段落' }] },
          { type: 'text', text: '注文二' },
        ],
      },
      schema,
    );

    expect(pm.childCount).toBe(3);
    expect(pm.child(0).type.name).toBe(NODE_TYPES.PARAGRAPH);
    expect(pm.child(0).textContent).toBe('注文一');
    expect(pm.child(1).textContent).toBe('既有段落');
    expect(pm.child(2).type.name).toBe(NODE_TYPES.PARAGRAPH);
    expect(pm.child(2).textContent).toBe('注文二');

    const round = pmNodeToIr(pm);
    expect(round.children?.[0]?.type).toBe(NODE_TYPES.PARAGRAPH);
  });
});

describe('往返（IR → PM → IR）', () => {
  it('复杂树深度一致（id / attrs / 未知属性 / marks 无损）', () => {
    const schema = buildEditorSchema();
    const root = sampleRoot();
    const round = pmNodeToIr(irNodeToPm(root, schema));
    expect(round).toEqual(root);
  });

  it('空 book 往返一致', () => {
    const schema = buildEditorSchema();
    const round = pmNodeToIr(irNodeToPm({ type: NODE_TYPES.BOOK, children: [] }, schema));
    expect(round).toEqual({ type: NODE_TYPES.BOOK });
  });

  it('heading 非默认 level 保留，显式默认值规范化为省略', () => {
    const schema = buildEditorSchema();

    const level3 = pmNodeToIr(
      irNodeToPm(
        { type: NODE_TYPES.HEADING, attrs: { level: 3 }, children: [{ type: 'text', text: 'x' }] },
        schema,
      ),
    );
    expect(level3.attrs).toEqual({ level: 3 });

    const level1 = pmNodeToIr(
      irNodeToPm(
        { type: NODE_TYPES.HEADING, attrs: { level: 1 }, children: [{ type: 'text', text: 'x' }] },
        schema,
      ),
    );
    expect(level1.attrs).toBeUndefined();
  });

  it('ruby 注文属性往返保留', () => {
    const schema = buildEditorSchema();
    const root: BookNode = {
      type: NODE_TYPES.PARAGRAPH,
      children: [
        {
          type: 'text',
          text: '子曰',
          marks: [{ type: MARK_TYPES.RUBY, attrs: { text: 'zǐ yuē' } }],
        },
      ],
    };
    expect(pmNodeToIr(irNodeToPm(root, schema))).toEqual(root);
  });
});
