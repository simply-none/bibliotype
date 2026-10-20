/**
 * 锚点契约测试：序列化往返、解析容错、偏移裁剪、失效判定。
 */
import { describe, expect, it } from 'vitest';
import {
  ANCHOR_PREFIX,
  createBlockAnchor,
  createTextAnchor,
  isAnchor,
  locateNode,
  nodePlainText,
  parseAnchor,
  resolveAnchor,
  serializeAnchor,
} from '../index.js';
import type { BookNode, BookDocument } from '../index.js';
import { createEmptyDocument } from '../index.js';

const paragraph: BookNode = {
  id: 'p1',
  type: 'paragraph',
  children: [
    { type: 'text', text: '学而时习之' },
    { type: 'text', text: '，不亦说乎', marks: [{ type: 'emphasis' }] },
  ],
};

function buildDocument(): BookDocument {
  const doc = createEmptyDocument({ title: '论语' });
  doc.root.children = [{ id: 'ch1', type: 'chapter', children: [paragraph] }];
  return doc;
}

describe('锚点序列化', () => {
  it('块锚点往返一致', () => {
    const anchor = createBlockAnchor('ch1');
    const text = serializeAnchor(anchor);
    expect(text).toBe(`${ANCHOR_PREFIX}:block:ch1`);
    expect(parseAnchor(text)).toEqual(anchor);
  });

  it('文本锚点往返一致', () => {
    const anchor = createTextAnchor('p1', 3, 4);
    expect(parseAnchor(serializeAnchor(anchor))).toEqual(anchor);
  });

  it('含特殊字符的节点 id 经编码后可还原', () => {
    const anchor = createTextAnchor('a:b/c', 0, 2);
    expect(parseAnchor(serializeAnchor(anchor))).toEqual(anchor);
  });

  it('非法字符串返回 undefined 而不抛错', () => {
    expect(parseAnchor('')).toBeUndefined();
    expect(parseAnchor('bt:block:')).toBeUndefined();
    expect(parseAnchor('bt:text:p1:-1:2')).toBeUndefined();
    expect(parseAnchor('bt:text:p1:1')).toBeUndefined();
    expect(parseAnchor('other:block:p1')).toBeUndefined();
    expect(parseAnchor('bt:block:%E0%A4%A')).toBeUndefined();
  });

  it('负偏移与空 id 抛 RangeError', () => {
    expect(() => createTextAnchor('p1', -1)).toThrow(RangeError);
    expect(() => createTextAnchor('', 0)).toThrow(RangeError);
    expect(() => createBlockAnchor('')).toThrow(RangeError);
  });
});

describe('锚点解析', () => {
  it('块锚点返回整块纯文本', () => {
    const doc = buildDocument();
    const resolved = resolveAnchor(doc.root, createBlockAnchor('p1'));
    expect(resolved?.text).toBe('学而时习之，不亦说乎');
    expect(resolved?.clamped).toBe(false);
  });

  it('文本锚点按纯文本偏移取片段（跨叶子聚合）', () => {
    const doc = buildDocument();
    const resolved = resolveAnchor(doc.root, createTextAnchor('p1', 3, 3));
    expect(resolved?.text).toBe('习之，');
  });

  it('超界偏移被裁剪并标记 clamped', () => {
    const doc = buildDocument();
    const resolved = resolveAnchor(doc.root, createTextAnchor('p1', 100, 5));
    expect(resolved?.text).toBe('');
    expect(resolved?.clamped).toBe(true);
    expect(resolved?.anchor).toEqual(createTextAnchor('p1', 10, 0));
  });

  it('节点被删除时返回 undefined（孤儿锚点）', () => {
    const doc = buildDocument();
    expect(resolveAnchor(doc.root, createBlockAnchor('missing'))).toBeUndefined();
  });
});

describe('节点定位与纯文本', () => {
  it('locateNode 深度优先命中', () => {
    const doc = buildDocument();
    expect(locateNode(doc.root, 'ch1')?.type).toBe('chapter');
    expect(locateNode(doc.root, 'p1')?.type).toBe('paragraph');
    expect(locateNode(doc.root, 'nope')).toBeUndefined();
  });

  it('nodePlainText 拼接叶子文本', () => {
    expect(nodePlainText(paragraph)).toBe('学而时习之，不亦说乎');
    expect(nodePlainText({ type: 'text', text: '甲' })).toBe('甲');
  });

  it('isAnchor 拒绝结构不完整的对象', () => {
    expect(isAnchor({ type: 'block', nodeId: 'x' })).toBe(true);
    expect(isAnchor({ type: 'text', nodeId: 'x', offset: 1, length: 2 })).toBe(true);
    expect(isAnchor({ type: 'text', nodeId: 'x', offset: -1, length: 2 })).toBe(false);
    expect(isAnchor({ type: 'block' })).toBe(false);
    expect(isAnchor(null)).toBe(false);
  });
});
