/**
 * XHTML 文档壳生成
 *
 * EPUB 3 内容文档：XHTML5 + EPUB 命名空间（nav 等语义用），
 * 文本编码固定 UTF-8，样式表通过相对路径引用。
 */
import { escapeHtml } from '@bibliotype/layout/html';

/** XHTML 文档生成输入 */
export interface XhtmlDocumentInput {
  /** 文档标题（head/title，非正文标题） */
  title: string;
  /** 语言标记（BCP 47） */
  language: string;
  /** body 内容（已序列化的 HTML 片段） */
  body: string;
  /** 样式表相对路径（如 '../style.css'；缺省不引用） */
  cssHref?: string;
}

/** 生成完整的 XHTML 文档（EPUB 3 内容文档） */
export function renderXhtmlDocument(input: XhtmlDocumentInput): string {
  const { title, language, body, cssHref } = input;
  const escapedLanguage = escapeHtml(language);
  const cssLink =
    cssHref !== undefined
      ? `\n  <link rel="stylesheet" type="text/css" href="${escapeHtml(cssHref)}" />`
      : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapedLanguage}" lang="${escapedLanguage}">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>${cssLink}
</head>
<body>
${body}
</body>
</html>
`;
}
