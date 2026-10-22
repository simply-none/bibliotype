/**
 * PDF 精排测试（E8）
 *
 * 覆盖：对页镜像（auto 的 `@page :left/:right`、paged 的 recto/verso 类）、
 * 出血尺寸换算（页面 / 版心 / 裁切标记）、图片打印规则与超限 / 低 DPI /
 * 无法测量告警、位图尺寸嗅探、印前 CMYK 提示，以及「未启用不输出」负例。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, NODE_TYPES, createEmptyDocument, type BookDocument } from '@bibliotype/core';
import { DEFAULT_LAYOUT_OPTIONS, PAGE_SIZES } from '@bibliotype/layout';
import { renderPrintHtml } from '../print-document.js';
import { buildPrintCss, resolveBleedPx } from '../print-styles.js';
import {
  collectPdfImageProblems,
  readImagePixelSize,
  summarizePdfImageProblems,
} from '../print-image.js';
import { collectPrintColorAdvice, summarizePrintColorAdvice } from '../print-color.js';

/* ---------- 测试夹具 ---------- */

/** PNG 头（8 签名 + 13 长度 + IHDR + 宽高 + 5 字节其余 IHDR 字段） */
function pngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

/** GIF 头（逻辑屏幕宽高小端） */
function gifBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(13);
  bytes.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0);
  bytes[6] = width & 0xff;
  bytes[7] = (width >> 8) & 0xff;
  bytes[8] = height & 0xff;
  bytes[9] = (height >> 8) & 0xff;
  return bytes;
}

/** BMP 头（DIB 头 18 / 22 处宽高小端） */
function bmpBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(26);
  bytes.set([0x42, 0x4d], 0);
  const view = new DataView(bytes.buffer);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  return bytes;
}

/** JPEG：SOI + SOF0（宽高各 2 字节大端） */
function jpegBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array([
    0xff, 0xd8,
    /* SOF0 */
    0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x00, 0x00, 0x00, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11,
    0x01, 0x03, 0x11, 0x01,
  ]);
  bytes[7] = (height >> 8) & 0xff;
  bytes[8] = height & 0xff;
  bytes[9] = (width >> 8) & 0xff;
  bytes[10] = width & 0xff;
  return bytes;
}

/** 字节 → base64 data URI */
function dataUri(bytes: Uint8Array, mime = 'image/png'): string {
  return `data:${mime};base64,${btoa(String.fromCharCode(...bytes))}`;
}

/** 构造「若干段落，每段一张图」的文档 */
function docWithImages(images: readonly string[]): BookDocument {
  const doc = createEmptyDocument({ title: '图文' });
  doc.root.children = images.map((src, index) => ({
    type: NODE_TYPES.PARAGRAPH,
    id: `p-${index}`,
    children: [{ type: NODE_TYPES.IMAGE, id: `img-${index}`, attrs: { src }, children: [] }],
  }));
  return doc;
}

/** 构造「N 段定高文本」的文档（分页用） */
function docWithParagraphs(count: number): BookDocument {
  const doc = createEmptyDocument({ title: '分页' });
  doc.root.children = Array.from({ length: count }, (_value, index) => ({
    type: NODE_TYPES.PARAGRAPH,
    id: `p-${index}`,
    children: [{ type: 'text' as const, text: `第${index + 1}段。` }],
  }));
  return doc;
}

/* ---------- 对页镜像 ---------- */

describe('buildPrintCss：对页镜像（facing）', () => {
  it('auto 模式：@page :right / :left 页边距左右互换，中缝补偿加在内侧', () => {
    const css = buildPrintCss({
      options: DEFAULT_LAYOUT_OPTIONS,
      tokens: {},
      mode: 'auto',
      facing: { gutter: 40 },
    });
    /* 右页（recto）装订边在左：base 48 56 → 左 56+40 */
    expect(css).toContain('@page :right {\n  margin: 48px 56px 48px 96px;');
    /* 左页（verso）装订边在右：右 56+40 */
    expect(css).toContain('@page :left {\n  margin: 48px 96px 48px 56px;');
    /* 基础 @page 仍保留尺寸与对称边距 */
    expect(css).toContain('size: 559px 794px;');
  });

  it('facing: true 等价空对象：gutter 缺省 0，只镜像不加宽', () => {
    const css = buildPrintCss({
      options: DEFAULT_LAYOUT_OPTIONS,
      tokens: {},
      mode: 'auto',
      facing: true,
    });
    expect(css).toContain('@page :right {\n  margin: 48px 56px 48px 56px;');
    expect(css).toContain('@page :left {\n  margin: 48px 56px 48px 56px;');
  });

  it('paged 模式：recto / verso 四边 padding 全量重写', () => {
    const css = buildPrintCss({
      options: DEFAULT_LAYOUT_OPTIONS,
      tokens: {},
      mode: 'paged',
      facing: { gutter: 40 },
    });
    expect(css).toContain('.bt-page-recto {\n  padding: 48px 56px 48px 96px;');
    expect(css).toContain('.bt-page-verso {\n  padding: 48px 96px 48px 56px;');
  });

  it('A4 对页：页边距镜像（验收口径）', () => {
    const css = buildPrintCss({
      options: { ...DEFAULT_LAYOUT_OPTIONS, pageSize: PAGE_SIZES.A4 },
      tokens: DEFAULT_THEME,
      mode: 'paged',
      facing: { gutter: 38 },
    });
    expect(css).toContain('size: 794px 1123px;');
    expect(css).toContain('.bt-page-recto {\n  padding: 48px 56px 48px 94px;');
    expect(css).toContain('.bt-page-verso {\n  padding: 48px 94px 48px 56px;');
  });

  it('未启用对页：不输出镜像规则（负例）', () => {
    const auto = buildPrintCss({ options: DEFAULT_LAYOUT_OPTIONS, tokens: {}, mode: 'auto' });
    expect(auto).not.toContain(':right');
    const paged = buildPrintCss({ options: DEFAULT_LAYOUT_OPTIONS, tokens: {}, mode: 'paged' });
    expect(paged).not.toContain('bt-page-recto');
  });
});

/* ---------- 出血与裁切线 ---------- */

describe('出血与裁切线', () => {
  it('resolveBleedPx：mm → 96dpi 像素（负数 / 非有限值归零）', () => {
    expect(resolveBleedPx(3)).toBe(11);
    expect(resolveBleedPx(5)).toBe(19);
    expect(resolveBleedPx(0)).toBe(0);
    expect(resolveBleedPx(-3)).toBe(0);
    expect(resolveBleedPx(Number.NaN)).toBe(0);
  });

  it('paged：页面与 .bt-page 同步 +2b，padding 四边 +b（版心不变）', () => {
    const css = buildPrintCss({
      options: DEFAULT_LAYOUT_OPTIONS,
      tokens: {},
      mode: 'paged',
      bleed: 3,
    });
    expect(css).toContain('size: 581px 816px;');
    expect(css).toContain('width: 581px;');
    expect(css).toContain('height: 816px;');
    /* 48+11 56+11 48+11 56+11（上下 / 左右相等，折叠为两值简写） */
    expect(css).toContain('padding: 59px 67px;');
  });

  it('auto：@page 尺寸/页边距外扩，并下发 marks / bleed 描述符', () => {
    const css = buildPrintCss({
      options: DEFAULT_LAYOUT_OPTIONS,
      tokens: {},
      mode: 'auto',
      bleed: 3,
    });
    expect(css).toContain('size: 581px 816px;');
    expect(css).toContain('margin: 59px 67px;');
    expect(css).toContain('marks: crop cross;');
    expect(css).toContain('bleed: 3mm;');
  });

  it('cropMarks：paged 输出四角 L 形标记（臂长 = 出血）', () => {
    const css = buildPrintCss({
      options: DEFAULT_LAYOUT_OPTIONS,
      tokens: {},
      mode: 'paged',
      bleed: 3,
      cropMarks: true,
    });
    expect(css).toContain('.bt-crop-marks {');
    expect(css).toContain('width: 11px;');
    expect(css).toContain('.bt-crop-marks i:nth-child(4)');
    /* 四个角的朝向边：右上画左 + 下，左下画右 + 上 */
    expect(css).toContain('border-left-width: 0.5px;\n  border-bottom-width: 0.5px;');
    expect(css).toContain('border-right-width: 0.5px;\n  border-top-width: 0.5px;');
  });

  it('出血为 0 时不输出裁切标记（负例）', () => {
    const css = buildPrintCss({
      options: DEFAULT_LAYOUT_OPTIONS,
      tokens: {},
      mode: 'paged',
      cropMarks: true,
    });
    expect(css).not.toContain('bt-crop-marks');
  });

  it('renderPrintHtml：逐页注入裁切标记，且对页类按奇偶交替', () => {
    const html = renderPrintHtml(docWithParagraphs(3), {
      mode: 'paged',
      pageMainSize: 100,
      estimator: () => 100,
      bleed: 3,
      cropMarks: true,
      facing: { gutter: 40 },
    });
    expect(html.match(/class="bt-page bt-page-recto"/g)).toHaveLength(2);
    expect(html.match(/class="bt-page bt-page-verso"/g)).toHaveLength(1);
    expect(html.match(/class="bt-crop-marks"/g)).toHaveLength(3);
    expect(html).toContain('<div class="bt-crop-marks" aria-hidden="true"><i></i><i></i><i></i><i></i></div>');
  });

  it('renderPrintHtml：未开启时不出现对页类与裁切标记（负例）', () => {
    const html = renderPrintHtml(docWithParagraphs(3), {
      mode: 'paged',
      pageMainSize: 100,
      estimator: () => 100,
    });
    expect(html).not.toContain('bt-page-recto');
    expect(html).not.toContain('bt-crop-marks');
  });
});

/* ---------- 图片打印规则 ---------- */

describe('图片打印规则（imageRules）', () => {
  it('按版心高限制，等比缩小不裁切', () => {
    const css = buildPrintCss({
      options: DEFAULT_LAYOUT_OPTIONS,
      tokens: DEFAULT_THEME,
      mode: 'paged',
      imageRules: true,
    });
    /* A5 794 - 48×2 = 698 */
    expect(css).toContain('max-width: 100%;');
    expect(css).toContain('max-height: 698px;');
    expect(css).toContain('height: auto;');
  });

  it('未开启时不出图片规则（负例）', () => {
    const css = buildPrintCss({ options: DEFAULT_LAYOUT_OPTIONS, tokens: {}, mode: 'paged' });
    expect(css).not.toContain('max-height:');
  });
});

/* ---------- 位图嗅探 ---------- */

describe('readImagePixelSize', () => {
  it('PNG / GIF / BMP / JPEG 按文件头读出像素尺寸', () => {
    expect(readImagePixelSize(pngBytes(1200, 800))).toEqual({
      format: 'png',
      width: 1200,
      height: 800,
    });
    expect(readImagePixelSize(gifBytes(64, 48))).toEqual({ format: 'gif', width: 64, height: 48 });
    expect(readImagePixelSize(bmpBytes(320, 200))).toEqual({ format: 'bmp', width: 320, height: 200 });
    expect(readImagePixelSize(jpegBytes(640, 480))).toEqual({
      format: 'jpg',
      width: 640,
      height: 480,
    });
  });

  it('非位图 / 头部截断返回 undefined', () => {
    expect(readImagePixelSize(new Uint8Array([0x00, 0x01, 0x02]))).toBeUndefined();
    expect(readImagePixelSize(pngBytes(10, 10).slice(0, 12))).toBeUndefined();
  });
});

/* ---------- 图片检查 ---------- */

describe('collectPdfImageProblems', () => {
  it('超出版面：等比缩至版心（不裁切），尺寸写进告警', () => {
    const issues = collectPdfImageProblems(docWithImages([dataUri(pngBytes(2000, 1500))]), {
      contentWidthPx: 447,
      contentHeightPx: 698,
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('IMAGE-OVERSIZE');
    expect(issues[0]?.severity).toBe('info');
    expect(issues[0]?.message).toContain('2000×1500px');
    expect(issues[0]?.message).toContain('447×335px');
    expect(issues[0]?.message).toContain('不裁切');
    expect(issues[0]?.nodeId).toBe('img-0');
  });

  it('像素总量过大（>40MP）：升为告警并建议降采样', () => {
    const issues = collectPdfImageProblems(docWithImages([dataUri(pngBytes(8000, 6000))]), {
      contentWidthPx: 447,
      contentHeightPx: 698,
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe('warning');
    expect(issues[0]?.message).toContain('降采样');
  });

  it('低 DPI：小图按原尺寸打印只有 96dpi，给出阈值下的最大成品尺寸', () => {
    const issues = collectPdfImageProblems(docWithImages([dataUri(pngBytes(100, 100))]), {
      contentWidthPx: 447,
      contentHeightPx: 698,
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('IMAGE-LOW-DPI');
    expect(issues[0]?.message).toContain('96 DPI');
    expect(issues[0]?.message).toContain('8×8mm');
  });

  it('同一张图可同时命中超限缩放与低 DPI', () => {
    const issues = collectPdfImageProblems(docWithImages([dataUri(pngBytes(1000, 800))]), {
      contentWidthPx: 447,
      contentHeightPx: 698,
    });
    expect(issues.map((issue) => issue.code)).toEqual(['IMAGE-OVERSIZE', 'IMAGE-LOW-DPI']);
    expect(issues[1]?.message).toContain('215 DPI');
  });

  it('缺省按 layout + 令牌推导版心（A5：447px 宽）', () => {
    const issues = collectPdfImageProblems(docWithImages([dataUri(pngBytes(1000, 800))]));
    expect(issues[0]?.message).toContain('447×358px');
  });

  it('外链 / 非 base64 data URI 归入「无法校验」；可关闭', () => {
    const external = collectPdfImageProblems(docWithImages(['https://example.com/a.png']));
    expect(external).toHaveLength(1);
    expect(external[0]?.code).toBe('IMAGE-UNMEASURED');
    expect(external[0]?.message).toContain('外链');

    const plain = collectPdfImageProblems(docWithImages(['data:image/png,abc']));
    expect(plain[0]?.code).toBe('IMAGE-UNMEASURED');

    expect(
      collectPdfImageProblems(docWithImages(['https://example.com/a.png']), {
        reportUnmeasured: false,
      }),
    ).toEqual([]);
  });

  it('高分辨率大图只提示「超限缩放」（info）：430dpi 印质达标', () => {
    const issues = collectPdfImageProblems(docWithImages([dataUri(pngBytes(2000, 1500))]), {
      contentWidthPx: 447,
      contentHeightPx: 698,
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('IMAGE-OVERSIZE');
    expect(issues[0]?.severity).toBe('info');
    expect(issues[0]?.message).toContain('430 DPI');
  });

  it('阈值可配置：minDpi 降到 96 后小图不再告警（负例）', () => {
    expect(
      collectPdfImageProblems(docWithImages([dataUri(pngBytes(100, 100))]), {
        contentWidthPx: 447,
        contentHeightPx: 698,
        minDpi: 96,
      }),
    ).toEqual([]);
  });

  it('摘要按类别计数', () => {
    const issues = collectPdfImageProblems(
      docWithImages([
        dataUri(pngBytes(100, 100)),
        dataUri(pngBytes(120, 90)),
        'https://example.com/a.png',
      ]),
    );
    expect(summarizePdfImageProblems(issues)).toBe(
      '图片检查 3 条：低 DPI 2 张；无法校验 1 张',
    );
    expect(summarizePdfImageProblems([])).toBe('图片检查通过：无超限 / 低 DPI 项');
  });
});

/* ---------- 印前色彩提示 ---------- */

describe('collectPrintColorAdvice', () => {
  it('缺省 CMYK 交付：RGB 不可直出 + 未配置 ICC + 位图校色', () => {
    const advice = collectPrintColorAdvice(docWithImages([dataUri(pngBytes(10, 10))]));
    expect(advice.map((item) => item.code)).toEqual([
      'PRINT-CMYK-UNSUPPORTED',
      'PRINT-ICC-MISSING',
      'PRINT-RGB-IMAGE',
    ]);
    expect(advice[0]?.message).toContain('CMYK');
  });

  it('已配置 ICC 且无位图：只剩色彩空间不可直出', () => {
    const advice = collectPrintColorAdvice(docWithParagraphs(2), { hasIccProfile: true });
    expect(advice.map((item) => item.code)).toEqual(['PRINT-CMYK-UNSUPPORTED']);
  });

  it('target: rgb（数字校样）不做提示（负例）', () => {
    expect(collectPrintColorAdvice(docWithParagraphs(2), { target: 'rgb' })).toEqual([]);
  });

  it('摘要', () => {
    const advice = collectPrintColorAdvice(docWithParagraphs(1));
    expect(summarizePrintColorAdvice(advice)).toBe(
      '印前色彩提示 2 条：RGB 不可直出 CMYK；未配置 ICC',
    );
    expect(summarizePrintColorAdvice([])).toContain('按 RGB 输出');
  });
});
