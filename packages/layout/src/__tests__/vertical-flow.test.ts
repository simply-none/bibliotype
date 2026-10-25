/**
 * 直排行内流批 2 纯函数测试
 *
 * 覆盖：行款规则解析与收敛（line-rules）、双行夹注拆分与占位折算
 * （double-note-split：n 字占 n/2 字位、回行缩格、长注多对）、行内流
 * 序列化（vertical-flow：段落行内化 / 低格 / 抬头断列 / 夹注双列盒 /
 * 标题不连排）。
 */
import { describe, expect, it } from 'vitest';
import { NODE_TYPES, type Attrs, type BookNode } from '@bibliotype/core';
import { resolveLineRule, lineRuleOverhead, NO_LINE_RULE } from '../line-rules.js';
import {
  splitDoubleNoteLines,
  doubleNotePlaceholderChars,
  collectNodeTextOf,
} from '../double-note-split.js';
import { serializeVerticalFlow } from '../html/vertical-flow.js';

describe('resolveLineRule（行款规则解析）', () => {
  it('未设置行款属性 → 全缺省', () => {
    const rule = resolveLineRule({ type: NODE_TYPES.PARAGRAPH, children: [] });
    expect(rule).toEqual({ ...NO_LINE_RULE, liftLevel: 1 });
    expect(rule.indentChars).toBe(0);
    expect(rule.lift).toBe('none');
    expect(rule.breakLine).toBe(false);
  });

  it('低格 / 抬头 / 提行读取正确，非法值收敛', () => {
    const lifted = resolveLineRule({
      type: NODE_TYPES.PARAGRAPH,
      attrs: { indent: 2, lift: 'newline', liftLevel: 3 },
      children: [],
    });
    expect(lifted.indentChars).toBe(2);
    expect(lifted.lift).toBe('newline');
    expect(lifted.liftLevel).toBe(3);
    const rule = resolveLineRule({
      type: NODE_TYPES.PARAGRAPH,
      attrs: { indent: 9, lift: 'weird', liftLevel: 0, breakLine: true },
      children: [],
    });
    expect(rule.indentChars).toBe(4); // 夹紧 0~4
    expect(rule.lift).toBe('none'); // 非法形态收敛
    expect(rule.liftLevel).toBe(1);
    expect(rule.breakLine).toBe(true);
  });

  it('估算折算：低格 + 挪抬占首行字位；提行 / 平抬另起新列', () => {
    expect(lineRuleOverhead({ indentChars: 2, lift: 'none', liftLevel: 1, breakLine: false }))
      .toEqual({ firstLineIndentChars: 2, startsNewLine: false });
    expect(lineRuleOverhead({ indentChars: 1, lift: 'space', liftLevel: 1, breakLine: false }))
      .toEqual({ firstLineIndentChars: 2, startsNewLine: false });
    expect(lineRuleOverhead({ indentChars: 0, lift: 'newline', liftLevel: 2, breakLine: false }))
      .toEqual({ firstLineIndentChars: 0, startsNewLine: true });
    expect(lineRuleOverhead({ indentChars: 0, lift: 'none', liftLevel: 1, breakLine: true }))
      .toEqual({ firstLineIndentChars: 0, startsNewLine: true });
  });
});

describe('splitDoubleNoteLines（夹注拆分）', () => {
  it('短注（≤ 每子列容量）：一对两列，n 字占 ceil(n/2) 字位', () => {
    /* 容量 10 小字/列：6 字 → 右 6 左空，占 3 字位 */
    expect(splitDoubleNoteLines('六字夹注', 10)).toEqual([['六字夹注', '']]);
    expect(doubleNotePlaceholderChars(6)).toBe(3);
  });

  it('长注按容量切多对：右列先满、左列续，对序即阅读序', () => {
    /* 容量 3：12 字 → 4 对全满 */
    const pairs = splitDoubleNoteLines('一二三四五六七八九十甲乙', 3);
    expect(pairs).toEqual([
      ['一二三', '四五六'],
      ['七八九', '十甲乙'],
    ]);
  });

  it('回行缩格：首对右列留空一位（夹注起于行中、注首低一格）', () => {
    const pairs = splitDoubleNoteLines('一二三四五六七', 3, { indentFirstPair: true });
    expect(pairs[0]).toEqual(['一二', '']);
    expect(pairs[1]).toEqual(['三四五', '六七']);
  });

  it('空注：一对空列占位；聚合文本与 node-slice 同口径', () => {
    expect(splitDoubleNoteLines('', 5)).toEqual([['', '']]);
    const note: BookNode = {
      type: 'double-note',
      children: [{ type: 'text', text: '甲' }, { type: 'text', text: '乙' }],
    };
    expect(collectNodeTextOf(note)).toBe('甲乙');
  });
});

describe('serializeVerticalFlow（行内流序列化）', () => {
  /** 简单段落构造（显式类型消解联合推断歧义） */
  const para = (text: string, attrs?: Attrs): BookNode => {
    const node: BookNode = {
      type: NODE_TYPES.PARAGRAPH,
      children: [{ type: 'text', text }],
    };
    if (attrs !== undefined) node.attrs = { ...attrs };
    return node;
  };

  it('段落行内化（bt-vpara），无行款时零额外标记', () => {
    const html = serializeVerticalFlow([para('正文')], { charsPerColumn: 10 });
    expect(html).toBe('<span class="bt-vpara">正文</span>');
  });

  it('低格 → 段首空位盒（N 字位高，列首列中语义一致）；挪抬并入空位', () => {
    const html = serializeVerticalFlow([para('引文', { indent: 2 })], { charsPerColumn: 10 });
    expect(html).toContain('<span class="bt-vpad" data-n="2"></span><span class="bt-vpara">引文</span>');
    const nuota = serializeVerticalFlow([para('圣朝', { lift: 'space' })], { charsPerColumn: 10 });
    expect(nuota).toContain('<span class="bt-vpad" data-n="1"></span>');
  });

  it('提行 / 平抬 → 断列 br；抬升 → 列首空位盒（data-n）', () => {
    const breakHtml = serializeVerticalFlow([para('另起', { breakLine: true })], { charsPerColumn: 10 });
    expect(breakHtml).toContain('<br class="bt-vbreak"><span class="bt-vpara">');
    const lift = serializeVerticalFlow(
      [para('天恩', { lift: 'newline', liftLevel: 3 })],
      { charsPerColumn: 10 },
    );
    expect(lift).toContain('<br class="bt-vbreak">');
    expect(lift).toContain('<span class="bt-vpad" data-n="3"></span>');
  });

  it('段内双行夹注 → 1 字位宽整列高固定双列盒（右列先读，attrs 透传）', () => {
    const withNote: BookNode = {
      type: NODE_TYPES.PARAGRAPH,
      children: [
        { type: 'text', text: '经' },
        { type: 'double-note', attrs: { kind: 'jiaozhu' }, children: [{ type: 'text', text: '注六字' }] },
      ],
    };
    const html = serializeVerticalFlow([withNote], { charsPerColumn: 10 });
    expect(html).toContain('<span class="bt-vpara">经');
    /* 容量 10 大字 → 每子列 20 小字：6 字 → 右 6 左空 */
    expect(html).toContain('<span class="bt-vnote" data-kind="jiaozhu"><span class="bt-vnote-col">注六字</span><span class="bt-vnote-col"></span></span>');
  });

  it('标题不连排（原样整块输出），多段落片段相续', () => {
    const heading: BookNode = {
      type: NODE_TYPES.HEADING,
      attrs: { level: 2 },
      children: [{ type: 'text', text: '学而第一' }],
    };
    const html = serializeVerticalFlow([heading, para('甲'), para('乙')], { charsPerColumn: 10 });
    expect(html).toContain('<h2 class="bt-heading" data-level="2">学而第一</h2>');
    /* 两段在同一个行内流里相续（无块级边界） */
    expect(html).toContain('甲</span><span class="bt-vpara">乙');
  });
});
