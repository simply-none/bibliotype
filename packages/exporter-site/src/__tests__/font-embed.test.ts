/**
 * 站点导出字体内嵌（E3）测试
 *
 * 覆盖：@font-face 前置到 style.css、字体字节以二进制文件输出、许可文件、
 * 未传字体时零残留、缺字告警并入 warnings、路径排序确定性。
 */
import { describe, expect, it } from 'vitest';
import { createEmptyDocument, type BookDocument } from '@bibliotype/core';
import { prepareFontBundle, type FontSubsetBackend } from '@bibliotype/fonts';
import { exportSite } from '../export.js';

/** 最小书稿：一章一段（4 个唯一字 + 标点） */
function sampleDoc(): BookDocument {
  const doc = createEmptyDocument({ title: '字书' });
  doc.root.children = [
    {
      type: 'chapter',
      id: 'c1',
      children: [
        {
          type: 'paragraph',
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

/** 假后端：按唯一字数缩放，可声明缺字 */
function fakeBackend(missingChars?: string): FontSubsetBackend {
  return {
    name: 'fake-subset',
    subset: async ({ bytes, chars }) => ({
      bytes: bytes.slice(0, Math.max(16, chars.length * 64)),
      ...(missingChars === undefined ? {} : { missingChars }),
    }),
  };
}

async function bundleOf(missingChars?: string) {
  return prepareFontBundle(
    sampleDoc(),
    [
      {
        id: 'font-kai',
        family: 'Classical Kai',
        bytes: fontBytes(),
        format: 'ttf',
        license: { name: 'SIL Open Font License 1.1' },
      },
    ],
    {
      backend: fakeBackend(missingChars),
      fallbackStack: "'Classical Kai', 'Noto Serif SC', serif",
    },
  );
}

describe('exportSite 字体内嵌', () => {
  it('字体以二进制文件输出，@font-face 前置，许可写入 LICENSE.txt', async () => {
    const bundle = await bundleOf('龘');
    const face = bundle.faces[0]!;
    const result = exportSite(sampleDoc(), { fonts: bundle });

    const fontFile = result.files.find((file) => file.path === face.href);
    expect(fontFile?.mediaType).toBe('font/woff2');
    expect(fontFile?.text).toBe('');
    expect(fontFile?.data?.byteLength).toBe(face.bytes.byteLength);

    const license = result.files.find((file) => file.path === 'fonts/LICENSE.txt');
    expect(license?.text).toContain('SIL Open Font License 1.1');

    const css = result.files.find((file) => file.path === 'style.css')?.text ?? '';
    expect(css.startsWith('@font-face {')).toBe(true);
    expect(css).toContain(`src: url('${face.href}') format('woff2');`);
    /* 站点框架样式仍保留 */
    expect(css).toContain('.bt-site-nav');
  });

  it('未传 fonts：无字体目录、无 @font-face（零残留）', () => {
    const result = exportSite(sampleDoc());
    expect(result.files.some((file) => file.path.startsWith('fonts/'))).toBe(false);
    expect(result.files.find((file) => file.path === 'style.css')?.text).not.toContain('@font-face');
  });

  it('缺字告警并入导出结果 warnings', async () => {
    const bundle = await bundleOf('龘');
    const result = exportSite(sampleDoc(), { fonts: bundle });
    expect(result.warnings.some((warning) => warning.includes('龘'))).toBe(true);
    expect(result.warnings.some((warning) => warning.includes('回退链'))).toBe(true);
  });

  it('文件仍按路径升序（确定性不受字体影响）', async () => {
    const bundle = await bundleOf('龘');
    const result = exportSite(sampleDoc(), { fonts: bundle });
    const paths = result.files.map((file) => file.path);
    expect(paths).toEqual([...paths].sort());
  });
});
