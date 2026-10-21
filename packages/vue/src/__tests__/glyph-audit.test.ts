/**
 * 缺字审计测试（K6 Vue 层）
 *
 * 覆盖：注入探测端口后的缺字统计、IDS 可合成与不可合成的区分、
 * 空文档 / 无缺字、面板渲染与截断。
 */
import { describe, expect, it } from 'vitest';
import { NODE_TYPES, createEmptyDocument, type BookDocument, type GlyphProbe } from '@bibliotype/core';
import { mount } from '@vue/test-utils';
import BtGlyphAuditPanel from '../components/BtGlyphAuditPanel.vue';
import { useGlyphAudit } from '../use-glyph-audit.js';

const MISSING = new Set(['𫞩', '𠀋']);
/** 假探测：只对两个扩展区字符未命中 */
const probe: GlyphProbe = (char) => !MISSING.has(char);

function sampleDoc(): BookDocument {
  const doc = createEmptyDocument({ title: '缺字' });
  doc.root.children = [
    {
      type: NODE_TYPES.PARAGRAPH,
      id: 'p-1',
      children: [{ type: 'text', text: '山𫞩水𠀋' }],
    },
  ];
  return doc;
}

describe('useGlyphAudit', () => {
  it('统计缺字与可合成数量', () => {
    const audit = useGlyphAudit({
      document: () => sampleDoc(),
      families: ['Songti'],
      probe,
      idsFor: (char) => (char === '𫞩' ? '⿰王卂' : undefined),
    });

    expect(audit.issues.value).toHaveLength(2);
    expect(audit.missingCount.value).toBe(1);
    expect(audit.idsCount.value).toBe(1);
    expect(audit.summary.value).toContain('缺字 2 处');
    expect(audit.summary.value).toContain('可 IDS 合成');
  });

  it('无文档或无缺字时为空', () => {
    const empty = useGlyphAudit({ document: () => undefined, probe });
    expect(empty.issues.value).toEqual([]);
    expect(empty.summary.value).toBe('未发现缺字');

    const allHit = useGlyphAudit({
      document: () => sampleDoc(),
      families: ['Songti'],
      probe: () => true,
    });
    expect(allHit.issues.value).toEqual([]);
  });

  it('refresh 可手动重算（用于文档原地修改）', () => {
    const doc = sampleDoc();
    const audit = useGlyphAudit({
      document: () => doc,
      families: ['Songti'],
      probe,
      autoRefresh: false,
    });
    expect(audit.issues.value).toHaveLength(2);

    doc.root.children = [
      { type: NODE_TYPES.PARAGRAPH, id: 'p-2', children: [{ type: 'text', text: '山' }] },
    ];
    expect(audit.issues.value).toHaveLength(2);
    audit.refresh();
    expect(audit.issues.value).toHaveLength(0);
  });
});

describe('BtGlyphAuditPanel', () => {
  const issues = [
    {
      char: '𫞩',
      codePoint: 0x2b7a9,
      code: 'U+2B7A9',
      path: '0.0',
      context: '山𫞩水',
      stage: 'ids' as const,
      privateUse: false,
    },
    {
      char: '𠀋',
      codePoint: 0x2000b,
      code: 'U+2000B',
      path: '0.0',
      context: '水𠀋',
      stage: 'tofu' as const,
      privateUse: false,
    },
  ];

  it('渲染条目与提示，空态显示文案', () => {
    const wrapper = mount(BtGlyphAuditPanel, { props: { issues } });
    expect(wrapper.findAll('.bt-glyph-audit__item')).toHaveLength(2);
    expect(wrapper.text()).toContain('U+2B7A9');
    expect(wrapper.text()).toContain('可合成');
    expect(wrapper.text()).toContain('缺字');
    expect(wrapper.text()).toContain('其中 1 处');

    const empty = mount(BtGlyphAuditPanel, { props: { issues: [] } });
    expect(empty.find('.bt-glyph-audit__empty').text()).toContain('未发现缺字');
  });

  it('maxItems 截断并提示剩余数量', () => {
    const wrapper = mount(BtGlyphAuditPanel, { props: { issues, maxItems: 1 } });
    expect(wrapper.findAll('.bt-glyph-audit__item')).toHaveLength(1);
    expect(wrapper.find('.bt-glyph-audit__more').text()).toContain('另有 1 处');
  });
});
