/**
 * 表格 HTML 序列化测试：表头行 → thead/th、跨行跨列 → 原生属性、对齐 → data-align
 *
 * 关键回归：**没有表头行时输出与旧版一致**（不额外包 tbody），避免既有 EPUB 产物与
 * 快照发生无意义变化。
 */
import { describe, expect, it } from 'vitest';
import { NODE_TYPES, type Attrs, type BookNode } from '@bibliotype/core';
import { serializeNode } from '../html/html-serializer.js';

function cell(id: string, text: string, attrs?: Attrs): BookNode {
  return {
    type: NODE_TYPES.TABLE_CELL,
    id,
    ...(attrs !== undefined ? { attrs } : {}),
    children: [
      { type: NODE_TYPES.PARAGRAPH, id: `${id}-p`, children: [{ type: 'text', text }] },
    ],
  };
}

function table(rows: BookNode[]): BookNode {
  return { type: NODE_TYPES.TABLE, id: 't-1', children: rows };
}

const plainRows = [
  {
    type: NODE_TYPES.TABLE_ROW,
    id: 'r-1',
    children: [cell('c-1', '甲'), cell('c-2', '乙')],
  },
];

describe('表格 HTML 序列化', () => {
  it('无表头行：保持旧输出（无 thead / tbody，td 原生属性缺省）', () => {
    const html = serializeNode(table(plainRows));
    expect(html).toBe(
      '<table id="t-1" class="bt-table">' +
        '<tr id="r-1" class="bt-table-row">' +
        '<td id="c-1" class="bt-table-cell"><p id="c-1-p" class="bt-paragraph">甲</p></td>' +
        '<td id="c-2" class="bt-table-cell"><p id="c-2-p" class="bt-paragraph">乙</p></td>' +
        '</tr></table>',
    );
  });

  it('表头行：thead + th + data-header', () => {
    const html = serializeNode(
      table([
        { type: NODE_TYPES.TABLE_ROW, id: 'h-1', attrs: { header: true }, children: [cell('c-1', '名称')] },
        ...plainRows,
      ]),
    );
    expect(html).toContain('<thead><tr id="h-1" class="bt-table-row" data-header="true">');
    expect(html).toContain('<th id="c-1" class="bt-table-cell">');
    expect(html).toContain('</thead><tbody>');
    expect(html).toContain('</tbody></table>');
  });

  it('跨行跨列输出原生 colspan / rowspan，对齐走 data-align', () => {
    const html = serializeNode(
      table([
        {
          type: NODE_TYPES.TABLE_ROW,
          id: 'r-1',
          children: [cell('c-1', '合并', { colspan: 2, rowspan: 3, align: 'center' })],
        },
      ]),
    );
    expect(html).toContain('<td id="c-1" class="bt-table-cell" colspan="2" rowspan="3" data-align="center">');
    // 原生属性不重复输出为 data-*
    expect(html).not.toContain('data-colspan');
    expect(html).not.toContain('data-rowspan');
  });

  it('默认值（colspan=1 / rowspan=1 / header=false）不输出属性', () => {
    const html = serializeNode(
      table([
        {
          type: NODE_TYPES.TABLE_ROW,
          id: 'r-1',
          attrs: { header: false },
          children: [cell('c-1', '普通', { colspan: 1, rowspan: 1 })],
        },
      ]),
    );
    expect(html).not.toContain('colspan');
    expect(html).not.toContain('rowspan');
    expect(html).not.toContain('data-header');
    expect(html).not.toContain('<thead>');
  });
});
