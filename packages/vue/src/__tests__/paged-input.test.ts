/**
 * 分页输入路由测试（input-router：DOM 片段字符定位 + IME 差分 + caret 归属）
 *
 * diffTextReplace / blockFragments / resolveCaretTarget 为纯逻辑；
 * charOffsetInFrag / domPosInFrag / fragPlainText 依 DOM（happy-dom 提供）。
 */
import { describe, expect, it } from 'vitest';
import type { MeasurableBlock } from '@bibliotype/layout';
import type { BookNode } from '@bibliotype/core';
import { NODE_TYPES } from '@bibliotype/core';
import { buildPagedIndex } from '../paged-editor/selection-bridge.js';
import {
  blockFragments,
  charOffsetInFrag,
  diffTextReplace,
  domPosInFrag,
  fragPlainText,
  fragStartChar,
  resolveCaretTarget,
} from '../paged-editor/input-router.js';
import type { PagedFragment, PagedPage } from '../paged-editor/use-paged-layout.js';

/** 造一个非文本叶节点（段落含文字），供片段复用 */
function para(text: string): BookNode {
  return { type: NODE_TYPES.PARAGRAPH, id: 'x', children: [{ type: 'text', text }] };
}

describe('input-router 纯逻辑', () => {
  const blocks = [{ id: 'p-0', mainSize: 10 }, { id: 'p-1', mainSize: 10 }] as MeasurableBlock[];
  const lineOffsets = new Map<string, number[]>([['p-1', [0, 10, 20, 30]]]);
  const index = buildPagedIndex(blocks, [3, 40], lineOffsets);

  it('fragStartChar：整块为 0，续排取行首偏移', () => {
    const loc = index.byId.get('p-1');
    expect(fragStartChar({ blockId: 'p-1', node: para('a'), fromLine: 0, lineCount: 0 }, loc, 10)).toBe(0);
    expect(fragStartChar({ blockId: 'p-1', node: para('a'), fromLine: 2, lineCount: 2 }, loc, 10)).toBe(20);
  });

  it('blockFragments：按页序列出片段与起始字符', () => {
    const pages: PagedPage[] = [
      { index: 0, firstBlockId: 'p-1', fragments: [{ blockId: 'p-1', node: para('ab'), fromLine: 0, lineCount: 2 } as PagedFragment] },
      { index: 1, firstBlockId: 'p-1', fragments: [{ blockId: 'p-1', node: para('cd'), fromLine: 2, lineCount: 2 } as PagedFragment] },
    ];
    const loc = index.byId.get('p-1');
    const list = blockFragments(pages, 'p-1', loc, 10);
    expect(list).toHaveLength(2);
    expect(list[0]?.startChar).toBe(0);
    expect(list[1]?.startChar).toBe(20);
  });

  it('resolveCaretTarget：块内字符命中所在页片段与局部偏移', () => {
    const pages: PagedPage[] = [
      { index: 0, firstBlockId: 'p-1', fragments: [{ blockId: 'p-1', node: para('ab'), fromLine: 0, lineCount: 2 } as PagedFragment] },
      { index: 1, firstBlockId: 'p-1', fragments: [{ blockId: 'p-1', node: para('cd'), fromLine: 2, lineCount: 2 } as PagedFragment] },
    ];
    expect(resolveCaretTarget(pages, index, 10, 'p-1', 25)).toEqual({
      pageIndex: 1,
      blockId: 'p-1',
      fromLine: 2,
      localChar: 5,
    });
    expect(resolveCaretTarget(pages, index, 10, 'p-1', 5)?.pageIndex).toBe(0);
    expect(resolveCaretTarget(pages, index, 10, 'nope', 5)).toBeNull();
  });

  it('diffTextReplace：公共前后缀求最小替换窗口', () => {
    expect(diffTextReplace('子曰学而', '子曰而时习之')).toEqual({ from: 2, to: 4, text: '而时习之' });
    expect(diffTextReplace('abc', 'abc')).toEqual({ from: 3, to: 3, text: '' });
    expect(diffTextReplace('', '注入')).toEqual({ from: 0, to: 0, text: '注入' });
    expect(diffTextReplace('删除abc', '删除')).toEqual({ from: 2, to: 5, text: '' });
    expect(diffTextReplace('子曰学而时习之', '子曰学而时习')).toEqual({ from: 6, to: 7, text: '' });
  });
});

describe('input-router DOM 定位', () => {
  function makeFrag(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'bt-paged-frag';
    el.dataset.blockId = 'p-1';
    el.dataset.fromLine = '0';
    // 多文本节点（模拟 marks）：子 | 曰 | 学
    el.innerHTML = '<span>子曰</span><b>学</b>而时习之';
    return el;
  }

  it('fragPlainText：拼接子树文本节点', () => {
    expect(fragPlainText(makeFrag())).toBe('子曰学而时习之');
  });

  it('charOffsetInFrag ⇄ domPosInFrag 往返', () => {
    const el = makeFrag();
    // 全局偏移 3 = '子曰学'(3 字符) 之后 → '而时习之' 文本节点内 0
    const pos = domPosInFrag(el, 3);
    expect(pos).not.toBeNull();
    const back = charOffsetInFrag(el, pos!.container, pos!.offset);
    expect(back).toBe(3);
  });

  it('charOffsetInFrag：片段外容器返回 null', () => {
    const el = makeFrag();
    const outside = document.createElement('div');
    expect(charOffsetInFrag(el, outside, 0)).toBeNull();
  });

  it('domPosInFrag：越界钳到末文本节点末尾', () => {
    const el = makeFrag();
    const pos = domPosInFrag(el, 999);
    expect(pos).not.toBeNull();
    expect(charOffsetInFrag(el, pos!.container, pos!.offset)).toBeLessThanOrEqual(7);
  });
});
