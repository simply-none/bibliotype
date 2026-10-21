/**
 * 注释交互（D9）测试：注码跳转、注文回跳、双向高亮、预览开关、
 * 上下条循环与键盘入口，以及 BtBookView 的委托接线。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import {
  MARK_TYPES,
  NODE_TYPES,
  createEmptyDocument,
  type BookDocument,
  type BookNode,
} from '@bibliotype/core';
import { Reader, type BlockSizeEstimator } from '@bibliotype/reader';
import BtBookView from '../components/BtBookView.vue';
import { NOTE_ACTIVE_CLASS, useNoteInteraction } from '../use-note-interaction.js';

/** 构造：一段带两种注引用 + 两条脚注（浮注后分居两页） */
function noteDoc(): BookDocument {
  const doc = createEmptyDocument({ title: '注' });
  const paragraph: BookNode = {
    type: NODE_TYPES.PARAGRAPH,
    id: 'p-1',
    children: [
      { type: 'text', text: '子曰' },
      {
        type: 'text',
        text: '1',
        marks: [{ type: MARK_TYPES.NOTE_REF, attrs: { targetId: 'fn-1', refId: 'ref-1' } }],
      },
      {
        type: 'text',
        text: '2',
        marks: [{ type: MARK_TYPES.NOTE_REF, attrs: { targetId: 'fn-2', refId: 'ref-2' } }],
      },
    ],
  };
  doc.root.children = [
    paragraph,
    {
      type: NODE_TYPES.FOOTNOTE,
      id: 'fn-1',
      attrs: { marker: '1', refId: 'ref-1' },
      children: [{ type: NODE_TYPES.PARAGRAPH, children: [{ type: 'text', text: '注一' }] }],
    },
    {
      type: NODE_TYPES.FOOTNOTE,
      id: 'fn-2',
      attrs: { marker: '2', refId: 'ref-2' },
      children: [{ type: NODE_TYPES.PARAGRAPH, children: [{ type: 'text', text: '注二' }] }],
    },
  ];
  return doc;
}

const SIZES: Record<string, number> = { 'p-1': 200, 'fn-1': 120, 'fn-2': 120 };

/** 固定尺寸估算器 */
function estimator(): BlockSizeEstimator {
  return (node) => SIZES[node.id ?? ''] ?? 100;
}

/** 浮注阅读器：页容量 600、注区上限 0.2（120）→ 两注分页 */
function createReader(): Reader {
  const reader = new Reader({
    pageMainSize: 600,
    bottomSlack: 0,
    footnoteFloat: true,
    noteMaxRatio: 0.2,
    estimator: estimator(),
  });
  reader.loadDocument(noteDoc());
  return reader;
}

/** 构造委托容器（挂载前的静态 HTML，模拟 v-html 输出） */
function containerOf(html: string): HTMLElement {
  const element = document.createElement('div');
  element.innerHTML = html;
  return element;
}

const NOTEREF_HTML =
  '<p><a id="ref-1" class="bt-mark-noteref" href="#fn-1">1</a>' +
  '<a id="ref-2" class="bt-mark-noteref" href="#fn-2">2</a></p>';

afterEach(() => {
  vi.useRealTimers();
});

describe('useNoteInteraction：跳转与回跳', () => {
  it('点击注码 → 跨页翻到注文页并高亮双向元素', async () => {
    const reader = createReader();
    const requested: number[] = [];
    const interaction = useNoteInteraction({
      reader,
      onRequestPage: (page) => {
        requested.push(page);
        return reader.goToPage(page);
      },
    });
    const container = containerOf(NOTEREF_HTML);
    interaction.attach(container);

    const noteref = container.querySelector('.bt-mark-noteref') as HTMLElement;
    interaction.onClick({
      target: noteref,
      preventDefault: vi.fn(),
    } as unknown as MouseEvent);
    await nextTick();
    await nextTick();

    expect(requested).toEqual([0]);
    expect(interaction.activeNoteId.value).toBe('fn-1');
    expect(noteref.classList.contains(NOTE_ACTIVE_CLASS)).toBe(true);
  });

  it('注文已在当前页时不触发翻页，直接高亮注条', () => {
    const reader = createReader();
    const requested: number[] = [];
    const interaction = useNoteInteraction({
      reader,
      onRequestPage: (page) => {
        requested.push(page);
        return true;
      },
    });
    const container = containerOf(
      NOTEREF_HTML +
        '<div class="bt-page-notes"><div class="bt-page-note" data-note-id="fn-1">' +
        '<aside class="bt-footnote" data-note-id="fn-1">' +
        '<span class="bt-note-marker" data-note-ref="ref-1">1</span>注一</aside></div></div>',
    );
    interaction.attach(container);

    expect(interaction.goToNote('fn-1')).toBe(true);
    expect(requested).toEqual([]);
    const note = container.querySelector('.bt-page-note') as HTMLElement;
    expect(note.classList.contains(NOTE_ACTIVE_CLASS)).toBe(true);
  });

  it('点击回跳符号 → 回到正文注码（同页命中 id）', () => {
    const reader = createReader();
    const interaction = useNoteInteraction({ reader });
    const container = containerOf(
      NOTEREF_HTML +
        '<div class="bt-page-note" data-note-id="fn-1">' +
        '<a class="bt-note-backref" href="#ref-1">↩</a></div>',
    );
    interaction.attach(container);

    const backref = container.querySelector('.bt-note-backref') as HTMLElement;
    interaction.onClick({ target: backref, preventDefault: vi.fn() } as unknown as MouseEvent);

    const anchor = container.querySelector('#ref-1') as HTMLElement;
    expect(anchor.classList.contains(NOTE_ACTIVE_CLASS)).toBe(true);
  });

  it('回跳目标不在当前页时按 refId 索引翻页', async () => {
    const reader = createReader();
    const requested: number[] = [];
    const interaction = useNoteInteraction({
      reader,
      onRequestPage: (page) => {
        requested.push(page);
        return true;
      },
    });
    interaction.attach(containerOf('<div data-note-id="fn-2"></div>'));

    expect(interaction.goToRef('ref-1', 'fn-2')).toBe(true);
    expect(requested).toEqual([0]);
  });

  it('未知注释返回 false', () => {
    const reader = createReader();
    const interaction = useNoteInteraction({ reader });
    expect(interaction.goToNote('missing')).toBe(false);
    expect(interaction.goToRef('missing-ref')).toBe(false);
  });
});

describe('useNoteInteraction：上下条与预览', () => {
  it('上下条按文档顺序循环切换', () => {
    const reader = createReader();
    const requested: number[] = [];
    const interaction = useNoteInteraction({
      reader,
      onRequestPage: (page) => {
        requested.push(page);
        return true;
      },
    });

    expect(interaction.stepNote(1)).toBe(true); // 无当前项 → 首条 fn-1
    expect(interaction.stepNote(1)).toBe(true); // fn-1 → fn-2
    expect(interaction.stepNote(1)).toBe(true); // fn-2 → 回绕 fn-1
    expect(requested).toEqual([0, 1, 0]);
  });

  it('预览从 IR 取注文纯文本（不含注码与回跳符号）', async () => {
    vi.useFakeTimers();
    const reader = createReader();
    const interaction = useNoteInteraction({ reader, previewDelayMs: 0 });
    const container = containerOf(NOTEREF_HTML);
    interaction.attach(container);

    const noteref = container.querySelector('.bt-mark-noteref') as HTMLElement;
    interaction.onPointerOver({ target: noteref } as unknown as Event);
    vi.runOnlyPendingTimers();

    expect(interaction.preview.value?.noteId).toBe('fn-1');
    expect(interaction.preview.value?.text).toBe('注一');
  });

  it('指针移出 / Esc 关闭预览', () => {
    const reader = createReader();
    const interaction = useNoteInteraction({ reader, previewDelayMs: 0 });
    const container = containerOf(NOTEREF_HTML);
    interaction.attach(container);
    const noteref = container.querySelector('.bt-mark-noteref') as HTMLElement;

    interaction.onFocusIn({ target: noteref } as unknown as FocusEvent);
    expect(interaction.preview.value).not.toBeNull();

    const escape = { key: 'Escape', preventDefault: vi.fn() } as unknown as KeyboardEvent;
    expect(interaction.handleKeydown(escape)).toBe(true);
    expect(interaction.preview.value).toBeNull();

    interaction.onFocusIn({ target: noteref } as unknown as FocusEvent);
    interaction.onPointerOut({ target: noteref, relatedTarget: null } as unknown as PointerEvent);
    expect(interaction.preview.value).toBeNull();
  });

  it('Alt+方向键被消费并切换注释；普通方向键不消费', () => {
    const reader = createReader();
    const requested: number[] = [];
    const interaction = useNoteInteraction({
      reader,
      onRequestPage: (page) => {
        requested.push(page);
        return true;
      },
    });

    const plain = { key: 'ArrowRight', altKey: false, preventDefault: vi.fn() } as unknown as KeyboardEvent;
    expect(interaction.handleKeydown(plain)).toBe(false);

    const alt = { key: 'ArrowRight', altKey: true, preventDefault: vi.fn() } as unknown as KeyboardEvent;
    expect(interaction.handleKeydown(alt)).toBe(true);
    expect(alt.preventDefault).toHaveBeenCalled();
    expect(requested).toEqual([0]);
  });

  it('无注释文档时上下条返回 false', () => {
    const doc = createEmptyDocument({ title: '无注' });
    doc.root.children = [
      { type: NODE_TYPES.PARAGRAPH, id: 'p-1', children: [{ type: 'text', text: '正文' }] },
    ];
    const reader = new Reader({ pageMainSize: 600, estimator: () => 100 });
    reader.loadDocument(doc);
    const interaction = useNoteInteraction({ reader });
    expect(interaction.stepNote(1)).toBe(false);
  });
});

describe('BtBookView 注释交互接线', () => {
  it('点击注码高亮注区、点击回跳高亮注码', async () => {
    const reader = createReader();
    const wrapper = mount(BtBookView, { props: { reader } });

    const noteref = wrapper.find('.bt-mark-noteref');
    expect(noteref.exists()).toBe(true);
    await noteref.trigger('click');
    await nextTick();

    expect(wrapper.find('.bt-page-note').classes()).toContain(NOTE_ACTIVE_CLASS);

    const backref = wrapper.find('.bt-note-backref');
    expect(backref.exists()).toBe(true);
    await backref.trigger('click');

    expect(wrapper.find('#ref-1').classes()).toContain(NOTE_ACTIVE_CLASS);
  });

  it('Alt+→ 被注释快捷键消费（不当作翻页键）', async () => {
    const reader = createReader();
    const wrapper = mount(BtBookView, { props: { reader } });

    await wrapper.find('.bt-book-view--paged').trigger('keydown', {
      key: 'ArrowRight',
      altKey: true,
    });
    await nextTick();

    // 注释快捷键命中：出现高亮元素（说明进入了注释跳转而非简单翻页）
    expect(wrapper.findAll(`.${NOTE_ACTIVE_CLASS}`).length).toBeGreaterThan(0);
  });
});
