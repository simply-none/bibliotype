/**
 * epubToHtml 测试（默认 Node 环境：验证「解包 + XML 结构读取」浏览器/Node 同构，不触碰 DOM）
 *
 * 采用「导出 ↔ 导入往返」：以 @bibliotype/import 的 markdownToBookDocument 造 BookDocument，
 * 经 @bibliotype/exporter-epub 产出真实 .epub 字节，再解回正文 HTML 片段。
 * （exporter-epub 仅作测试 devDependency 用作夹具生成器，非运行时依赖。）
 */
import { buildEditorSchema } from '@bibliotype/editor';
import { exportEpub } from '@bibliotype/exporter-epub';
import { markdownToBookDocument } from '@bibliotype/import';
import { describe, expect, it } from 'vitest';
import { epubToHtml } from '../epub-package.js';

const schema = buildEditorSchema();

/** Markdown → BookDocument → exportEpub 字节（往返夹具） */
function epubFromMarkdown(md: string, title: string): Uint8Array {
  const doc = markdownToBookDocument(md, schema, { title });
  return exportEpub(doc);
}

describe('epubToHtml（Node 同构，无 DOM）', () => {
  it('解包 + OPF spine → 正文 HTML 片段（标题 / 段落 / 强调回收）', () => {
    const bytes = epubFromMarkdown(
      '# 学而\n\n子曰：**学而时习之**，不亦说乎？\n\n居其所而众星共之。',
      '论语',
    );
    const html = epubToHtml(bytes);
    expect(html).toMatch(/<h[1-6]/);
    expect(html).toContain('学而');
    expect(html).toContain('子曰');
    expect(html).toContain('居其所而众星共之');
  });

  it('多段正文全部回收', () => {
    const bytes = epubFromMarkdown('# 八佾\n\n第一段内容。\n\n第二段内容。', '论语');
    const html = epubToHtml(bytes);
    expect(html).toContain('第一段内容');
    expect(html).toContain('第二段内容');
  });

  it('空字节 → 抛出指向明确的 RangeError', () => {
    expect(() => epubToHtml(new Uint8Array([]))).toThrow(/epub 数据为空/);
  });

  it('非 zip 垃圾字节 → 抛出解包失败 RangeError', () => {
    expect(() => epubToHtml(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(/epub 解包失败/);
  });
});
