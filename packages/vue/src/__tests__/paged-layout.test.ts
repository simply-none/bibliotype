/**
 * 编辑态分页内核（use-paged-layout / buildPagedLayout）测试
 *
 * happy-dom 无真实布局盒：measurePagination 产出空 sizes → extractBlocks 回退估算器；
 * lineOffsets 亦空 → 跨页块按 charsPerLine 回退切片。仍可验证：
 * - 单栏横排可用、直排/多栏不可用（usable=false）；
 * - 超长段落被按行拆成跨页片段（存在 fromLine>0 续排片段与 lineCount>0 片段）；
 * - 片段节点文本为原文子串（切片正确，非整段重复）。
 */
import { describe, expect, it } from 'vitest';
import { effectScope, ref } from 'vue';
import { DEFAULT_THEME, NODE_TYPES, createEmptyDocument, type BookDocument } from '@bibliotype/core';
import {
  CLASSICAL_LAYOUT_OPTIONS,
  DEFAULT_LAYOUT_OPTIONS,
  type LayoutOptions,
} from '@bibliotype/layout';
import { BookEditor, buildEditorSchema } from '@bibliotype/editor';
import { TextSelection } from 'prosemirror-state';
import { disposeMeasureSheet } from '../pagination-measure.js';
import { buildPagedLayout, usePagedLayout } from '../paged-editor/use-paged-layout.js';

function docWithParagraphs(texts: string[]): BookDocument {
  const doc = createEmptyDocument({ title: '测试' });
  doc.root.children = [
    {
      type: NODE_TYPES.CHAPTER,
      id: 'chap-1',
      children: texts.map((text, i) => ({
        type: NODE_TYPES.PARAGRAPH,
        id: `p-${i}`,
        children: [{ type: 'text', text }],
      })),
    },
  ];
  return doc;
}

describe('buildPagedLayout', () => {
  it('单栏横排：可用并产出至少一页', () => {
    const result = buildPagedLayout({
      doc: docWithParagraphs(['子曰学而时习之不亦说乎']),
      options: DEFAULT_LAYOUT_OPTIONS,
    });
    expect(result.usable).toBe(true);
    expect(result.pages.length).toBeGreaterThanOrEqual(1);
    expect(result.pages[0]!.fragments.length).toBeGreaterThan(0);
    disposeMeasureSheet();
  });

  it('直排不可用（paged 依赖单栏横排 DOM 实测）', () => {
    const result = buildPagedLayout({
      doc: docWithParagraphs(['子曰学而时习之']),
      options: CLASSICAL_LAYOUT_OPTIONS,
    });
    expect(result.usable).toBe(false);
    expect(result.pages).toHaveLength(0);
  });

  it('多栏不可用', () => {
    const result = buildPagedLayout({
      doc: docWithParagraphs(['子曰学而时习之']),
      options: { ...DEFAULT_LAYOUT_OPTIONS, columns: 2 },
    });
    expect(result.usable).toBe(false);
  });

  it('超长段落按行跨页续排：存在续排片段且片段文本为原文子串', () => {
    const full = '仁义礼智信忠孝节悌'.repeat(400); // 8000 字符，跨多页
    const result = buildPagedLayout({
      doc: docWithParagraphs([full]),
      options: DEFAULT_LAYOUT_OPTIONS,
    });
    expect(result.usable).toBe(true);
    expect(result.pages.length).toBeGreaterThan(1);

    const allFrags = result.pages.flatMap((page) => page.fragments);
    // 至少一个片段带行数（拆分），且存在非首行续排片段
    expect(allFrags.some((f) => f.lineCount > 0)).toBe(true);
    expect(allFrags.some((f) => f.fromLine > 0)).toBe(true);

    // 每个片段节点文本都应是原文子串（切片正确，不整段重复）
    const textOf = (node: { children?: unknown[]; text?: string }): string => {
      if (typeof node.text === 'string') return node.text;
      return (node.children as Array<{ children?: unknown[]; text?: string }> | undefined)
        ?.map(textOf)
        .join('') ?? '';
    };
    for (const frag of allFrags) {
      const t = textOf(frag.node as never);
      if (t.length > 0) expect(full.includes(t)).toBe(true);
    }
    disposeMeasureSheet();
  });

  it('增量重排：fromBlockId + previous 与全量构建同构（阶段五）', () => {
    const doc = docWithParagraphs(['仁义礼智信忠孝节悌'.repeat(400), '子曰学而时习之不亦说乎'.repeat(300)]);
    const full = buildPagedLayout({ doc, options: DEFAULT_LAYOUT_OPTIONS });
    expect(full.usable).toBe(true);
    const target = full.blocks[1]?.id ?? full.blocks[0]!.id;
    const inc = buildPagedLayout({ doc, options: DEFAULT_LAYOUT_OPTIONS, fromBlockId: target, previous: full });
    expect(inc.usable).toBe(full.usable);
    expect(inc.pages.length).toBe(full.pages.length);
    expect(inc.pages.map((p) => p.fragments.map((f) => `${f.blockId}@${f.fromLine}:${f.lineCount}`)))
      .toEqual(full.pages.map((p) => p.fragments.map((f) => `${f.blockId}@${f.fromLine}:${f.lineCount}`)));
    // 未变块切片节点复用（同一对象引用）
    const reuse = full.pages
      .flatMap((p) => p.fragments)
      .filter((f) => f.blockId !== target && f.lineCount > 0);
    const same = new Set(inc.pages.flatMap((p) => p.fragments).map((f) => f.node));
    for (const frag of reuse) expect(same.has(frag.node)).toBe(true);
    disposeMeasureSheet();
  });

  it('定点实测：targetBlockId 命中旧尺寸缓存时走探针路径并保留未测块缓存', () => {
    const doc = docWithParagraphs(['仁义礼智信忠孝节悌'.repeat(400), '子曰学而时习之不亦说乎'.repeat(300)]);
    const full = buildPagedLayout({ doc, options: DEFAULT_LAYOUT_OPTIONS });
    // 注入全量尺寸缓存（模拟真实浏览器实测产物），使探针「全部块 id ⊆ prev.sizes」成立
    const prev = {
      ...full,
      sizes: new Map(full.blocks.map((b) => [b.id, 300 + b.id.length])),
    };
    const target = full.blocks[1]!.id;
    const inc = buildPagedLayout({
      doc,
      options: DEFAULT_LAYOUT_OPTIONS,
      fromBlockId: target,
      targetBlockId: target,
      previous: prev,
    });
    expect(inc.usable).toBe(true);
    // 未重测块沿用缓存值；本轮实测（happy-dom 空映射）不覆盖
    expect(inc.sizes.get('p-0')).toBe(prev.sizes.get('p-0'));
    expect(inc.sizes.get('p-1')).toBe(prev.sizes.get('p-1'));
    // 块序列与分页骨架保持稳定
    expect(inc.blocks.map((b) => b.id)).toEqual(full.blocks.map((b) => b.id));
    disposeMeasureSheet();
  });

  it('定点增量分页：目标块之后的分页与全量构建同构（P3）', () => {
    const texts = Array.from({ length: 12 }, (_, index) => `第${index + 1}段`.repeat(120));
    const doc = docWithParagraphs(texts);
    const full = buildPagedLayout({ doc, options: DEFAULT_LAYOUT_OPTIONS });
    expect(full.pages.length).toBeGreaterThan(3);
    const target = full.blocks[6]!.id;
    // 注入尺寸缓存，让探针「全部块 id ⊆ prev.sizes」成立 → 走定点 + 增量分页
    const prev = {
      ...full,
      sizes: new Map(full.blocks.map((block) => [block.id, block.mainSize])),
    };
    const inc = buildPagedLayout({
      doc,
      options: DEFAULT_LAYOUT_OPTIONS,
      fromBlockId: target,
      targetBlockId: target,
      previous: prev,
    });
    // 前缀页 + 续排结果必须与整本重排完全一致（续排只是省成本，不改结果）
    const signature = (pages: readonly { fragments: readonly { blockId: string; fromLine: number; lineCount: number }[] }[]) =>
      pages.map((page) =>
        page.fragments.map((frag) => `${frag.blockId}@${frag.fromLine}:${frag.lineCount}`),
      );
    expect(signature(inc.pages)).toEqual(signature(full.pages));
    disposeMeasureSheet();
  });

  it('增量重排删块后：三表裁剪陈旧项（回删并段不留幽灵缓存）', () => {
    const doc = docWithParagraphs(['子曰学而时习之不亦说乎'.repeat(200), '有朋自远方来不亦乐乎'.repeat(200)]);
    // 注入尺寸缓存（happy-dom 无实测产物），使裁剪逻辑可观察
    const full = {
      ...buildPagedLayout({ doc, options: DEFAULT_LAYOUT_OPTIONS }),
      sizes: new Map([
        ['p-0', 300],
        ['p-1', 400],
      ]),
      lineOffsets: new Map([['p-1', [0, 26]]]),
      lineSizes: new Map([['p-1', 30]]),
    };
    expect(full.sizes.has('p-0')).toBe(true);
    expect(full.sizes.has('p-1')).toBe(true);

    // 模拟回删并段：p-1 文本并入 p-0，p-1 消失
    const shrunk = docWithParagraphs([
      '子曰学而时习之不亦说乎'.repeat(200) + '有朋自远方来不亦乐乎'.repeat(200),
    ]);
    const inc = buildPagedLayout({
      doc: shrunk,
      options: DEFAULT_LAYOUT_OPTIONS,
      fromBlockId: 'p-0',
      previous: full,
    });
    expect(inc.blocks.map((b) => b.id)).toEqual(['p-0']);
    expect(inc.sizes.has('p-1')).toBe(false);
    expect(inc.lineOffsets.has('p-1')).toBe(false);
    expect(inc.lineSizes.has('p-1')).toBe(false);
    disposeMeasureSheet();
  });

  it('片段 node 惰性切片：文本为原文子串且重复访问同一引用', () => {
    const full = '仁义礼智信忠孝节悌'.repeat(400);
    const result = buildPagedLayout({
      doc: docWithParagraphs([full]),
      options: DEFAULT_LAYOUT_OPTIONS,
    });
    const split = result.pages.flatMap((p) => p.fragments).find((f) => f.lineCount > 0);
    expect(split).toBeDefined();
    const first = split!.node;
    expect(split!.node).toBe(first); // 闭包缓存：二次访问不再切片
    const textOf = (node: { children?: unknown[]; text?: string }): string =>
      typeof node.text === 'string'
        ? node.text
        : (node.children as Array<{ children?: unknown[]; text?: string }> | undefined)
              ?.map(textOf)
              .join('') ?? '';
    const t = textOf(first as never);
    if (t.length > 0) expect(full.includes(t)).toBe(true);
    disposeMeasureSheet();
  });
});

describe('usePagedLayout 重排守卫（阶段五）', () => {
  it('纯选区事务不重排；文档事务重建并产出块索引', () => {
    const scope = effectScope();
    let api!: ReturnType<typeof usePagedLayout>;
    let editor!: BookEditor;
    scope.run(() => {
      editor = new BookEditor({
        schema: buildEditorSchema(),
        document: docWithParagraphs(['子曰学而时习之']),
      });
      api = usePagedLayout({
        editor,
        options: ref<LayoutOptions>(DEFAULT_LAYOUT_OPTIONS),
        tokens: ref<Readonly<Record<string, string | undefined>>>(DEFAULT_THEME),
        fontToken: ref<string | undefined>(undefined),
        version: ref(0),
      });
      api.relayout(undefined, true);
    });
    expect(api.usable.value).toBe(true);
    expect(api.pagedIndex.value).not.toBeNull();
    const pages1 = api.pages.value;

    // 选区事务：doc 引用不变 → 守卫跳过，pages 同一引用
    const selTr = editor.editorState.tr;
    selTr.setSelection(TextSelection.create(selTr.doc, 2));
    editor.dispatch(selTr);
    api.relayout();
    expect(api.pages.value).toBe(pages1);

    // 文档事务：doc 变化 → 重排并刷新索引
    const docTr = editor.editorState.tr;
    docTr.insertText('X', 2);
    editor.dispatch(docTr);
    api.relayout();
    expect(api.pages.value).not.toBe(pages1);
    scope.stop();
    disposeMeasureSheet();
  });
});
