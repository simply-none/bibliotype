/**
 * BookDocument → docx Document / 字节
 *
 * 入口只有两个：
 * - `buildDocxDocument`：返回 docx 文档对象与问题清单（宿主需要二次定制时用）；
 * - `exportDocx`：直接拿到 `.docx` 字节（浏览器与 Node 同构）。
 *
 * 页面尺寸 / 页边距从毫米换算为缇；注释先全书编号，再交给块级与行内转换。
 */
import { collectNotes, type BookDocument } from '@bibliotype/core';
import { Document, Packer, convertMillimetersToTwip } from 'docx';
import { buildBlocks } from './blocks.js';
import { collectReferencedNoteIds, createExportContext } from './context.js';
import { resolveOptions } from './options.js';
import { buildDocxStyles } from './styles.js';
import type { BuiltDocxDocument, DocxExportOptions } from './types.js';

/** 构建 docx 文档对象（同时返回导出问题） */
export function buildDocxDocument(
  book: BookDocument,
  options: DocxExportOptions = {},
): BuiltDocxDocument {
  const resolved = resolveOptions(options);
  const notes = collectNotes(book.root);
  const referencedNotes = collectReferencedNoteIds(book.root);
  const ctx = createExportContext(resolved, notes, referencedNotes);
  const children = buildBlocks(book.root, ctx);

  const document = new Document({
    title: book.metadata.title,
    creator: creatorOf(book),
    description: book.metadata.subtitle,
    styles: buildDocxStyles(resolved),
    sections: [
      {
        properties: {
          page: {
            size: {
              width: convertMillimetersToTwip(resolved.pageSize.width),
              height: convertMillimetersToTwip(resolved.pageSize.height),
            },
            margin: {
              top: convertMillimetersToTwip(resolved.margins.top),
              right: convertMillimetersToTwip(resolved.margins.right),
              bottom: convertMillimetersToTwip(resolved.margins.bottom),
              left: convertMillimetersToTwip(resolved.margins.left),
            },
          },
        },
        children,
      },
    ],
  });

  return { document, problems: ctx.problems };
}

/** 导出 `.docx` 字节（`Uint8Array`，浏览器可直接建 Blob 下载） */
export async function exportDocx(
  book: BookDocument,
  options: DocxExportOptions = {},
): Promise<Uint8Array> {
  const { document } = buildDocxDocument(book, options);
  const blob = await Packer.toBlob(document);
  return new Uint8Array(await blob.arrayBuffer());
}

/** 责任者署名（「宋 · 朱熹」风格留待元数据映射，这里先取姓名） */
function creatorOf(book: BookDocument): string | undefined {
  const names = (book.metadata.contributors ?? [])
    .map((contributor) => contributor.name.trim())
    .filter((name) => name !== '');
  return names.length > 0 ? names.join('、') : undefined;
}
