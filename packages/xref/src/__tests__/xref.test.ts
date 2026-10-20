/**
 * 交叉引用测试：索引建立、序列化确定性、登记表、占位替换。
 */
import { describe, expect, it } from 'vitest';
import {
  CrossReferenceRegistry,
  buildPageIndex,
  deserializePageIndex,
  findLabelReferences,
  findPageReferences,
  hasReferences,
  lookupPage,
  replaceLabelReferences,
  replacePageReferences,
  resolveReferences,
  serializePageIndex,
} from '../index.js';
import type { PageSource } from '../index.js';

const pages: PageSource[] = [
  {
    index: 0,
    items: [{ block: { id: 'p1' } }],
    blocks: [{ id: 'p1' }, { id: 'ch1' }],
  },
  {
    index: 1,
    items: [{ block: { id: 'p1' } }, { block: { id: 'p2' } }],
  },
  {
    index: 2,
    blocks: [{ id: 'img-1' }],
  },
];

describe('buildPageIndex', () => {
  it('跨页重复节点取首次出现页', () => {
    const index = buildPageIndex(pages);
    expect(index.entries).toEqual({ p1: 1, ch1: 1, p2: 2, 'img-1': 3 });
    expect(index.totalPages).toBe(3);
  });

  it('startNumber 偏移页码（第 0 页即起始页码）', () => {
    const index = buildPageIndex(pages, { startNumber: 10 });
    expect(index.entries.p1).toBe(10);
    expect(index.entries['img-1']).toBe(12);
  });

  it('顺序无关（内部按 index 排序）', () => {
    const reversed = buildPageIndex([...pages].reverse());
    expect(reversed.entries).toEqual(buildPageIndex(pages).entries);
  });

  it('空输入得到空索引', () => {
    const index = buildPageIndex([]);
    expect(index.entries).toEqual({});
    expect(index.totalPages).toBe(0);
  });

  it('lookupPage 未命中返回 undefined', () => {
    const index = buildPageIndex(pages);
    expect(lookupPage(index, 'p2')).toBe(2);
    expect(lookupPage(index, 'nope')).toBeUndefined();
  });

  it('序列化键有序且可往返', () => {
    const index = buildPageIndex(pages);
    const json = serializePageIndex(index);
    expect(json).toBe(
      '{"entries":{"ch1":1,"img-1":3,"p1":1,"p2":2},"totalPages":3}',
    );
    expect(deserializePageIndex(json)).toEqual(index);
  });

  it('反序列化非法输入抛 TypeError', () => {
    expect(() => deserializePageIndex('oops')).toThrow(TypeError);
    expect(() => deserializePageIndex('{"totalPages":1}')).toThrow(TypeError);
    expect(() => deserializePageIndex('{"entries":{}}')).toThrow(TypeError);
  });
});

describe('CrossReferenceRegistry', () => {
  it('登记 / 读取 / 删除', () => {
    const registry = new CrossReferenceRegistry();
    registry.register({ label: 'fig-1', nodeId: 'img-1', kind: 'figure' });
    expect(registry.get('fig-1')?.nodeId).toBe('img-1');
    expect(registry.has('fig-1')).toBe(true);
    expect(registry.remove('fig-1')).toBe(true);
    expect(registry.remove('fig-1')).toBe(false);
    expect(registry.size).toBe(0);
  });

  it('空标签与重复标签抛错，批量登记原子性', () => {
    const registry = new CrossReferenceRegistry();
    expect(() => registry.register({ label: '', nodeId: 'x' })).toThrow(RangeError);
    expect(() => registry.register({ label: 'a', nodeId: '' })).toThrow(RangeError);
    registry.register({ label: 'a', nodeId: 'p1' });
    expect(() => registry.register({ label: 'a', nodeId: 'p2' })).toThrow(RangeError);
    expect(() => registry.registerMany([{ label: 'b', nodeId: 'p2' }, { label: 'a', nodeId: 'p3' }])).toThrow(
      RangeError,
    );
    expect(registry.has('b')).toBe(false);
  });

  it('resolvePage 按标签取页码', () => {
    const registry = CrossReferenceRegistry.from([{ label: 'fig-1', nodeId: 'img-1' }]);
    const index = buildPageIndex(pages);
    expect(registry.resolvePage('fig-1', index)).toBe(3);
    expect(registry.resolvePage('missing', index)).toBeUndefined();
  });

  it('list 按标签升序，JSON 往返一致', () => {
    const registry = CrossReferenceRegistry.from([
      { label: 'b', nodeId: 'p2' },
      { label: 'a', nodeId: 'p1' },
    ]);
    expect(registry.list().map((item) => item.label)).toEqual(['a', 'b']);
    expect(CrossReferenceRegistry.fromJSON(registry.toJSON()).list()).toEqual(registry.list());
  });

  it('反序列化非法输入抛 TypeError', () => {
    expect(() => CrossReferenceRegistry.fromJSON('oops')).toThrow(TypeError);
    expect(() => CrossReferenceRegistry.fromJSON('{}')).toThrow(TypeError);
    expect(() => CrossReferenceRegistry.fromJSON('{"references":[{"label":"a"}]}')).toThrow(TypeError);
  });
});

describe('占位替换', () => {
  const index = buildPageIndex(pages);

  it('扫描节点 id 占位符', () => {
    const matches = findPageReferences('甲{{page:p1}}乙{{page:p2}}');
    expect(matches.map((match) => match.nodeId)).toEqual(['p1', 'p2']);
    expect(matches[0]?.start).toBe(1);
    expect(matches[0]?.end).toBe(12);
  });

  it('扫描标签占位符', () => {
    const matches = findLabelReferences('见图{{ref:fig-1}}');
    expect(matches[0]?.label).toBe('fig-1');
  });

  it('替换页码，缺失目标替换为问号', () => {
    expect(replacePageReferences('参见第 {{page:p2}} 页，另见 {{page:none}}。', index)).toBe(
      '参见第 2 页，另见 ？。',
    );
  });

  it('自定义格式化与缺失文本', () => {
    const text = replacePageReferences('{{page:p1}}-{{page:none}}', index, {
      format: (page) => `第${page}页`,
      missing: '待定',
    });
    expect(text).toBe('第1页-待定');
  });

  it('自定义模板收到正确偏移', () => {
    const result = replacePageReferences('见 {{page:p2}}', index, {
      template: (formatted, match) => `[${formatted}@${match.start}]`,
    });
    expect(result).toBe('见 [2@2]');
  });

  it('标签替换走登记表', () => {
    const registry = CrossReferenceRegistry.from([{ label: 'fig-1', nodeId: 'img-1' }]);
    expect(replaceLabelReferences('见图 {{ref:fig-1}}', registry, index)).toBe('见图 3');
  });

  it('一次替换两种占位', () => {
    const registry = CrossReferenceRegistry.from([{ label: 'fig-1', nodeId: 'img-1' }]);
    expect(resolveReferences('{{page:p1}} / {{ref:fig-1}}', index, registry)).toBe('1 / 3');
  });

  it('hasReferences 判定', () => {
    expect(hasReferences('{{page:p1}}')).toBe(true);
    expect(hasReferences('{{ref:a}}')).toBe(true);
    expect(hasReferences('普通文本')).toBe(false);
    expect(hasReferences('{{page:p1}}')).toBe(true);
  });
});
