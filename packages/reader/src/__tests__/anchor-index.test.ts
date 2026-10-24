/**
 * 文档内锚点索引测试：链接 hash → 所在页
 *
 * 模拟存量导入书（目标块无源 id，块 id 为树路径）：注码链接 hash `ch1-9` 与
 * 注文回链 hash `ch1-9-back`（EPUB 遗留 `text00012.html#…` 文件名段一并覆盖）
 * 分落不同页，`Reader.getPageOfAnchor` 按链接标记反查所在块定位页码。
 */
import { describe, expect, it } from 'vitest';
import { MARK_TYPES, NODE_TYPES, createEmptyDocument } from '@bibliotype/core';
import { Reader, type BlockSizeEstimator } from '@bibliotype/reader';

function makeReader(): Reader {
  const doc = createEmptyDocument({ title: '锚点' });
  doc.root.children = [
    {
      type: NODE_TYPES.CHAPTER,
      attrs: { title: '第一章' },
      children: [
        {
          type: NODE_TYPES.PARAGRAPH,
          children: [
            {
              type: 'text',
              text: '(1)',
              marks: [{ type: MARK_TYPES.LINK, attrs: { href: 'text00012.html#ch1-9' } }],
            },
          ],
        },
        { type: NODE_TYPES.PARAGRAPH, children: [{ type: 'text', text: '填充一' }] },
        { type: NODE_TYPES.PARAGRAPH, children: [{ type: 'text', text: '填充二' }] },
        { type: NODE_TYPES.PARAGRAPH, children: [{ type: 'text', text: '填充三' }] },
        {
          type: NODE_TYPES.PARAGRAPH,
          children: [
            {
              type: 'text',
              text: '(1)',
              marks: [{ type: MARK_TYPES.LINK, attrs: { href: 'text00012.html#ch1-9-back' } }],
            },
            { type: 'text', text: '《汉·许皇后传》：幸得免离茅屋之下。' },
          ],
        },
      ],
    },
  ];
  const estimator: BlockSizeEstimator = () => 100;
  const reader = new Reader({ pageMainSize: 100, bottomSlack: 0, estimator });
  reader.loadDocument(doc);
  return reader;
}

describe('Reader.getPageOfAnchor（链接 hash → 页码）', () => {
  it('注码 hash 反查注码所在页；注文回链 hash 反查注文所在页', () => {
    const reader = makeReader();
    expect(reader.getPageOfAnchor('ch1-9')).toBe(0);
    expect(reader.getPageOfAnchor('ch1-9-back')).toBe(4);
  });

  it('未收录的 hash 返回 undefined；文件名段不参与索引', () => {
    const reader = makeReader();
    expect(reader.getPageOfAnchor('nope')).toBeUndefined();
    expect(reader.getPageOfAnchor('text00012.html')).toBeUndefined();
  });
});
