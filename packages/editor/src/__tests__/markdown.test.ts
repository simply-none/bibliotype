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

describe('Markdown 脚注语法', () => {
  it('引用转上标 noteref，定义转紧跟段落的脚注块', () => {
    const blocks = markdownToNodes('子曰[^1]。\n\n[^1]: 习，鸟数飞也。', schema);

    expect(blocks.map((b) => b.type.name)).toEqual([
      NODE_TYPES.PARAGRAPH,
      NODE_TYPES.FOOTNOTE,
    ]);
    const runs = inlineOf(blocks[0] ?? schema.node(NODE_TYPES.PARAGRAPH, null));
    expect(runs.map((r) => r.text)).toEqual(['子曰', '1', '。']);
    const ref = blocks[0]?.child(1);
    expect(ref?.marks.map((m) => m.type.name)).toContain('noteref');
    expect(ref?.marks[0]?.attrs).toMatchObject({
      targetId: 'note-footnote-1',
      refId: 'ref-footnote-1',
    });

    const note = blocks[1];
    expect(note?.attrs).toMatchObject({
      marker: '1',
      id: 'note-footnote-1',
      refId: 'ref-footnote-1',
    });
    expect(note?.textContent).toBe('习，鸟数飞也。');
  });

  it('同一标签多次引用各有锚点，注文只插一次', () => {
    const blocks = markdownToNodes('甲[^a]乙[^a]。\n\n[^a]: 注文', schema);
    const refs: string[] = [];
    blocks[0]?.forEach((child) => {
      if (child.marks.some((m) => m.type.name === 'noteref')) {
        const attrs = child.marks.find((m) => m.type.name === 'noteref')?.attrs;
        refs.push(String(attrs?.['refId']));
      }
    });

    expect(refs).toEqual(['ref-footnote-1', 'ref-footnote-1-2']);
    expect(blocks.filter((b) => b.type.name === NODE_TYPES.FOOTNOTE)).toHaveLength(1);
  });

  it('未定义的引用按字面文本保留，不产生空注', () => {
    const blocks = markdownToNodes('见[^x]。', schema);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.textContent).toBe('见[^x]。');
    expect(blocks.filter((b) => b.type.name === NODE_TYPES.FOOTNOTE)).toHaveLength(0);
  });

  it('折行的定义并入同一条注文', () => {
    const blocks = markdownToNodes('正文[^1]\n\n[^1]: 第一行\n    第二行', schema);
    const note = blocks.find((b) => b.type.name === NODE_TYPES.FOOTNOTE);
    expect(note?.textContent).toBe('第一行 第二行');
  });

  it('未被引用的定义落到文末，不静默丢内容', () => {
    const blocks = markdownToNodes('正文\n\n[^9]: 孤注', schema);
    expect(blocks.map((b) => b.type.name)).toEqual([
      NODE_TYPES.PARAGRAPH,
      NODE_TYPES.FOOTNOTE,
    ]);
    expect(blocks[1]?.attrs?.['marker']).toBe('1');
    expect(blocks[1]?.textContent).toBe('孤注');
  });

  it('围栏代码块内的定义行不当脚注解析', () => {
    const blocks = markdownToNodes('```\n[^1]: 代码里的行\n```', schema);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.type.name).toBe(NODE_TYPES.CODE_BLOCK);
    expect(blocks[0]?.textContent).toContain('[^1]: 代码里的行');
  });

  it('含脚注引用的文本判为 Markdown', () => {
    expect(looksLikeMarkdown('正文[^1]')).toBe(true);
    expect(looksLikeMarkdown('[^1]: 注文')).toBe(true);
  });
});
