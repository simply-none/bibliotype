/**
 * 编目导出与查看态格式化纯函数测试（阶段 5 拆分自 BookInfoDialog 的可测部分）
 *
 * 覆盖四条口径：
 * 1. `safeFilename` 清洗非法字符、空标题回退 bibliotype；
 * 2. `contributorText` 朝代 / 姓名 / 角色以全角空格拼接，缺失段忽略；
 * 3. `schemeText` 命中映射返回展示名、未映射大写原样；
 * 4. `toDublinCoreJson` 产出可解析 JSON、`toCnmarcText` 产出非空文本，
 *    `formatTimestamp` 数值走本地时间格式化、其余原样字符串化。
 */
import { describe, expect, it } from 'vitest';
import type { BookMetadata } from '@bibliotype/core';
import {
  contributorText,
  formatTimestamp,
  safeFilename,
  schemeText,
  toCnmarcText,
  toDublinCoreJson,
} from '../catalog-export.js';

const sample: BookMetadata = {
  title: '论语集解',
  contributors: [{ name: '何晏', dynasty: '魏', role: '撰' }],
  identifiers: [{ scheme: 'isbn', value: '978-7-101-00000-0' }],
};

describe('safeFilename', () => {
  it('去除路径与保留字符，空标题回退 bibliotype', () => {
    expect(safeFilename('a/b:c*d?e')).toBe('a_b_c_d_e');
    expect(safeFilename('  论语  ')).toBe('论语');
    expect(safeFilename('   ')).toBe('bibliotype');
  });
});

describe('contributorText', () => {
  it('朝代 / 姓名 / 角色全角空格拼接，缺失段忽略', () => {
    expect(contributorText({ name: '何晏', dynasty: '魏', role: '撰' })).toBe('魏　何晏　撰');
    expect(contributorText({ name: '朱熹' })).toBe('朱熹');
    expect(contributorText({ name: '', dynasty: '宋', role: '注' })).toBe('宋　注');
  });
});

describe('schemeText', () => {
  it('命中映射返回展示名，未映射大写原样', () => {
    expect(schemeText('isbn')).toBe('ISBN');
    expect(schemeText('other')).toBe('标识符');
    expect(schemeText('pmid')).toBe('PMID');
  });
});

describe('编目导出文本', () => {
  it('DC JSON 可解析且含题名', () => {
    const parsed = JSON.parse(toDublinCoreJson(sample)) as Record<string, unknown>;
    expect(parsed).toBeTruthy();
    expect(toDublinCoreJson(sample)).toContain('论语集解');
  });

  it('CNMARC 文本非空', () => {
    expect(toCnmarcText(sample).length).toBeGreaterThan(0);
  });
});

describe('formatTimestamp', () => {
  it('数值按本地时间格式化，其余原样字符串化', () => {
    const ts = 1_700_000_000_000;
    expect(formatTimestamp(ts)).toBe(new Date(ts).toLocaleString());
    expect(formatTimestamp('2026-01-02')).toBe('2026-01-02');
    expect(formatTimestamp(undefined)).toBe('undefined');
  });
});
