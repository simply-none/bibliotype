/**
 * XHTML 文档壳生成
 *
 * 内容文档壳按 OPF 版本分两种形态：
 * - EPUB 3（默认）：XHTML 5 —— `<!DOCTYPE html>` + `<meta charset="utf-8"/>`，
 *   保留 `xmlns:epub`（nav 的 `epub:type` 等语义属性依赖）；
 * - EPUB 2（显式兼容京东读书等 RMSDK）：XHTML 1.1 DOCTYPE + `http-equiv` Content-Type
 *   （老引擎对 XHTML 1.1 + http-equiv 的组合验证最充分，不擅自升级）。
 *
 * 文本编码固定 UTF-8，样式表通过相对路径引用。
 */
import { escapeXml } from '@bibliotype/layout/html';

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
  /** 文档壳风格：'xhtml5'（EPUB 3，缺省）/ 'xhtml11'（EPUB 2） */
  flavor?: 'xhtml5' | 'xhtml11';
}

/** 生成完整的 XHTML 文档（EPUB 内容文档） */
export function renderXhtmlDocument(input: XhtmlDocumentInput): string {
  const { title, language, body, cssHref } = input;
  const flavor = input.flavor ?? 'xhtml5';
  const escapedLanguage = escapeXml(language);
  const cssLink =
    cssHref !== undefined
      ? `\n  <link rel="stylesheet" type="text/css" href="${escapeXml(cssHref)}" />`
      : '';

  if (flavor === 'xhtml11') {
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapedLanguage}" lang="${escapedLanguage}">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
  <title>${escapeXml(title)}</title>${cssLink}
</head>
<body>
${body}
</body>
</html>
`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapedLanguage}" lang="${escapedLanguage}">
<head>
  <meta charset="utf-8"/>
  <title>${escapeXml(title)}</title>${cssLink}
</head>
<body>
${body}
</body>
</html>
`;
}
