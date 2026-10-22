/**
 * EPUB 字体内嵌（E3）测试
 *
 * 覆盖：`@font-face` 前置到 style.css、字体字节与许可文件进包、manifest
 * 登记（字体 / 许可）、OPF `dc:rights`、缺字告警经 `onValidation` 报告
 * （关闭校验仍报告）、EPUB 2 路径兼容，以及未传字体时的零残留。
 */
import { describe, expect, it } from 'vitest';
import { NODE_TYPES, createEmptyDocument, type BookDocument } from '@bibliotype/core';
import { prepareFontBundle, type FontSubsetBackend } from '@bibliotype/fonts';
import { strFromU8, unzipSync } from 'fflate';
import { exportEpub } from '../epub.js';
import type { ValidationProblem } from '../validate.js';

const FIXED_MODIFIED = '2026-01-02T00:00:00Z';

/** 最小书稿：一章一段（4 个唯一字 + 标点） */
function sampleDoc(): BookDocument {
  const doc = createEmptyDocument({ title: '字书', updatedAt: FIXED_MODIFIED });
  doc.root.children = [
    {
      type: NODE_TYPES.CHAPTER,
      id: 'c1',
      attrs: { title: '第一章' },
      children: [
        {
          type: NODE_TYPES.PARAGRAPH,
          id: 'p1',
          children: [{ type: 'text', text: '天地玄黄。' }],
        },
      ],
    },
  ];
  return doc;
}

/** 伪随机字体字节（不可压缩，模拟真实字体） */
function fontBytes(length = 4096): Uint8Array {
  const bytes = new Uint8Array(length);
  let seed = 0x12345678;
  for (let i = 0; i < length; i += 1) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    bytes[i] = seed & 0xff;
  }
  return bytes;
}

/** 假后端：按唯一字数缩放（便于断言体积下降），可声明缺字 */
function fakeBackend(missingChars?: string): FontSubsetBackend {
  return {
    name: 'fake-subset',
    subset: async ({ bytes, chars }) => ({
      bytes: bytes.slice(0, Math.max(16, chars.length * 64)),
      ...(missingChars === undefined ? {} : { missingChars }),
    }),
  };
}

/** 准备字体包（两包联动：真实走 prepareFontBundle） */
async function bundleOf(missingChars?: string) {
  return prepareFontBundle(
    sampleDoc(),
    [
      {
        id: 'font-kai',
        family: 'Classical Kai',
        bytes: fontBytes(),
        format: 'ttf',
        license: { name: 'SIL Open Font License 1.1', url: 'https://openfontlicense.org' },
      },
    ],
    {
      backend: fakeBackend(missingChars),
      fallbackStack: "'Classical Kai', 'Noto Serif SC', serif",
    },
  );
}

/** zip 条目解码为文本（不存在返回 undefined） */
function entryText(files: Record<string, Uint8Array>, name: string): string | undefined {
  const entry = files[name];
  return entry === undefined ? undefined : strFromU8(entry);
}

describe('exportEpub 字体内嵌', () => {
  it('字体字节 / 许可进包，manifest 登记，@font-face 前置，dc:rights 输出', async () => {
    const bundle = await bundleOf('龘');
    const face = bundle.faces[0]!;
    const files = unzipSync(exportEpub(sampleDoc(), { fonts: bundle, modified: FIXED_MODIFIED }));

    /* 字体与许可文件（相对 OEBPS） */
    expect(files[`OEBPS/${face.href}`]?.byteLength).toBe(face.bytes.byteLength);
    expect(bundle.licensePath).toBe('fonts/LICENSE.txt');
    expect(entryText(files, `OEBPS/${bundle.licensePath ?? ''}`)).toContain(
      'SIL Open Font License 1.1',
    );

    /* CSS：@font-face 在最前（子集字体优先于主题字体栈） */
    const css = entryText(files, 'OEBPS/style.css') ?? '';
    expect(css.startsWith('@font-face {')).toBe(true);
    expect(css).toContain(`src: url('${face.href}') format('woff2');`);
    expect(css).toContain("font-family: 'Classical Kai';");

    /* manifest：字体条目 + 许可条目 */
    const opf = entryText(files, 'OEBPS/content.opf') ?? '';
    expect(opf).toContain(`id="font-1" href="${face.href}" media-type="font/woff2"`);
    expect(opf).toContain('id="font-license" href="fonts/LICENSE.txt" media-type="text/plain"');
    /* dc:rights：许可可追溯 */
    expect(opf).toContain('<dc:rights>Classical Kai：SIL Open Font License 1.1</dc:rights>');
  });

  it('未传 fonts：无 @font-face / 无字体目录 / 无 dc:rights（零残留）', () => {
    const files = unzipSync(exportEpub(sampleDoc(), { modified: FIXED_MODIFIED }));
    expect(entryText(files, 'OEBPS/style.css')).not.toContain('@font-face');
    expect(entryText(files, 'OEBPS/content.opf')).not.toContain('dc:rights');
    expect(Object.keys(files).some((name) => name.startsWith('OEBPS/fonts/'))).toBe(false);
  });

  it('字体文件通过校验（无 PKG-03），缺字 / 回退告警以 FONT-REPORT 透出', async () => {
    const bundle = await bundleOf('龘');
    const problems: ValidationProblem[] = [];
    exportEpub(sampleDoc(), {
      fonts: bundle,
      modified: FIXED_MODIFIED,
      onValidation: (list) => problems.push(...list),
    });

    expect(problems.filter((problem) => problem.severity === 'error')).toEqual([]);
    const fontProblems = problems.filter((problem) => problem.code === 'FONT-REPORT');
    expect(fontProblems.length).toBeGreaterThan(0);
    expect(fontProblems.some((problem) => problem.message.includes('龘'))).toBe(true);
    expect(fontProblems.some((problem) => problem.message.includes('回退链'))).toBe(true);
  });

  it('关闭校验（validate: false）仍报告字体告警（缺字不静默上线）', async () => {
    const bundle = await bundleOf('龘');
    const problems: ValidationProblem[] = [];
    exportEpub(sampleDoc(), {
      fonts: bundle,
      modified: FIXED_MODIFIED,
      validate: false,
      onValidation: (list) => problems.push(...list),
    });

    expect(problems.length).toBeGreaterThan(0);
    expect(problems.every((problem) => problem.code === 'FONT-REPORT')).toBe(true);
  });

  it('EPUB 2 路径：字体条目与 dc:rights 同样输出，仍不写 EPUB 3 专属 meta', async () => {
    const bundle = await bundleOf('龘');
    const files = unzipSync(
      exportEpub(sampleDoc(), { fonts: bundle, version: '2.0', modified: FIXED_MODIFIED }),
    );
    const opf = entryText(files, 'OEBPS/content.opf') ?? '';
    expect(opf).toContain('media-type="font/woff2"');
    expect(opf).toContain('<dc:rights>');
    expect(opf).not.toContain('property="dcterms:modified"');
  });
});
