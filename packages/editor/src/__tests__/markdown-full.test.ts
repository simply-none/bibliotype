/**
 * F6 Markdown 全量块级解析：嵌套 / 松散列表、GFM 表格、图片题注
 */
import { NODE_TYPES } from '@bibliotype/core';
import { describe, expect, it } from 'vitest';
import { buildEditorSchema } from '../default-schema.js';
import { markdownToNodes } from '../markdown.js';

const schema = buildEditorSchema();

describe('markdown 嵌套列表', () => {
  it('三层缩进产出三层 list', () => {
    const [list] = markdownToNodes('- 一\n  - 一甲\n    - 一甲子\n- 二', schema);
    expect(list?.type.name).toBe(NODE_TYPES.LIST);
    expect(list?.childCount).toBe(2);

    const firstItem = list?.firstChild;
    expect(firstItem?.type.name).toBe(NODE_TYPES.LIST_ITEM);
    expect(firstItem?.firstChild?.type.name).toBe(NODE_TYPES.PARAGRAPH);

    const secondLevel = firstItem?.lastChild;
    expect(secondLevel?.type.name).toBe(NODE_TYPES.LIST);
    const thirdLevel = secondLevel?.firstChild?.lastChild;
    expect(thirdLevel?.type.name).toBe(NODE_TYPES.LIST);
    expect(thirdLevel?.textContent).toBe('一甲子');
  });

  it('同级标记类型切换时另起列表', () => {
    const blocks = markdownToNodes('- 无序\n1. 有序', schema);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.type.name).toBe(NODE_TYPES.LIST);
    expect(blocks[0]?.attrs.ordered).toBe(false);
    expect(blocks[1]?.type.name).toBe(NODE_TYPES.LIST);
    expect(blocks[1]?.attrs.ordered).toBe(true);
  });

  it('松散项内保留多段落', () => {
    const [list] = markdownToNodes('- 第一段\n\n  第二段\n- 下一项', schema);
    const firstItem = list?.firstChild;
    expect(firstItem?.childCount).toBe(2);
    expect(firstItem?.child(0).textContent).toBe('第一段');
    expect(firstItem?.child(1).textContent).toBe('第二段');
  });
});

describe('markdown GFM 表格', () => {
  it('表头 / 对齐 / 转义竖线', () => {
    const [table] = markdownToNodes(
      '| 左 | 中 | 右 | 转义 |\n| :--- | :---: | ---: | --- |\n| a | b | c | d \\| e |',
      schema,
    );
    expect(table?.type.name).toBe(NODE_TYPES.TABLE);
    expect(table?.childCount).toBe(2);

    const header = table?.child(0);
    expect(header?.attrs.header).toBe(true);
    expect(header?.child(0).attrs.align).toBe('left');
    expect(header?.child(1).attrs.align).toBe('center');
    expect(header?.child(2).attrs.align).toBe('right');
    expect(header?.child(3).attrs.align).toBeNull();

    const body = table?.child(1);
    expect(body?.attrs.header).toBe(false);
    expect(body?.child(3).textContent).toBe('d | e');
  });

  it('缺列补空、多列截断', () => {
    const [table] = markdownToNodes('| a | b |\n| --- | --- |\n| 1 |', schema);
    expect(table?.child(1)?.childCount).toBe(2);
    expect(table?.child(1)?.child(1).textContent).toBe('');
  });

  it('列数不匹配时不识别为表格', () => {
    const blocks = markdownToNodes('| a | b |\n| --- |', schema);
    expect(blocks.every((block) => block.type.name !== NODE_TYPES.TABLE)).toBe(true);
  });
});

describe('markdown 图片题注', () => {
  it('紧随图片的整行斜体成为图注', () => {
    const blocks = markdownToNodes('![图](https://example.com/a.png)\n*图一 说明*', schema);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.type.name).toBe(NODE_TYPES.IMAGE);
    expect(blocks[1]?.type.name).toBe(NODE_TYPES.CAPTION);
    expect(blocks[1]?.textContent).toBe('图一 说明');
  });

  it('图片 title 直接作为图注', () => {
    const blocks = markdownToNodes('![图](https://example.com/a.png "题注")', schema);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.attrs.src).toBe('https://example.com/a.png');
    expect(blocks[1]?.type.name).toBe(NODE_TYPES.CAPTION);
    expect(blocks[1]?.textContent).toBe('题注');
  });
});
