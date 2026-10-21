/**
 * OPF 古籍元数据映射测试（K7）
 *
 * 覆盖：四部细目 → dc:subject、版本项 → dc:source、dc:type 固定为 Text；
 * 无古籍字段时不输出多余元素（保持既有产物的最小形态）。
 */
import { describe, expect, it } from 'vitest';
import type { BookMetadata } from '@bibliotype/core';
import { buildOpf } from '../opf.js';

/** 生成最小 OPF */
function opf(metadata: BookMetadata, version?: string): string {
  return buildOpf({
    identifier: 'urn:uuid:00000000-0000-4000-8000-000000000000',
    metadata,
    language: 'zh-Hant',
    modified: '2026-10-21T00:00:00Z',
    manifest: [],
    spine: [],
    ...(version === undefined ? {} : { version }),
  });
}

describe('buildOpf 古籍元数据', () => {
  it('四部细目与分类号映射为 dc:subject，版本项映射为 dc:source', () => {
    const xml = opf({
      title: '论语',
      classification: 'B222.2',
      classicalCategory: { division: 'jing', subdivision: '四书类' },
      edition: { name: '庚辰本', era: '清乾隆五十六年' },
    });

    expect(xml).toContain('<dc:subject xml:lang="zh-Hant">经部</dc:subject>');
    expect(xml).toContain('<dc:subject xml:lang="zh-Hant">四书类</dc:subject>');
    expect(xml).toContain('<dc:subject xml:lang="zh-Hant">B222.2</dc:subject>');
    expect(xml).toContain('<dc:source>庚辰本，清乾隆五十六年</dc:source>');
    expect(xml).toContain('<dc:type>Text</dc:type>');
  });

  it('无古籍字段时不输出 subject / source（dc:type 保留）', () => {
    const xml = opf({ title: '论语' });
    expect(xml).not.toContain('<dc:subject');
    expect(xml).not.toContain('<dc:source');
    expect(xml).toContain('<dc:type>Text</dc:type>');
  });

  it('EPUB 2 路径同样输出 subject（xml:lang 合法）', () => {
    const xml = opf(
      { title: '论语', classicalCategory: { division: 'zi' } },
      '2.0',
    );
    expect(xml).toContain('<dc:subject xml:lang="zh-Hant">子部</dc:subject>');
    // EPUB 2 不输出 property 属性
    expect(xml).not.toContain('property="dcterms:modified"');
  });
});
