/**
 * F6 front-matter：YAML 子集解析、正文剥离、显式 metadata 优先
 */
import { NODE_TYPES, createEmptyDocument } from '@bibliotype/core';
import { buildEditorSchema } from '@bibliotype/editor';
import { describe, expect, it } from 'vitest';
import { markdownToBookDocument } from '../from-markdown.js';
import { parseFrontMatter } from '../front-matter.js';

const schema = buildEditorSchema();

describe('parseFrontMatter', () => {
  it('解析标量字段并剥离正文', () => {
    const result = parseFrontMatter(
      '---\ntitle: 论语注\nauthor: 朱熹, 何晏\nlanguage: zh-Hant\ndate: 2020\n---\n# 学而',
    );
    expect(result.metadata.title).toBe('论语注');
    expect(result.metadata.contributors?.map((item) => item.name)).toEqual(['朱熹', '何晏']);
    expect(result.metadata.language).toBe('zh-Hant');
    expect(result.metadata.publication?.year).toBe('2020');
    expect(result.body).toBe('# 学而');
  });

  it('支持块级列表作者与引号', () => {
    const result = parseFrontMatter(
      '---\ntitle: "诗集"\nauthors:\n  - 王维\n  - 孟浩然\n---\n正文',
    );
    expect(result.metadata.title).toBe('诗集');
    expect(result.metadata.contributors?.map((item) => item.name)).toEqual(['王维', '孟浩然']);
    expect(result.body).toBe('正文');
  });

  it('无 front-matter 时原样返回', () => {
    const text = '# 标题\n\n正文';
    expect(parseFrontMatter(text)).toEqual({ metadata: {}, body: text });
  });

  it('未闭合的 --- 不当作 front-matter', () => {
    const text = '---\ntitle: 无闭合\n正文';
    expect(parseFrontMatter(text)).toEqual({ metadata: {}, body: text });
  });
});

describe('markdownToBookDocument 合并 front-matter', () => {
  it('front-matter 补位元数据', () => {
    const doc = markdownToBookDocument(
      '---\ntitle: 论语注\nauthor: 朱熹\n---\n# 学而',
      schema,
      { title: '' },
    );
    expect(doc.metadata.title).toBe('论语注');
    expect(doc.metadata.contributors?.[0]?.name).toBe('朱熹');
    expect(doc.root.children?.[0]?.type).toBe(NODE_TYPES.HEADING);
  });

  it('调用方显式书名优先', () => {
    const doc = markdownToBookDocument(
      '---\ntitle: front-matter 书名\n---\n正文',
      schema,
      { title: '显式书名' },
    );
    expect(doc.metadata.title).toBe('显式书名');
  });

  it('正文不残留分隔头', () => {
    const doc = markdownToBookDocument('---\ntitle: T\n---\n第一段', schema, createEmptyDocument({ title: 'T' }).metadata);
    const first = doc.root.children?.[0];
    expect(first?.type).toBe(NODE_TYPES.PARAGRAPH);
    expect(first?.children?.[0]?.text ?? '').toBe('第一段');
  });
});
