/**
 * 格式检测与文本分发测试（纯函数，node 环境）
 */
import { buildEditorSchema } from '@bibliotype/editor';
import { describe, expect, it } from 'vitest';
import { detectImportFormat, importFromText } from '../format.js';

const schema = buildEditorSchema();
const metadata = { title: '分发测试' };

describe('detectImportFormat', () => {
  it('按扩展名识别文本与二进制格式', () => {
    expect(detectImportFormat('note.MD')).toBe('markdown');
    expect(detectImportFormat('chapter.markdown')).toBe('markdown');
    expect(detectImportFormat('page.html')).toBe('html');
    expect(detectImportFormat('legacy.htm')).toBe('html');
    expect(detectImportFormat('doc.docx')).toBe('docx');
    expect(detectImportFormat('book.epub')).toBe('epub');
  });

  it('按 MIME 识别（忽略参数）', () => {
    expect(detectImportFormat('text/markdown')).toBe('markdown');
    expect(detectImportFormat('text/html; charset=utf-8')).toBe('html');
    expect(detectImportFormat('application/epub+zip')).toBe('epub');
    expect(
      detectImportFormat('application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    ).toBe('docx');
  });

  it('无法识别返回 unknown', () => {
    expect(detectImportFormat('archive.zip')).toBe('unknown');
    expect(detectImportFormat('')).toBe('unknown');
    expect(detectImportFormat('application/pdf')).toBe('unknown');
  });
});

describe('importFromText', () => {
  it('markdown 路由到 Markdown 转换', () => {
    const doc = importFromText('# 标题\n\n正文', 'markdown', schema, metadata);
    expect(doc.root.type).toBe('book');
    expect((doc.root.children ?? []).length).toBeGreaterThan(0);
  });

  it('docx / epub / unknown 抛明确错误（指向对应包）', () => {
    expect(() => importFromText('x', 'docx', schema, metadata)).toThrow(/import-docx/);
    expect(() => importFromText('x', 'epub', schema, metadata)).toThrow(/import-epub/);
    expect(() => importFromText('x', 'unknown', schema, metadata)).toThrow(/unknown/);
  });
});
