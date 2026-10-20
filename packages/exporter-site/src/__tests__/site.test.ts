/**
 * 静态站点导出测试：分节规划、页面渲染、搜索索引、确定性与边界。
 */
import { describe, expect, it } from 'vitest';
import { createEmptyDocument } from '@bibliotype/core';
import type { BookDocument } from '@bibliotype/core';
import {
  DEFAULT_MAX_SECTIONS,
  buildSearchEntry,
  exportSite,
  normalizeSearchText,
  planSections,
  serializeSearchIndex,
} from '../index.js';

function text(value: string): { type: string; text: string } {
  return { type: 'text', text: value };
}

function buildDocument(): BookDocument {
  const document = createEmptyDocument({ title: '论语', language: 'zh-Hant' });
  document.root.children = [
    {
      id: 'ch1',
      type: 'chapter',
      children: [
        { type: 'heading', children: [text('学而篇')] },
        { id: 'p1', type: 'paragraph', children: [text('学而时习之')] },
      ],
    },
    {
      id: 'vol1',
      type: 'volume',
      children: [
        {
          id: 'ch2',
          type: 'chapter',
          children: [{ id: 'p2', type: 'paragraph', children: [text('为政以德')] }],
        },
      ],
    },
  ];
  return document;
}

describe('planSections', () => {
  it('有内容的结构节点成页，纯容器向下递归', () => {
    const plan = planSections(buildDocument());
    expect(plan.sections.map((item) => item.section.title)).toEqual(['学而篇', '为政以德']);
    expect(plan.sections.map((item) => item.section.path)).toEqual([
      'section-1.html',
      'section-2.html',
    ]);
    expect(plan.sections.map((item) => item.section.id)).toEqual(['ch1', 'ch2']);
    expect(plan.warnings).toEqual([]);
  });

  it('根下零散内容块合并为「正文」页', () => {
    const document = createEmptyDocument({ title: '无题' });
    document.root.children = [{ id: 'p1', type: 'paragraph', children: [text('片段')] }];
    const plan = planSections(document);
    expect(plan.sections).toHaveLength(1);
    expect(plan.sections[0]?.section.title).toBe('片段');
  });

  it('空文档产出告警', () => {
    const plan = planSections(createEmptyDocument({ title: '空' }));
    expect(plan.sections).toHaveLength(0);
    expect(plan.warnings[0]).toMatch(/没有可导出的内容/);
  });

  it('节点 id 重复时自动加后缀', () => {
    const document = createEmptyDocument({ title: '重复' });
    document.root.children = [
      { id: 'dup', type: 'chapter', children: [{ type: 'paragraph', children: [text('甲')] }] },
      { id: 'dup', type: 'chapter', children: [{ type: 'paragraph', children: [text('乙')] }] },
    ];
    const plan = planSections(document);
    expect(plan.sections.map((item) => item.section.id)).toEqual(['dup', 'dup-2']);
  });

  it('attrs.title 优先于正文推断', () => {
    const document = createEmptyDocument({ title: '标题' });
    document.root.children = [
      { id: 'c1', type: 'chapter', attrs: { title: '自定义标题' }, children: [{ type: 'paragraph', children: [text('正文')] }] },
    ];
    expect(planSections(document).sections[0]?.section.title).toBe('自定义标题');
  });
});

describe('exportSite', () => {
  it('生成页面 / 目录 / 样式 / 索引 / IR', () => {
    const result = exportSite(buildDocument());
    const paths = result.files.map((file) => file.path);
    expect(paths).toEqual(
      ['book.json', 'index.html', 'search-index.json', 'section-1.html', 'section-2.html', 'style.css'].sort(),
    );
    const page = result.files.find((file) => file.path === 'section-1.html')?.text ?? '';
    expect(page).toContain('<main class="bt-reader-page"');
    expect(page).toContain('学而时习之');
    expect(page).toContain('href="section-2.html"');
    expect(page).toContain('lang="zh-Hant"');

    const css = result.files.find((file) => file.path === 'style.css')?.text ?? '';
    expect(css).toContain('.bt-reader-page');
    expect(css).toContain('.bt-site-nav');
  });

  it('目录页按节序生成链接', () => {
    const result = exportSite(buildDocument());
    const index = result.files.find((file) => file.path === 'index.html')?.text ?? '';
    expect(index).toContain('href="section-1.html"');
    expect(index).toContain('学而篇');
    expect(index).toContain('href="section-2.html"');
  });

  it('搜索索引按 id 升序且含正文', () => {
    const result = exportSite(buildDocument());
    const raw = result.files.find((file) => file.path === 'search-index.json')?.text ?? '';
    const parsed = JSON.parse(raw) as { version: string; entries: { id: string; text: string }[] };
    expect(parsed.version).toBe('1.0.0');
    expect(parsed.entries.map((entry) => entry.id)).toEqual(['ch1', 'ch2']);
    expect(parsed.entries[0]?.text).toContain('学而时习之');
  });

  it('输出确定性（两次导出完全一致）', () => {
    const first = exportSite(buildDocument());
    const second = exportSite(buildDocument());
    expect(first.files).toEqual(second.files);
  });

  it('可关闭搜索索引与 IR 输出', () => {
    const result = exportSite(buildDocument(), { searchIndex: false, includeBookJson: false });
    const paths = result.files.map((file) => file.path);
    expect(paths).not.toContain('search-index.json');
    expect(paths).not.toContain('book.json');
  });

  it('标题与正文做 HTML 转义', () => {
    const document = createEmptyDocument({ title: '<script>alert(1)</script>' });
    document.root.children = [
      {
        id: 'c1',
        type: 'chapter',
        attrs: { title: '<b>x</b>' },
        children: [{ type: 'paragraph', children: [text('<img onerror=1>')] }],
      },
    ];
    const result = exportSite(document);
    const index = result.files.find((file) => file.path === 'index.html')?.text ?? '';
    const page = result.files.find((file) => file.path === 'section-1.html')?.text ?? '';
    expect(index).not.toContain('<script>');
    expect(index).toContain('&lt;b&gt;');
    expect(page).not.toContain('<img onerror=1>');
  });

  it('节数超限抛 RangeError', () => {
    const document = buildDocument();
    expect(() => exportSite(document, { maxSections: 1 })).toThrow(RangeError);
    expect(DEFAULT_MAX_SECTIONS).toBeGreaterThan(1);
  });

  it('空文档仍产出目录页并告警', () => {
    const result = exportSite(createEmptyDocument({ title: '空' }));
    const paths = result.files.map((file) => file.path);
    expect(paths).toContain('index.html');
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe('搜索索引工具', () => {
  it('空白归一化', () => {
    expect(normalizeSearchText('  甲\n\t乙　丙  ')).toBe('甲 乙 丙');
  });

  it('条目构造与序列化排序', () => {
    const entry = buildSearchEntry('b', '乙', 'b.html', {
      type: 'paragraph',
      children: [{ type: 'text', text: '内容' }],
    });
    expect(entry).toEqual({ id: 'b', title: '乙', path: 'b.html', text: '内容' });
    const raw = serializeSearchIndex([
      entry,
      { id: 'a', title: '甲', path: 'a.html', text: '' },
    ]);
    expect((JSON.parse(raw) as { entries: { id: string }[] }).entries.map((item) => item.id)).toEqual([
      'a',
      'b',
    ]);
  });
});
