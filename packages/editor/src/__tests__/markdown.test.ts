/**
 * Markdown 转换层测试（纯函数，node 环境）
 */
import { NODE_TYPES } from '@bibliotype/core';
import type { Node as PmNode } from 'prosemirror-model';
import { describe, expect, it } from 'vitest';
import { buildEditorSchema } from '../default-schema.js';
import { looksLikeMarkdown, markdownToFragment, markdownToNodes } from '../markdown.js';

const schema = buildEditorSchema();

/** 按行内文本与标记名拼出可读结构，便于断言 */
function inlineOf(node: PmNode): Array<{ text: string; marks: string[] }> {
  const runs: Array<{ text: string; marks: string[] }> = [];
  node.forEach((child) => {
    if (child.isText) {
      runs.push({ text: child.text ?? '', marks: child.marks.map((m) => m.type.name) });
    }
  });
  return runs;
}

describe('looksLikeMarkdown', () => {
  it('普通句子不含 Markdown 特征', () => {
    expect(looksLikeMarkdown('子曰：学而时习之，不亦说乎')).toBe(false);
    expect(looksLikeMarkdown('')).toBe(false);
  });

  it('标题 / 列表 / 粗体 / 链接等均判为 Markdown', () => {
    expect(looksLikeMarkdown('# 标题')).toBe(true);
    expect(looksLikeMarkdown('- 项目一\n- 项目二')).toBe(true);
    expect(looksLikeMarkdown('这是**重点**内容')).toBe(true);
    expect(looksLikeMarkdown('[链接](https://example.com)')).toBe(true);
  });
});

describe('markdownToNodes 块级结构', () => {
  it('标题解析为 heading 并带 level', () => {
    const [h] = markdownToNodes('## 学而第一', schema);
    expect(h?.type.name).toBe(NODE_TYPES.HEADING);
    expect(h?.attrs.level).toBe(2);
    expect(h?.textContent).toBe('学而第一');
  });

  it('空行分段产出多个段落', () => {
    const blocks = markdownToNodes('第一段\n\n第二段', schema);
    expect(blocks).toHaveLength(2);
    expect(blocks.every((b) => b.type.name === NODE_TYPES.PARAGRAPH)).toBe(true);
  });

  it('软换行合并进同一段落', () => {
    const blocks = markdownToNodes('行一\n行二', schema);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.textContent).toBe('行一 行二');
  });

  it('无序列表产出 list(ordered=false) + list-item', () => {
    const [list] = markdownToNodes('- 甲\n- 乙', schema);
    expect(list?.type.name).toBe(NODE_TYPES.LIST);
    expect(list?.attrs.ordered).toBe(false);
    expect(list?.childCount).toBe(2);
    expect(list?.firstChild?.type.name).toBe(NODE_TYPES.LIST_ITEM);
    expect(list?.firstChild?.textContent).toBe('甲');
  });

  it('有序列表 ordered=true', () => {
    const [list] = markdownToNodes('1. 甲\n2. 乙', schema);
    expect(list?.type.name).toBe(NODE_TYPES.LIST);
    expect(list?.attrs.ordered).toBe(true);
  });

  it('引用块产出 quote 包裹段落', () => {
    const [quote] = markdownToNodes('> 引文内容', schema);
    expect(quote?.type.name).toBe(NODE_TYPES.QUOTE);
    expect(quote?.firstChild?.type.name).toBe(NODE_TYPES.PARAGRAPH);
    expect(quote?.textContent).toBe('引文内容');
  });

  it('围栏代码块产出 code-block（纯文本、无标记）', () => {
    const [code] = markdownToNodes('```js\nconst a = 1;\n```', schema);
    expect(code?.type.name).toBe(NODE_TYPES.CODE_BLOCK);
    expect(code?.attrs.language).toBe('js');
    expect(code?.textContent).toBe('const a = 1;');
  });

  it('分隔线产出 break(variant=hr)', () => {
    const [brk] = markdownToNodes('---', schema);
    expect(brk?.type.name).toBe(NODE_TYPES.BREAK);
    expect(brk?.attrs.variant).toBe('hr');
  });

  it('独占一行图片产出 image（src/alt）', () => {
    const [img] = markdownToNodes('![封面](/a.png)', schema);
    expect(img?.type.name).toBe(NODE_TYPES.IMAGE);
    expect(img?.attrs.src).toBe('/a.png');
    expect(img?.attrs.alt).toBe('封面');
  });
});

describe('markdownToNodes 行内标记', () => {
  it('粗体 / 斜体 / 删除线 / 行内码 / 链接映射到对应标记', () => {
    const [p] = markdownToNodes('**粗** *斜* ~~删~~ `码` [站](https://x.com)', schema);
    expect(p?.type.name).toBe(NODE_TYPES.PARAGRAPH);
    const runs = inlineOf(p ?? schema.node(NODE_TYPES.PARAGRAPH, null));
    const byText = new Map(runs.map((r) => [r.text, r.marks]));
    expect(byText.get('粗')).toContain('strong');
    expect(byText.get('斜')).toContain('emphasis');
    expect(byText.get('删')).toContain('strikethrough');
    expect(byText.get('码')).toContain('code');
    expect(byText.get('站')).toContain('link');
  });

  it('粗体内嵌套斜体叠加两个标记', () => {
    const [p] = markdownToNodes('**粗 *斜* 体**', schema);
    const runs = inlineOf(p ?? schema.node(NODE_TYPES.PARAGRAPH, null));
    expect(
      runs.some((r) => r.text === '斜' && r.marks.includes('strong') && r.marks.includes('emphasis')),
    ).toBe(true);
  });
});

describe('markdownToFragment', () => {
  it('产出非空 Fragment，块节点数与 markdownToNodes 一致', () => {
    const text = '# 标题\n\n正文**重点**';
    const fragment = markdownToFragment(text, schema);
    expect(fragment.childCount).toBe(markdownToNodes(text, schema).length);
    expect(fragment.childCount).toBeGreaterThan(0);
  });
});
