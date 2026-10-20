/**
 * E4 前置页：封面 / 书名页 / 版权页 / 封底各成独立 XHTML，且不进目录
 */
import { describe, expect, it } from 'vitest';
import { NODE_TYPES, createEmptyDocument, type BookDocument } from '@bibliotype/core';
import { strFromU8, unzipSync } from 'fflate';
import { exportEpub } from '../epub.js';
import { buildNavItems, planDocument } from '../sections.js';

const FIXED_MODIFIED = '2026-01-02T00:00:00Z';

function paragraph(id: string, text: string) {
  return { type: NODE_TYPES.PARAGRAPH, id, children: [{ type: 'text' as const, text }] };
}

function frontMatterDoc(): BookDocument {
  const doc = createEmptyDocument({
    title: '前置页样本',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  });
  doc.root.children = [
    {
      type: NODE_TYPES.COVER,
      id: 'cover',
      children: [paragraph('cover-p', '封面文字')],
    },
    {
      type: NODE_TYPES.TITLE_PAGE,
      id: 'title',
      children: [paragraph('title-p', '书名页')],
    },
    {
      type: NODE_TYPES.COPYRIGHT_PAGE,
      id: 'copyright',
      children: [paragraph('copyright-p', '版权页')],
    },
    {
      type: NODE_TYPES.CHAPTER,
      id: 'ch-1',
      attrs: { title: '第一章' },
      children: [paragraph('p-1', '正文')],
    },
    {
      type: NODE_TYPES.BACK_COVER,
      id: 'back',
      children: [paragraph('back-p', '封底文字')],
    },
  ];
  return doc;
}

describe('planDocument 前置页', () => {
  it('每个前置页各成一个 XHTML，spine 顺序与原文档一致', () => {
    const plan = planDocument(frontMatterDoc().root);
    expect(plan.sections).toHaveLength(5);
    expect(plan.sections.map((section) => section.nodes[0]?.type)).toEqual([
      NODE_TYPES.COVER,
      NODE_TYPES.TITLE_PAGE,
      NODE_TYPES.COPYRIGHT_PAGE,
      NODE_TYPES.CHAPTER,
      NODE_TYPES.BACK_COVER,
    ]);
  });

  it('目录不含前置页', () => {
    const plan = planDocument(frontMatterDoc().root);
    const nav = buildNavItems(plan.sections, plan.anchors);
    expect(nav).toHaveLength(1);
    expect(nav[0]?.label).toBe('第一章');
    const labels = JSON.stringify(nav);
    expect(labels).not.toContain('封面');
    expect(labels).not.toContain('版权页');
    expect(labels).not.toContain('书名页');
  });
});

describe('exportEpub 前置页语义', () => {
  it('body 输出 cover / titlepage / copyright-page 语义，封底不标注', () => {
    const bytes = exportEpub(frontMatterDoc(), { modified: FIXED_MODIFIED });
    const files = unzipSync(bytes);
    const contents = Object.entries(files)
      .filter(([name]) => name.endsWith('.xhtml') && name.includes('/text/'))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, data]) => strFromU8(data));

    expect(contents).toHaveLength(5);
    expect(contents[0]).toContain('epub:type="cover"');
    expect(contents[1]).toContain('epub:type="titlepage"');
    expect(contents[2]).toContain('epub:type="copyright-page"');
    expect(contents[3]).not.toContain('epub:type=');
    expect(contents[4]).not.toContain('epub:type=');
  });

  it('spine 顺序与原文档一致', () => {
    const bytes = exportEpub(frontMatterDoc(), { modified: FIXED_MODIFIED });
    const files = unzipSync(bytes);
    const opfKey = Object.keys(files).find((name) => name.endsWith('content.opf'));
    const opf = strFromU8(files[opfKey!]!);
    const itemrefs = [...opf.matchAll(/<itemref idref="([^"]+)"/g)].map((match) => match[1]);
    expect(itemrefs).toEqual(['sec-0', 'sec-1', 'sec-2', 'sec-3', 'sec-4']);
  });
});
