// @vitest-environment happy-dom
/**
 * 标准 HTML → PM 结构解析测试（扩充后的 parseDOM 行为，happy-dom 环境）
 *
 * 覆盖方案 A 的核心承诺：外部标准 HTML（p / h1-6 / ul / ol / li / blockquote /
 * pre / hr / strong / em / a / img）能被 schema 的 parseDOM 规则正确映射。
 */
import { NODE_TYPES } from '@bibliotype/core';
import { DOMParser, type Fragment, type Node as PmNode } from 'prosemirror-model';
import { describe, expect, it } from 'vitest';
import { buildEditorSchema } from '../default-schema.js';

const schema = buildEditorSchema();
const parser = DOMParser.fromSchema(schema);

/** 将一段 HTML 解析为块级节点数组 */
function parseHtml(html: string): PmNode[] {
  const container = document.createElement('div');
  container.innerHTML = html;
  const slice = parser.parseSlice(container, { preserveWhitespace: false });
  const nodes: PmNode[] = [];
  slice.content.forEach((node) => nodes.push(node));
  return nodes;
}

/** 深度优先收集带某标记的文本段 */
function textsWithMark(nodes: readonly PmNode[], markName: string): Array<{ text: string; marks: readonly string[] }> {
  const hits: Array<{ text: string; marks: readonly string[] }> = [];
  const walk = (node: PmNode): void => {
    node.forEach((child) => {
      if (child.isText && child.marks.some((m) => m.type.name === markName)) {
        hits.push({ text: child.text ?? '', marks: child.marks.map((m) => m.type.name) });
      } else {
        walk(child);
      }
    });
  };
  nodes.forEach(walk);
  return hits;
}

describe('标准 HTML parseDOM', () => {
  it('<p> → paragraph', () => {
    const [p] = parseHtml('<p>正文内容</p>');
    expect(p?.type.name).toBe(NODE_TYPES.PARAGRAPH);
    expect(p?.textContent).toBe('正文内容');
  });

  it('<h2> → heading(level=2)', () => {
    const [h] = parseHtml('<h2>章名</h2>');
    expect(h?.type.name).toBe(NODE_TYPES.HEADING);
    expect(h?.attrs.level).toBe(2);
  });

  it('<ul><li> → list(ordered=false) + 段落化的 list-item', () => {
    const [list] = parseHtml('<ul><li>甲</li><li>乙</li></ul>');
    expect(list?.type.name).toBe(NODE_TYPES.LIST);
    expect(list?.attrs.ordered).toBe(false);
    expect(list?.childCount).toBe(2);
    expect(list?.firstChild?.type.name).toBe(NODE_TYPES.LIST_ITEM);
    expect(list?.firstChild?.textContent).toBe('甲');
  });

  it('<ol> → list(ordered=true)', () => {
    const [list] = parseHtml('<ol><li>一</li></ol>');
    expect(list?.type.name).toBe(NODE_TYPES.LIST);
    expect(list?.attrs.ordered).toBe(true);
  });

  it('<blockquote> → quote', () => {
    const [q] = parseHtml('<blockquote>引文</blockquote>');
    expect(q?.type.name).toBe(NODE_TYPES.QUOTE);
    expect(q?.textContent).toBe('引文');
  });

  it('<hr> → break(variant=hr)', () => {
    const [brk] = parseHtml('<hr>');
    expect(brk?.type.name).toBe(NODE_TYPES.BREAK);
    expect(brk?.attrs.variant).toBe('hr');
  });

  it('<pre> → code-block', () => {
    const [code] = parseHtml('<pre><code>x = 1;</code></pre>');
    expect(code?.type.name).toBe(NODE_TYPES.CODE_BLOCK);
    expect(code?.textContent).toContain('x = 1;');
  });

  it('<strong> / <em> / <a href> → 对应标记', () => {
    const nodes = parseHtml('<p><strong>粗</strong><em>斜</em><a href="https://x.com">站</a></p>');
    expect(textsWithMark(nodes, 'strong').some((r) => r.text === '粗')).toBe(true);
    expect(textsWithMark(nodes, 'emphasis').some((r) => r.text === '斜')).toBe(true);
    const linkRun = textsWithMark(nodes, 'link').find((r) => r.text === '站');
    expect(linkRun).toBeDefined();
  });

  it('<img> → image(src/alt)', () => {
    const nodes: Fragment = DOMParser.fromSchema(schema).parseSlice(
      Object.assign(document.createElement('div'), { innerHTML: '<img src="/a.png" alt="图">' }),
      { preserveWhitespace: false },
    ).content;
    let image: PmNode | undefined;
    nodes.forEach((n) => {
      if (n.type.name === NODE_TYPES.IMAGE) image = n;
    });
    expect(image?.attrs.src).toBe('/a.png');
    expect(image?.attrs.alt).toBe('图');
  });
});
