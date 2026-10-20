/**
 * 纯文本（TXT）导入测试：分段、章节识别、硬换行合并、确定性 id。
 */
import { buildEditorSchema } from '@bibliotype/editor';
import { NODE_TYPES } from '@bibliotype/core';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TXT_CHAPTER_PATTERN, txtToBookDocument } from '../from-text.js';

const schema = buildEditorSchema();
const metadata = { title: 'TXT 测试' };

function childrenOf(doc: ReturnType<typeof txtToBookDocument>): NonNullable<typeof doc.root.children> {
  return doc.root.children ?? [];
}

describe('txtToBookDocument', () => {
  it('空行分段、硬换行合并（中文不加空格）', () => {
    const doc = txtToBookDocument('子曰：学而\n时习之。\n\n有朋自远方来。', schema, metadata);
    const blocks = childrenOf(doc);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.type).toBe(NODE_TYPES.PARAGRAPH);
    const text = (blocks[0]?.children as { text?: string }[] | undefined)?.[0]?.text;
    expect(text).toBe('子曰：学而时习之。');
  });

  it('西文硬换行合并补空格', () => {
    const doc = txtToBookDocument('hello\nworld', schema, metadata);
    const text = (childrenOf(doc)[0]?.children as { text?: string }[] | undefined)?.[0]?.text;
    expect(text).toBe('hello world');
  });

  it('第X章 / 卷X 起章，章节带 title', () => {
    const text = '第一章 学而\n\n子曰。\n\n第二章 为政\n\n为政以德。';
    const chapters = childrenOf(txtToBookDocument(text, schema, metadata));
    expect(chapters.map((node) => node.type)).toEqual([NODE_TYPES.CHAPTER, NODE_TYPES.CHAPTER]);
    expect(chapters[0]?.attrs?.['title']).toBe('第一章 学而');
    expect(chapters[1]?.attrs?.['title']).toBe('第二章 为政');
    expect(chapters[0]?.children?.[0]?.type).toBe(NODE_TYPES.PARAGRAPH);

    const volume = childrenOf(txtToBookDocument('卷一 序\n\n正文', schema, metadata));
    expect(volume[0]?.attrs?.['title']).toBe('卷一 序');
  });

  it('章节标记前的内容不丢：自成无标题章', () => {
    const chapters = childrenOf(
      txtToBookDocument('卷首语。\n\n第一章 学而\n\n子曰。', schema, metadata),
    );
    expect(chapters).toHaveLength(2);
    expect(chapters[0]?.attrs?.['title']).toBeUndefined();
    expect(chapters[1]?.attrs?.['title']).toBe('第一章 学而');
  });

  it('CRLF 归一化，空文本产出空书', () => {
    const doc = txtToBookDocument('第一段\r\n\r\n第二段', schema, metadata);
    expect(childrenOf(doc)).toHaveLength(2);
    expect(childrenOf(txtToBookDocument('   \n\n  ', schema, metadata))).toHaveLength(0);
  });

  it('id 按前缀与序号确定生成', () => {
    const doc = txtToBookDocument('第一章 一\n\n甲。\n\n乙。', schema, metadata, {
      idPrefix: 'novel',
    });
    const chapter = childrenOf(doc)[0];
    expect(chapter?.id).toBe('novel-chapter-1');
    expect(chapter?.children?.map((child) => child.id)).toEqual(['novel-p-1', 'novel-p-2']);
  });

  it('自定义章节模式与容器类型', () => {
    const doc = txtToBookDocument('【一】开端\n\n正文', schema, metadata, {
      chapterPattern: /^【[一二三四五六七八九十]+】/,
      chapterType: NODE_TYPES.VOLUME,
    });
    const volume = childrenOf(doc)[0];
    expect(volume?.type).toBe(NODE_TYPES.VOLUME);
    expect(volume?.attrs?.['title']).toBe('【一】开端');
  });

  it('schema 缺少章节节点时抛 RangeError', () => {
    expect(() =>
      txtToBookDocument('正文', schema, metadata, { chapterType: 'no-such-node' }),
    ).toThrow(/no-such-node/);
  });

  it('缺省章节模式覆盖常见标记', () => {
    for (const title of ['第一章', '第十二回', '第三节', '卷三', '第二部', '第五篇']) {
      expect(DEFAULT_TXT_CHAPTER_PATTERN.test(title)).toBe(true);
    }
    expect(DEFAULT_TXT_CHAPTER_PATTERN.test('子曰学而')).toBe(false);
  });
});
