/**
 * 粘贴决策纯函数测试（buildPasteSlice，node 环境）
 */
import { NODE_TYPES } from '@bibliotype/core';
import { describe, expect, it } from 'vitest';
import { buildEditorSchema } from '../default-schema.js';
import { buildPasteSlice } from '../paste.js';

const schema = buildEditorSchema();

describe('buildPasteSlice', () => {
  it('带 HTML 的粘贴不接管（交回原生解析）', () => {
    expect(buildPasteSlice('任意', '<p>粗</p>', schema)).toBeNull();
  });

  it('非 Markdown 纯文本不接管', () => {
    expect(buildPasteSlice('子曰：学而时习之', undefined, schema)).toBeNull();
  });

  it('Markdown 纯文本产出 Slice，首块为对应节点', () => {
    const slice = buildPasteSlice('# 标题\n\n正文**重点**', undefined, schema);
    expect(slice).not.toBeNull();
    expect(slice?.content.size).toBeGreaterThan(0);
    expect(slice?.content.firstChild?.type.name).toBe(NODE_TYPES.HEADING);
  });
});
