/**
 * EPUB 导出探针注入测试（I7）
 *
 * 覆盖：注入收集型探针后 report 含 export 阶段各步骤（plan / xhtml / nav-opf /
 * zip）；不注入（缺省 no-op）零行为且导出产物不受影响。
 */
import { PERF_PHASES, NODE_TYPES, createCollectingProfiler, createEmptyDocument, type BookDocument } from '@bibliotype/core';
import { describe, expect, it } from 'vitest';
import { exportEpub } from '../epub.js';

const FIXED_MODIFIED = '2026-01-02T00:00:00.000Z';

/** 构造样本：书 > 卷 > 章 > 段 */
function sampleDoc(): BookDocument {
  const doc = createEmptyDocument({
    title: '论语',
    language: 'zh-Hant',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: FIXED_MODIFIED,
  });
  doc.root.children = [
    {
      type: NODE_TYPES.CHAPTER,
      id: 'chap-1',
      attrs: { title: '学而第一' },
      children: [
        { type: NODE_TYPES.PARAGRAPH, id: 'p-1', children: [{ type: 'text', text: '子曰：学而时习之。' }] },
      ],
    },
  ];
  return doc;
}

describe('exportEpub 探针注入（I7）', () => {
  it('注入后 report 含 export 阶段四个步骤', () => {
    const profiler = createCollectingProfiler();
    exportEpub(sampleDoc(), { profiler, modified: FIXED_MODIFIED });
    const report = profiler.reportJson();
    const keys = Object.keys(report[PERF_PHASES.EXPORT]);
    expect(keys).toHaveLength(4);
    /* plan / xhtml span 会附加 sections 标签（step 为开始期标签，在前） */
    expect(keys.filter((key) => /^step=plan(,|$)/.test(key))).toHaveLength(1);
    expect(keys.filter((key) => /^step=xhtml(,|$)/.test(key))).toHaveLength(1);
    expect(keys).toContain('step=nav-opf');
    expect(keys.some((key) => /^step=zip,bytes=\d+$/.test(key))).toBe(true);
    for (const stats of Object.values(report[PERF_PHASES.EXPORT])) {
      expect(stats.count).toBe(1);
      expect(stats.minMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('缺省（不注入）零行为：导出产物正常', () => {
    const bytes = exportEpub(sampleDoc(), { modified: FIXED_MODIFIED });
    expect(bytes.length).toBeGreaterThan(0);
    /* 两次导出确定性不受探针影响 */
    const again = exportEpub(sampleDoc(), { modified: FIXED_MODIFIED });
    expect(again).toEqual(bytes);
  });
});
