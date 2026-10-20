/**
 * PDF 导出测试
 *
 * 覆盖：块 id → 节点解析（findNodeById 代理导出）、打印样式（@page 两种模式）、
 * 打印文档（auto 单文档流 / paged 预分页 + 页码）、
 * 浏览器打印辅助（打印流程与清理），以及空书边界。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_THEME,
  NODE_TYPES,
  createEmptyDocument,
  type BookDocument,
} from '@bibliotype/core';
import {
  CLASSICAL_LAYOUT_OPTIONS,
  DEFAULT_LAYOUT_OPTIONS,
  FACSIMILE_PRESETS,
} from '@bibliotype/layout';
import { type BlockSizeEstimator } from '@bibliotype/reader';
import { findNodeById } from '../index.js';
import { renderPrintHtml } from '../print-document.js';
import { buildPrintCss } from '../print-styles.js';
import { printHtml } from '../print.js';

/** 尺寸表估算器：按节点 id 取尺寸 */
function fixedEstimator(sizes: Record<string, number>): BlockSizeEstimator {
  return (node) => sizes[node.id ?? ''] ?? 50;
}

/** 构造样本：书 > 章（标题 + 段） + 章（段） + 散段 */
function sampleDoc(): BookDocument {
  const doc = createEmptyDocument({ title: '论语', language: 'zh-Hant' });
  doc.root.children = [
    {
      type: NODE_TYPES.CHAPTER,
      id: 'chap-1',
      attrs: { title: '学而' },
      children: [
        {
          type: NODE_TYPES.HEADING,
          id: 'h-1',
          attrs: { level: 2 },
          children: [{ type: 'text', text: '学而第一' }],
        },
        {
          type: NODE_TYPES.PARAGRAPH,
          id: 'p-1',
          children: [{ type: 'text', text: '子曰：学而时习之。' }],
        },
      ],
    },
    {
      type: NODE_TYPES.CHAPTER,
      id: 'chap-2',
      attrs: { title: '为政' },
      children: [
        {
          type: NODE_TYPES.PARAGRAPH,
          id: 'p-2',
          children: [{ type: 'text', text: '为政以德。' }],
        },
      ],
    },
    {
      type: NODE_TYPES.PARAGRAPH,
      id: 'p-3',
      children: [{ type: 'text', text: '散段。' }],
    },
  ];
  return doc;
}

/** 块尺寸：h-1=30, p-1=60, p-2=60, p-3=100；页主轴 100 */
const SIZES = { 'h-1': 30, 'p-1': 60, 'p-2': 60, 'p-3': 100 };
const PAGE_MAIN = 100;

describe('findNodeById（经公共入口代理 reader 导出）', () => {
  it('节点 id 与树路径均可解析', () => {
    const doc = sampleDoc();
    expect(findNodeById(doc.root, 'p-1')?.id).toBe('p-1');
    /* 文本叶子被过滤：'/1' 指向第二章 */
    expect(findNodeById(doc.root, '/1')?.id).toBe('chap-2');
    expect(findNodeById(doc.root, '/9')).toBeUndefined();
  });
});

describe('buildPrintCss', () => {
  it('auto 模式：@page 尺寸 / 页边距 + 结构节点另起页', () => {
    const css = buildPrintCss({
      options: DEFAULT_LAYOUT_OPTIONS,
      tokens: {},
      mode: 'auto',
    });
    expect(css).toContain('size: 559px 794px;');
    expect(css).toContain('margin: 48px 56px;');
    expect(css).toContain('.bt-chapter');
    expect(css).toContain('break-before: page;');
    expect(css).toContain('.bt-book > :first-child');
    expect(css).not.toContain('.bt-page {');
  });

  it('paged 模式：@page 无边距 + 固定尺寸 .bt-page + 页码样式', () => {
    const css = buildPrintCss({
      options: DEFAULT_LAYOUT_OPTIONS,
      tokens: {},
      mode: 'paged',
    });
    expect(css).toContain('margin: 0;');
    expect(css).toContain('width: 559px;');
    expect(css).toContain('padding: 48px 56px;');
    expect(css).toContain('break-after: page;');
    expect(css).toContain('.bt-page-number');
    expect(css).toContain('var(--bt-font-size-note)');
  });

  it('page-margin 令牌可覆盖页边距', () => {
    const css = buildPrintCss({
      options: DEFAULT_LAYOUT_OPTIONS,
      tokens: { 'page-margin': '32px 40px' },
      mode: 'auto',
    });
    expect(css).toContain('margin: 32px 40px;');
  });
});

describe('renderPrintHtml：auto 模式', () => {
  it('整书单文档流 + 内联样式（变量层与打印规则）', () => {
    const html = renderPrintHtml(sampleDoc());

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html lang="zh-Hant">');
    expect(html).toContain('<title>论语</title>');
    expect(html).toContain('<main class="bt-book">');
    expect(html).toContain('<section id="chap-1" class="bt-chapter" data-title="学而">');
    expect(html).toContain('<h2 id="h-1" class="bt-heading" data-level="2">学而第一</h2>');
    expect(html).toContain('子曰：学而时习之。');
  });

  it('内联样式同时包含书册变量与 @page 规则', () => {
    const html = renderPrintHtml(sampleDoc(), { mode: 'auto' });
    expect(html).toContain('--bt-font-family-body:');
    expect(html).toContain('@page {');
    expect(html).toContain('size: 559px 794px;');
    expect(html).not.toContain('class="bt-page"');
  });

  it('古籍布局：直排 CSS 与 16 开页面尺寸', () => {
    const html = renderPrintHtml(sampleDoc(), {
      layout: CLASSICAL_LAYOUT_OPTIONS,
      tokens: { 'writing-mode': 'vertical-rl' },
    });
    expect(html).toContain('writing-mode: vertical-rl;');
    expect(html).toContain('size: 699px 983px;');
  });
});

describe('renderPrintHtml：paged 模式（预分页）', () => {
  it('按块尺寸分页：章首另起页 + 页码格式化', () => {
    const html = renderPrintHtml(sampleDoc(), {
      mode: 'paged',
      pageMainSize: PAGE_MAIN,
      estimator: fixedEstimator(SIZES),
    });

    /* 3 页：h-1+p-1 / p-2（章首 breakBefore）/ p-3 */
    expect(html.match(/class="bt-page"/g)).toHaveLength(3);
    expect(html).toContain('data-page="1"');
    expect(html).toContain('data-page="2"');
    expect(html).toContain('data-page="3"');

    const page1 = html.indexOf('data-page="1"');
    const page2 = html.indexOf('data-page="2"');
    const page3 = html.indexOf('data-page="3"');
    expect(page2).toBeGreaterThan(page1);
    expect(page3).toBeGreaterThan(page2);

    /* 第 1 页容纳标题与首段；第 2 页为第二章；第 3 页为散段 */
    const firstPage = html.slice(page1, page2);
    expect(firstPage).toContain('<h2 id="h-1" class="bt-heading" data-level="2">学而第一</h2>');
    expect(firstPage).toContain('子曰：学而时习之。');
    expect(firstPage).toContain('<div class="bt-page-number">1</div>');

    const secondPage = html.slice(page2, page3);
    expect(secondPage).toContain('为政以德。');
    expect(secondPage).not.toContain('学而第一');

    const thirdPage = html.slice(page3);
    expect(thirdPage).toContain('散段。');
    expect(thirdPage).toContain('<div class="bt-page-number">3</div>');
  });

  it('古籍页码样式：中文数字', () => {
    const html = renderPrintHtml(sampleDoc(), {
      mode: 'paged',
      layout: CLASSICAL_LAYOUT_OPTIONS,
      pageMainSize: PAGE_MAIN,
      estimator: fixedEstimator(SIZES),
    });
    expect(html).toContain('<div class="bt-page-number">一</div>');
    expect(html).toContain('<div class="bt-page-number">三</div>');
  });

  it('空书：输出单张空白页', () => {
    const html = renderPrintHtml(createEmptyDocument({ title: '空书' }), {
      mode: 'paged',
      pageMainSize: PAGE_MAIN,
    });
    expect(html.match(/class="bt-page"/g)).toHaveLength(1);
    expect(html).toContain('<section class="bt-page" data-page="1"></section>');
  });

  it('rewriteSrc 透传：auto / paged 两路的 img src 均被改写（降级路径 blob 化）', () => {
    const doc = createEmptyDocument({ title: '带图' });
    doc.root.children = [
      {
        type: NODE_TYPES.CHAPTER,
        id: 'c-1',
        children: [
          {
            type: NODE_TYPES.PARAGRAPH,
            id: 'p-1',
            children: [
              { type: NODE_TYPES.IMAGE, attrs: { src: 'data:image/png;base64,AAA' }, children: [] },
            ],
          },
        ],
      },
    ];

    const auto = renderPrintHtml(doc, {
      mode: 'auto',
      rewriteSrc: (src) => (src.startsWith('data:') ? 'blob:mock' : undefined),
    });
    expect(auto).toContain('src="blob:mock"');
    expect(auto).not.toContain('data:image/png;base64,AAA');

    const paged = renderPrintHtml(doc, {
      mode: 'paged',
      pageMainSize: PAGE_MAIN,
      estimator: () => 20,
      rewriteSrc: (src) => (src.startsWith('data:') ? 'blob:mock' : undefined),
    });
    expect(paged).toContain('src="blob:mock"');
    expect(paged).not.toContain('data:image/png;base64,AAA');
  });

  it('默认 pageMainSize：按页面尺寸与 page-margin 推导（A5 横排）', () => {
    /* A5 高 794 - 2×48 = 698；默认估算器 4 块各约 42px，
       但两章章首 breakBefore → [h-1,p-1] / [p-2,p-3] 共 2 页 */
    const html = renderPrintHtml(sampleDoc(), { mode: 'paged' });
    expect(html.match(/class="bt-page"/g)).toHaveLength(2);
    expect(html).toContain('data-page="2"');
  });

  it('跨页段落按行切片：续页不重复前页文本（与预览同源）', () => {
    /* 单段 78 字，每行 26 字；mainSize=90 / lineSize=30 → 3 行；页主轴 60 → 拆两页 */
    const doc = createEmptyDocument({ title: '切片' });
    doc.root.children = [
      {
        type: NODE_TYPES.PARAGRAPH,
        id: 'p-1',
        children: [{ type: 'text', text: 'A'.repeat(26) + 'B'.repeat(26) + 'C'.repeat(26) }],
      },
    ];
    const html = renderPrintHtml(doc, {
      mode: 'paged',
      pageMainSize: 60,
      context: { charsPerLine: 26, lineSize: 30 },
      estimator: () => 90,
    });

    const pages = html.split('class="bt-page"').slice(1);
    expect(pages.length).toBe(2);
    /* 首页含 A、B 不含 C；续页含 C 不含 A/B（无整段重复） */
    expect(pages[0]).toContain('A');
    expect(pages[0]).toContain('B');
    expect(pages[0]).not.toContain('C');
    expect(pages[1]).toContain('C');
    expect(pages[1]).not.toContain('A');
    /* 各字符总次数 = 源次数（切片不重复） */
    const body = pages.join('');
    expect((body.match(/A/g) ?? []).length).toBe(26);
    expect((body.match(/C/g) ?? []).length).toBe(26);
  });
});

describe('古籍仿真直排：打印与预览同源', () => {
  const preset = FACSIMILE_PRESETS[0] as NonNullable<(typeof FACSIMILE_PRESETS)[0]>;
  const layout = preset.layout;
  const tokens = { ...DEFAULT_THEME, ...preset.tokens };

  it('paged 模式输出版框 / 界行 / 版心，页边距含版心带宽', () => {
    const html = renderPrintHtml(sampleDoc(), {
      mode: 'paged',
      layout,
      tokens,
      fontToken: preset.fontToken,
      pageMainSize: PAGE_MAIN,
      estimator: fixedEstimator(SIZES),
    });
    expect(html).toContain('.bt-page::before');
    expect(html).toContain('.bt-page::after');
    expect(html).toContain('class="bt-page-gutter"');
    /* 页边距左 90 + 版心带宽 34 */
    expect(html).toContain('padding-left: 124px;');
  });

  it('auto 模式不加装饰（交给打印引擎重排流式版面）', () => {
    const html = renderPrintHtml(sampleDoc(), {
      mode: 'auto',
      layout,
      tokens,
      fontToken: preset.fontToken,
    });
    expect(html).not.toContain('.bt-page::before');
    expect(html).not.toContain('bt-page-gutter');
    expect(html).not.toContain('--bt-fs-');
  });

  it('古典布局打印产物不含任何仿真痕迹', () => {
    const html = renderPrintHtml(sampleDoc(), {
      mode: 'paged',
      layout: CLASSICAL_LAYOUT_OPTIONS,
      pageMainSize: PAGE_MAIN,
      estimator: fixedEstimator(SIZES),
    });
    expect(html).not.toContain('bt-page-gutter');
    expect(html).not.toContain('--bt-fs-');
  });
});

describe('printHtml（浏览器打印辅助）', () => {
  it('无 document 环境抛出错误', () => {
    expect(() => printHtml('<html></html>')).toThrow(/浏览器环境/);
  });

  it('经隐藏 iframe 写入文档并触发打印，afterprint 后清理', () => {
    const fake = createFakeDocument();
    printHtml('<html><body>x</body></html>', { document: fake.doc });

    expect(fake.written()).toBe('<html><body>x</body></html>');
    expect(fake.printed()).toBe(1);
    expect(fake.frame.removed).toBe(false);

    fake.fireAfterPrint();
    expect(fake.frame.removed).toBe(true);
  });

  it('iframe 上下文不可用时抛错并清理', () => {
    const fake = createFakeDocument({ contentDocument: null });
    expect(() => printHtml('<html></html>', { document: fake.doc })).toThrow(/iframe/);
    expect(fake.frame.removed).toBe(true);
  });

  it('onAfterPrint：打印结束后回调（释放 blob URL 等资源）', () => {
    const fake = createFakeDocument();
    const after = vi.fn();
    printHtml('<html><body>x</body></html>', { document: fake.doc, onAfterPrint: after });

    expect(after).not.toHaveBeenCalled();
    fake.fireAfterPrint();
    expect(after).toHaveBeenCalledTimes(1);
    expect(fake.frame.removed).toBe(true);
  });
});

/** 假 iframe 结构（结构化宿主，验证打印流程与清理时序） */
interface FakeFrame {
  style: Record<string, string>;
  removed: boolean;
  setAttribute(name: string, value: string): void;
  remove(): void;
  contentDocument: FakeFrameDocument | null;
  contentWindow: FakeFrameWindow;
}

interface FakeFrameDocument {
  open(): void;
  write(html: string): void;
  close(): void;
}

interface FakeFrameWindow {
  addEventListener(name: string, callback: () => void): void;
  removeEventListener(name: string): void;
  focus(): void;
  print(): void;
}

/** 构造假 document：createElement('iframe') + body.appendChild */
function createFakeDocument(overrides: { contentDocument?: null } = {}) {
  const listeners = new Map<string, () => void>();
  let written = '';
  let printed = 0;

  const frame: FakeFrame = {
    style: {},
    removed: false,
    setAttribute(): void {},
    remove(): void {
      frame.removed = true;
    },
    contentDocument:
      'contentDocument' in overrides
        ? overrides.contentDocument ?? null
        : {
            open(): void {},
            write(html: string): void {
              written += html;
            },
            close(): void {},
          },
    contentWindow: {
      addEventListener(name: string, callback: () => void): void {
        listeners.set(name, callback);
      },
      removeEventListener(name: string): void {
        listeners.delete(name);
      },
      focus(): void {},
      print(): void {
        printed += 1;
      },
    },
  };

  const doc = {
    createElement: () => frame,
    body: { appendChild: () => {} },
  };

  return {
    doc: doc as unknown as Document,
    frame,
    written: () => written,
    printed: () => printed,
    fireAfterPrint: () => listeners.get('afterprint')?.(),
  };
}

describe('renderPrintHtml：页眉 / 页脚', () => {
  /** 只取 <body> 片段：CSS 里恒有 .bt-page-header / .bt-page-number 规则，不能整篇断言 */
  const bodyOf = (html: string): string => html.slice(html.indexOf('<body>'));

  const CHROME_LAYOUT = {
    ...DEFAULT_LAYOUT_OPTIONS,
    pageChrome: {
      header: 'bookTitle',
      footer: 'pageNumber',
      headerSize: 26,
      footerSize: 26,
    },
  } as typeof DEFAULT_LAYOUT_OPTIONS;

  it('未启用：保持老的「页脚仅页码」，不输出页眉页脚节点', () => {
    const html = renderPrintHtml(sampleDoc(), {
      mode: 'paged',
      pageMainSize: PAGE_MAIN,
      estimator: fixedEstimator(SIZES),
    });
    const body = bodyOf(html);
    expect(body).not.toContain('bt-page-header');
    expect(body).not.toContain('bt-page-footer');
    expect(body).toContain('<div class="bt-page-number">1</div>');
  });

  it('启用：逐页注入书名页眉 + 页码页脚，且不再输出 .bt-page-number', () => {
    const html = renderPrintHtml(sampleDoc(), {
      mode: 'paged',
      layout: CHROME_LAYOUT,
      pageMainSize: PAGE_MAIN,
      estimator: fixedEstimator(SIZES),
    });
    const body = bodyOf(html);
    expect(body).toContain('<div class="bt-page-header">论语</div>');
    expect(body).toContain('<div class="bt-page-footer">1</div>');
    expect(body).toContain('<div class="bt-page-footer">3</div>');
    expect(body).not.toContain('bt-page-number');
  });

  it('章名页眉取该页首块的最近结构祖先（页首即标题时用标题自身）', () => {
    const html = renderPrintHtml(sampleDoc(), {
      mode: 'paged',
      layout: {
        ...DEFAULT_LAYOUT_OPTIONS,
        pageChrome: {
          header: 'chapterTitle',
          footer: 'none',
          headerSize: 26,
          footerSize: 0,
        },
      },
      pageMainSize: PAGE_MAIN,
      estimator: fixedEstimator(SIZES),
    });
    // 第 1 页页首是标题本身 → 用标题文本；第 2 页页首是章内段落 → 用章名
    const body = bodyOf(html);
    expect(body).toContain('<div class="bt-page-header">学而第一</div>');
    expect(body).toContain('<div class="bt-page-header">为政</div>');
    // 页脚字段为 none → 页码一并不显示（页码属页脚内容）
    expect(body).not.toContain('bt-page-footer');
    expect(body).not.toContain('bt-page-number');
  });

  it('封面页不标页眉页脚', () => {
    const doc = sampleDoc();
    doc.root.children = [
      {
        type: NODE_TYPES.COVER,
        id: 'cover',
        children: [{ type: NODE_TYPES.PARAGRAPH, id: 'cover-p', children: [{ type: 'text', text: '封面' }] }],
      },
      ...(doc.root.children ?? []),
    ];
    const html = renderPrintHtml(doc, {
      mode: 'paged',
      layout: CHROME_LAYOUT,
      pageMainSize: PAGE_MAIN,
      estimator: fixedEstimator({ ...SIZES, 'cover-p': 200 }),
    });
    const body = bodyOf(html);
    const first = body.slice(body.indexOf('data-page="1"'), body.indexOf('data-page="2"'));
    expect(first).toContain('封面');
    expect(first).not.toContain('bt-page-header');
    expect(first).not.toContain('bt-page-footer');
    // 第 2 页起恢复正常
    expect(body).toContain('<div class="bt-page-header">论语</div>');
  });

  it('构建版式变量：启用时 .bt-page 下发页眉 / 页脚占位高度', () => {
    const css = buildPrintCss({ options: CHROME_LAYOUT, tokens: {}, mode: 'paged' });
    expect(css).toContain('--bt-page-header-size: 26px;');
    expect(css).toContain('--bt-page-footer-size: 26px;');

    const none = buildPrintCss({ options: DEFAULT_LAYOUT_OPTIONS, tokens: {}, mode: 'paged' });
    expect(none).not.toContain('--bt-page-header-size');
  });
});
