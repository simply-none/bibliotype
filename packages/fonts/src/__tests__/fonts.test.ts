/**
 * 字体内嵌与子集化（E3）测试
 *
 * 覆盖：用字统计（80 万字只保留唯一字）、子集后端编排与错误、体积下降、
 * 缺字回退链报告、@font-face / 许可声明、文件命名确定性。
 */
import { describe, expect, it } from 'vitest';
import {
  NODE_TYPES,
  createEmptyDocument,
  isBibliotypeError,
  type BookDocument,
  type BookNode,
} from '@bibliotype/core';
import {
  buildFontFaceCss,
  buildFontFileName,
  buildFontLicenseText,
  buildFontRightsLine,
  collectDocumentChars,
  collectNodeChars,
  coverageIncompleteWarning,
  isFallbackCovered,
  prepareFontBundle,
  resolveFallbackChain,
  sanitizeFontSlug,
  sniffFontFormat,
  splitFontFamilyStack,
  type FontAssetInput,
  type FontSubsetBackend,
} from '../index.js';

/** 伪随机字节（不可压缩，模拟真实字体文件） */
function pseudoBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let seed = 0x12345678;
  for (let i = 0; i < length; i += 1) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    bytes[i] = seed & 0xff;
  }
  return bytes;
}

function paragraph(id: string, text: string): BookNode {
  return { type: NODE_TYPES.PARAGRAPH, id, children: [{ type: 'text', text }] };
}

/** 80 万字：8 个唯一字重复 10 万次 */
function bigDocument(): BookDocument {
  const doc = createEmptyDocument({ title: '大字书' });
  doc.root.children = [
    {
      type: NODE_TYPES.CHAPTER,
      id: 'c1',
      attrs: { title: '第一章' },
      children: [paragraph('p1', '天地玄黄宇宙洪荒'.repeat(100_000))],
    },
  ];
  return doc;
}

const FONT: FontAssetInput = {
  id: 'font-kai',
  family: 'Classical Kai',
  bytes: pseudoBytes(10_000),
  format: 'ttf',
  weight: 400,
  license: {
    name: 'SIL Open Font License 1.1',
    url: 'https://openfontlicense.org',
    copyright: '© 2026 Example',
  },
};

/** 假后端：按唯一字数模拟子集大小（8 字 → 512 字节），可声明缺字 */
function fakeBackend(missingChars?: string): FontSubsetBackend {
  return {
    name: 'fake-subset',
    subset: async ({ bytes, chars }) => ({
      bytes: bytes.slice(0, Math.max(16, chars.length * 64)),
      ...(missingChars === undefined ? {} : { missingChars }),
    }),
  };
}

describe('用字统计', () => {
  it('遍历嵌套节点（ruby / 标题 / 注文），去重升序并计数', () => {
    const doc = createEmptyDocument({ title: '统计' });
    doc.root.children = [
      {
        type: 'ruby',
        id: 'r1',
        children: [
          { type: 'text', text: '漢' },
          { type: 'rt', id: 'rt', children: [{ type: 'text', text: 'han' }] },
        ],
      },
      paragraph('p1', '漢字 123，。'),
    ];
    const usage = collectDocumentChars(doc);
    expect(usage.total).toBe(12);
    expect(usage.unique).toBe(11);
    expect(usage.counts.get('漢')).toBe(2);
    expect(usage.counts.get('h')).toBe(1);
    expect([...usage.chars].sort().join('')).toBe(
      [...new Set('漢han字 123，。')].sort().join(''),
    );
  });

  it('80 万字只保留 8 个唯一字（子集输入与正文字数解耦）', () => {
    const usage = collectDocumentChars(bigDocument());
    expect(usage.total).toBe(800_000);
    expect(usage.unique).toBe(8);
    expect(usage.chars).toHaveLength(8);
  });

  it('附加字符并入；控制字符过滤、空白与标点保留', () => {
    const doc = createEmptyDocument({ title: '控制符' });
    doc.root.children = [paragraph('p1', 'a\u0001b\n c')];
    const usage = collectDocumentChars(doc, { extraChars: 'XYZ' });
    expect(usage.counts.has('\u0001')).toBe(false);
    expect(usage.counts.get('\n')).toBe(1);
    expect(usage.counts.get(' ')).toBe(1);
    expect(usage.chars).toContain('X');
    expect(usage.chars).toContain('Z');
  });

  it('collectNodeChars 可单独复用', () => {
    const counts = new Map<string, number>();
    collectNodeChars(paragraph('p', 'ab'), counts);
    expect([...counts.keys()]).toEqual(['a', 'b']);
  });
});

describe('字体回退链（与 K6 同口径）', () => {
  it('splitFontFamilyStack：引号与逗号', () => {
    expect(splitFontFamilyStack('"Songti SC", Kaiti, serif')).toEqual(['Songti SC', 'Kaiti', 'serif']);
    expect(splitFontFamilyStack(' , ')).toEqual([]);
  });

  it('resolveFallbackChain：取该族之后且非已嵌入族', () => {
    const stack = "'Classical Kai', 'Noto Serif SC', serif";
    expect(resolveFallbackChain(stack, 'Classical Kai')).toEqual(['Noto Serif SC', 'serif']);
    expect(resolveFallbackChain(stack, 'Classical Kai', new Set(['Noto Serif SC']))).toEqual(['serif']);
    expect(resolveFallbackChain(undefined, 'Classical Kai')).toEqual([]);
    expect(resolveFallbackChain(stack, 'Missing')).toEqual([]);
  });

  it('isFallbackCovered：无 probe 保守通过，有 probe 逐字判断', () => {
    expect(isFallbackCovered('龘', ['serif'])).toBe(true);
    expect(isFallbackCovered('龘', [])).toBe(false);
    expect(isFallbackCovered('ab', ['F'], (char) => char === 'a')).toBe(false);
    expect(isFallbackCovered('ab', ['F'], () => true)).toBe(true);
  });

  it('coverageIncompleteWarning：无后端不提示', () => {
    expect(coverageIncompleteWarning(undefined)).toBeUndefined();
    expect(coverageIncompleteWarning(fakeBackend())).toContain('fake-subset');
  });
});

describe('格式与命名', () => {
  it('魔术字节嗅探 woff2 / woff / otf / ttf，未知返回 undefined', () => {
    expect(sniffFontFormat(new Uint8Array([0x77, 0x4f, 0x46, 0x32]))).toBe('woff2');
    expect(sniffFontFormat(new Uint8Array([0x77, 0x4f, 0x46, 0x46]))).toBe('woff');
    expect(sniffFontFormat(new Uint8Array([0x4f, 0x54, 0x54, 0x4f]))).toBe('otf');
    expect(sniffFontFormat(new Uint8Array([0x74, 0x72, 0x75, 0x65]))).toBe('ttf');
    expect(sniffFontFormat(new Uint8Array([0, 1, 0, 0]))).toBe('ttf');
    expect(sniffFontFormat(new Uint8Array([1, 2, 3, 4]))).toBeUndefined();
  });

  it('族名清洗：非字母数字转连字符，空白回退 font', () => {
    expect(sanitizeFontSlug('Classical Kai')).toBe('classical-kai');
    expect(sanitizeFontSlug('  古籍 楷体 ')).toBe('font');
    expect(sanitizeFontSlug('A'.repeat(40), 10)).toHaveLength(10);
  });

  it('文件名含族名 / 字重 / 内容哈希 / 扩展名，内容变化即换名', () => {
    const base = { family: 'Classical Kai', weight: 400, style: 'normal' as const, format: 'woff2' as const };
    const a = buildFontFileName({ ...base, bytes: new Uint8Array([1, 2, 3]) });
    const b = buildFontFileName({ ...base, bytes: new Uint8Array([1, 2, 4]) });
    expect(a).toMatch(/^bt-classical-kai-400-[0-9a-f]{8}\.woff2$/);
    expect(a).not.toBe(b);
    expect(
      buildFontFileName({ ...base, style: 'italic', bytes: new Uint8Array([1, 2, 3]) }),
    ).toMatch(/^bt-classical-kai-400i-/);
    expect(
      buildFontFileName({ ...base, weight: '100 900', bytes: new Uint8Array([1, 2, 3]) }),
    ).toMatch(/^bt-classical-kai-var-/);
  });
});

describe('prepareFontBundle', () => {
  it('80 万字：按唯一字子集，体积下降 ≥60%，缺字走回退链并告警', async () => {
    const bundle = await prepareFontBundle(bigDocument(), [FONT], {
      backend: fakeBackend('龘'),
      fallbackStack: "'Classical Kai', 'Noto Serif SC', serif",
    });

    expect(bundle.faces).toHaveLength(1);
    expect(bundle.report.total).toBe(800_000);
    expect(bundle.report.unique).toBe(8);
    expect(bundle.report.sourceBytes).toBe(10_000);
    expect(bundle.report.subsetBytes).toBe(512);
    expect(bundle.report.reduction).toBeGreaterThanOrEqual(0.6);
    expect(bundle.report.sourceBytes - bundle.report.subsetBytes).toBeGreaterThan(9_000);

    const family = bundle.report.families[0]!;
    expect(family.subsetted).toBe(true);
    expect(family.missingChars).toBe('龘');
    expect(family.fallbackChain).toEqual(['Noto Serif SC', 'serif']);
    expect(bundle.report.hasMissing).toBe(true);
    expect(bundle.warnings.some((warning) => warning.includes('缺字'))).toBe(true);
    expect(bundle.warnings.some((warning) => warning.includes('回退链'))).toBe(true);

    expect(bundle.faces[0]!.format).toBe('woff2');
    expect(bundle.faces[0]!.mediaType).toBe('font/woff2');
    expect(bundle.faces[0]!.href).toMatch(/^fonts\/bt-classical-kai-400-[0-9a-f]{8}\.woff2$/);
    expect(bundle.css).toContain('@font-face {');
    expect(bundle.css).toContain("font-family: 'Classical Kai';");
    expect(bundle.css).toContain("src: url('fonts/bt-classical-kai-400-");
    expect(bundle.css).toContain("format('woff2')");
    expect(bundle.css).toContain('font-display: swap;');
  });

  it('未提供后端：原样嵌入、体积不降，并告警', async () => {
    const bundle = await prepareFontBundle(bigDocument(), [FONT]);
    expect(bundle.faces[0]!.format).toBe('ttf');
    expect(bundle.faces[0]!.bytes.byteLength).toBe(10_000);
    expect(bundle.report.reduction).toBe(0);
    expect(bundle.warnings[0]).toContain('未提供子集化后端');
    expect(bundle.warnings.some((warning) => warning.includes('子集化后端'))).toBe(true);
  });

  it('空文档：不子集（避免产出空字体），仍嵌入原字节', async () => {
    const bundle = await prepareFontBundle(createEmptyDocument({ title: '空' }), [FONT], {
      backend: fakeBackend(),
    });
    expect(bundle.report.unique).toBe(0);
    expect(bundle.faces[0]!.bytes.byteLength).toBe(10_000);
    expect(bundle.warnings.some((warning) => warning.includes('没有可统计的文本'))).toBe(true);
  });

  it('无字体：返回空包（CSS 为空，报告可用）', async () => {
    const bundle = await prepareFontBundle(bigDocument(), []);
    expect(bundle.faces).toEqual([]);
    expect(bundle.css).toBe('');
    expect(bundle.report.unique).toBe(8);
  });

  it('空字节字体：跳过并告警', async () => {
    const bundle = await prepareFontBundle(bigDocument(), [{ ...FONT, bytes: new Uint8Array(0) }], {
      backend: fakeBackend(),
    });
    expect(bundle.faces).toEqual([]);
    expect(bundle.warnings[0]).toContain('字节为空');
  });

  it('许可：生成完整声明与 OPF 版权行；未声明许可时告警', async () => {
    const bundle = await prepareFontBundle(bigDocument(), [FONT], { backend: fakeBackend() });
    expect(bundle.license).toContain('字体许可声明');
    expect(bundle.license).toContain('Classical Kai（font-kai）');
    expect(bundle.license).toContain('SIL Open Font License 1.1');
    expect(bundle.license).toContain('https://openfontlicense.org');
    expect(bundle.rights).toBe('Classical Kai：SIL Open Font License 1.1');
    expect(bundle.licensePath).toBe('fonts/LICENSE.txt');

    const unlicensed = await prepareFontBundle(
      bigDocument(),
      [{ ...FONT, license: undefined }],
      { backend: fakeBackend() },
    );
    expect(unlicensed.license).toBeUndefined();
    expect(unlicensed.licensePath).toBeUndefined();
    expect(unlicensed.rights).toBeUndefined();
    expect(unlicensed.warnings.some((warning) => warning.includes('未声明许可'))).toBe(true);
  });

  it('后端抛错 / 返回空字节：抛 FONT_SUBSET_FAILED 并保留根因', async () => {
    const boom: FontSubsetBackend = {
      name: 'boom',
      subset: async () => {
        throw new Error('backend exploded');
      },
    };
    let caught: unknown;
    try {
      await prepareFontBundle(bigDocument(), [FONT], { backend: boom });
    } catch (error) {
      caught = error;
    }
    expect(isBibliotypeError(caught)).toBe(true);
    if (isBibliotypeError(caught)) {
      expect(caught.code).toBe('FONT_SUBSET_FAILED');
      expect(caught.cause).toBeInstanceOf(Error);
      expect(caught.details).toMatchObject({ fontId: 'font-kai', backend: 'boom' });
    }

    const empty: FontSubsetBackend = {
      name: 'empty',
      subset: async () => ({ bytes: new Uint8Array(0) }),
    };
    let emptyCaught: unknown;
    try {
      await prepareFontBundle(bigDocument(), [FONT], { backend: empty });
    } catch (error) {
      emptyCaught = error;
    }
    expect(isBibliotypeError(emptyCaught)).toBe(true);
    if (isBibliotypeError(emptyCaught)) {
      expect(emptyCaught.code).toBe('FONT_SUBSET_FAILED');
      expect(emptyCaught.message).toContain('产物为空');
    }
  });

  it('同一输入产物确定：文件名与 CSS 逐字节一致', async () => {
    const first = await prepareFontBundle(bigDocument(), [FONT], { backend: fakeBackend('龘') });
    const second = await prepareFontBundle(bigDocument(), [FONT], { backend: fakeBackend('龘') });
    expect(first.faces[0]!.fileName).toBe(second.faces[0]!.fileName);
    expect(first.css).toBe(second.css);
    expect(Array.from(first.faces[0]!.bytes)).toEqual(Array.from(second.faces[0]!.bytes));
  });
});

describe('CSS / 许可工具函数', () => {
  const face = {
    id: 'f',
    family: "Kai's",
    weight: 400,
    style: 'normal' as const,
    format: 'woff2' as const,
    mediaType: 'font/woff2',
    fileName: 'x.woff2',
    href: "fonts/x's.woff2",
    bytes: new Uint8Array([1]),
  };

  it('buildFontFaceCss：空数组返回空串；族名 / URL 单引号转义', () => {
    expect(buildFontFaceCss([])).toBe('');
    const css = buildFontFaceCss([face], { fontDisplay: 'block' });
    expect(css).toContain("font-family: 'Kai\\'s';");
    expect(css).toContain("url('fonts/x\\'s.woff2')");
    expect(css).toContain('font-display: block;');
    expect(css).toContain("format('woff2')");
  });

  it('buildFontLicenseText / buildFontRightsLine：无许可时 undefined', () => {
    expect(buildFontLicenseText([])).toBeUndefined();
    expect(buildFontRightsLine([])).toBeUndefined();
    expect(buildFontLicenseText([FONT])).toContain('© 2026 Example');
  });
});
