/**
 * 导出前校验器测试（epubcheck 规则子集）
 */
import { describe, expect, it } from 'vitest';
import { strToU8 } from 'fflate';
import { checkWellFormedXml, validateEpub, type ValidationProblem } from '../validate.js';
import { exportEpub } from '../epub.js';
import { NODE_TYPES, createEmptyDocument, type BookDocument } from '@bibliotype/core';

/** 构造最小条目表（OPF 指向单内容文档） */
function minimalEntries(overrides: {
  opf?: string;
  extra?: Record<string, string>;
  drop?: readonly string[];
} = {}): Record<string, Uint8Array> {
  const entries: Record<string, Uint8Array> = {
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
    ),
    'OEBPS/content.opf': strToU8(
      overrides.opf ??
        `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id" xml:lang="zh-Hans">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">urn:test:1</dc:identifier>
    <dc:title>测试</dc:title>
    <dc:language>zh-Hans</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="sec-0" href="text/sec-0.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="sec-0"/>
  </spine>
</package>`,
    ),
    'OEBPS/nav.xhtml': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="utf-8"/><title>目录</title></head>
<body><nav epub:type="toc"><ol><li><a href="text/sec-0.xhtml">第一章</a></li></ol></nav></body></html>`),
    'OEBPS/text/sec-0.xhtml': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="utf-8"/><title>第一章</title></head>
<body><p>内容</p></body></html>`),
    ...Object.fromEntries(Object.entries(overrides.extra ?? {}).map(([k, v]) => [k, strToU8(v)])),
  };
  for (const name of overrides.drop ?? []) delete entries[name];
  return entries;
}

const codes = (problems: ValidationProblem[]): string[] => problems.map((p) => p.code);

describe('validateEpub', () => {
  it('合规产物：无 error', () => {
    const problems = validateEpub({ entries: minimalEntries(), version: '3.0' });
    expect(problems.filter((p) => p.severity === 'error')).toEqual([]);
  });

  it('OCF-01：首条目非 mimetype 报 error', () => {
    const entries = minimalEntries();
    const first = entries['mimetype']!;
    delete entries['mimetype'];
    entries['mimetype'] = first; /* 移到最后 */
    const problems = validateEpub({ entries, version: '3.0' });
    expect(codes(problems)).toContain('OCF-01');
  });

  it('OCF-02：mimetype 内容错误报 error', () => {
    const entries = minimalEntries();
    entries['mimetype'] = strToU8('application/zip');
    expect(codes(validateEpub({ entries, version: '3.0' }))).toContain('OCF-02');
  });

  it('PKG-01：非法版本报 error', () => {
    const entries = minimalEntries({
      opf: `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="9.9" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">urn:test:1</dc:identifier>
    <dc:title>t</dc:title>
  </metadata>
  <manifest><item id="sec-0" href="text/sec-0.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine><itemref idref="sec-0"/></spine>
</package>`,
    });
    expect(codes(validateEpub({ entries, version: '9.9' }))).toContain('PKG-01');
  });

  it('PKG-03：manifest 死链报 error', () => {
    const entries = minimalEntries({
      opf: `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">urn:test:1</dc:identifier>
    <dc:title>t</dc:title>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="sec-0" href="text/sec-0.xhtml" media-type="application/xhtml+xml"/>
    <item id="sec-1" href="text/missing.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="sec-0"/></spine>
</package>`,
    });
    expect(codes(validateEpub({ entries, version: '3.0' }))).toContain('PKG-03');
  });

  it('PKG-04：空 spine 报 error', () => {
    const entries = minimalEntries({
      opf: `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">urn:test:1</dc:identifier>
    <dc:title>t</dc:title>
  </metadata>
  <manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest>
  <spine></spine>
</package>`,
    });
    expect(codes(validateEpub({ entries, version: '3.0' }))).toContain('PKG-04');
  });

  it('NAV-02：EPUB 2 缺 ncx 报 error', () => {
    const entries = minimalEntries({ drop: [] });
    /* 换成 EPUB 2 OPF（无 ncx item、无 spine toc） */
    entries['OEBPS/content.opf'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">urn:test:1</dc:identifier>
    <dc:title>t</dc:title>
  </metadata>
  <manifest><item id="sec-0" href="text/sec-0.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine><itemref idref="sec-0"/></spine>
</package>`);
    expect(codes(validateEpub({ entries, version: '2.0' }))).toContain('NAV-02');
  });

  it('NAV-03：dtb:uid 与 OPF identifier 不一致报 error', () => {
    const entries = minimalEntries({
      opf: `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">urn:test:right</dc:identifier>
    <dc:title>t</dc:title>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="sec-0" href="text/sec-0.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx"><itemref idref="sec-0"/></spine>
</package>`,
      extra: {
        'OEBPS/toc.ncx': `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="urn:test:wrong"/></head>
<docTitle><text>t</text></docTitle>
<navMap><navPoint id="np-1" playOrder="1"><navLabel><text>一</text></navLabel><content src="text/sec-0.xhtml"/></navPoint></navMap>
</ncx>`,
      },
    });
    expect(codes(validateEpub({ entries, version: '3.0' }))).toContain('NAV-03');
  });

  it('NAV-04：ncx 锚点在目标文档不存在报 error', () => {
    const entries = minimalEntries({
      extra: {
        'OEBPS/toc.ncx': `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="urn:test:1"/></head>
<docTitle><text>t</text></docTitle>
<navMap><navPoint id="np-1" playOrder="1"><navLabel><text>一</text></navLabel><content src="text/sec-0.xhtml#ghost"/></navPoint></navMap>
</ncx>`,
      },
    });
    /* minimalEntries 的 OPF 无 ncx item，补一个 */
    const opf = new TextDecoder().decode(entries['OEBPS/content.opf']!).replace(
      '<item id="nav"',
      '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>\n    <item id="nav"',
    );
    entries['OEBPS/content.opf'] = strToU8(opf);
    expect(codes(validateEpub({ entries, version: '3.0' }))).toContain('NAV-04');
  });

  it('MEDIA-01：图片死链报 error；MEDIA-02：残留 data URI 报 warning', () => {
    const entries = minimalEntries();
    entries['OEBPS/text/sec-0.xhtml'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="utf-8"/><title>t</title></head>
<body><p><img src="Images/gone.png" alt=""/><img src="data:image/png;base64,AAAA" alt=""/></p></body></html>`);
    const problems = validateEpub({ entries, version: '3.0' });
    expect(codes(problems)).toContain('MEDIA-01');
    expect(codes(problems)).toContain('MEDIA-02');
    expect(problems.find((p) => p.code === 'MEDIA-01')?.severity).toBe('error');
    expect(problems.find((p) => p.code === 'MEDIA-02')?.severity).toBe('warning');
  });

  it('DOC-01：超大内容文档报 error（导入型扁平书的核心守门）', () => {
    const entries = minimalEntries();
    entries['OEBPS/text/sec-0.xhtml'] = strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="utf-8"/><title>t</title></head>
<body><p>${'x'.repeat(400 * 1024)}</p></body></html>`,
    );
    const problems = validateEpub({ entries, version: '3.0', maxSectionBytes: 256 * 1024 });
    expect(codes(problems)).toContain('DOC-01');
  });

  it('XML-01：非格式良好内容文档报 error', () => {
    const entries = minimalEntries();
    entries['OEBPS/text/sec-0.xhtml'] = strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>
<html><body><p>未闭合</body></html>`,
    );
    expect(codes(validateEpub({ entries, version: '3.0' }))).toContain('XML-01');
  });

  it('CSS-01/02：var() 与无前缀 writing-mode 报 warning', () => {
    const entries = minimalEntries({
      extra: {
        'OEBPS/style.css': 'body { font-family: var(--bt-body); writing-mode: vertical-rl; }',
      },
    });
    /* minimalEntries 的 OPF 未引用 style.css，校验器按全部 css 条目检查——需挂 manifest */
    const opf = new TextDecoder().decode(entries['OEBPS/content.opf']!).replace(
      '<item id="nav"',
      '<item id="style" href="style.css" media-type="text/css"/>\n    <item id="nav"',
    );
    entries['OEBPS/content.opf'] = strToU8(opf);
    const problems = validateEpub({ entries, version: '3.0' });
    expect(codes(problems)).toContain('CSS-01');
    expect(codes(problems)).toContain('CSS-02');
  });
});

describe('checkWellFormedXml（轻量格式良好检查）', () => {
  it('合规 XHTML 通过', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="utf-8"/><title>t</title></head>
<body><p class="a">文本 &amp; 实体</p><img src="x.png" alt=""/><!-- 注释 --></body></html>`;
    expect(checkWellFormedXml(xml)).toBeUndefined();
  });

  it('未闭合标签检出', () => {
    expect(checkWellFormedXml('<div><p>x</p>')).toContain('未闭合');
  });

  it('闭标签错配检出', () => {
    expect(checkWellFormedXml('<div><p>x</div></p>')).toContain('错配');
  });

  it('文本区裸露 < 检出', () => {
    expect(checkWellFormedXml('<p>a < b</p>')).toContain('裸露');
  });

  it('属性未加引号检出', () => {
    expect(checkWellFormedXml('<p class=a>x</p>')).toContain('引号');
  });

  it('DOCTYPE 内部子集不误报', () => {
    const xml = `<!DOCTYPE html [ <!ENTITY x "y"> ]><html><body><p>&x;</p></body></html>`;
    expect(checkWellFormedXml(xml)).toBeUndefined();
  });
});

describe('exportEpub 校验接线', () => {
  it('扁平大书默认阈值下无 DOC error（拆分生效）', () => {
    const doc = createEmptyDocument({ title: '大书' });
    const nodes = [];
    for (let i = 0; i < 200; i += 1) {
      nodes.push({
        type: NODE_TYPES.PARAGRAPH,
        children: [{ type: 'text', text: `第${i}段 ${'内容'.repeat(100)}` }],
      });
    }
    doc.root.children = nodes;
    let problems: ValidationProblem[] = [];
    exportEpub(doc, {
      modified: '2026-01-02T00:00:00Z',
      onValidation: (p) => {
        problems = [...p];
      },
    });
    expect(problems.filter((p) => p.severity === 'error')).toEqual([]);
  });

  it('显式调小阈值触发 DOC-01（证明守门员有效）', () => {
    const doc: BookDocument = createEmptyDocument({ title: '小书' });
    doc.root.children = [
      { type: NODE_TYPES.PARAGRAPH, children: [{ type: 'text', text: 'x'.repeat(4096) }] },
    ];
    let problems: ValidationProblem[] = [];
    exportEpub(doc, {
      modified: '2026-01-02T00:00:00Z',
      maxSectionBytes: 4 * 1024,
      onValidation: (p) => {
        problems = [...p];
      },
    });
    /* 单段 4KB 无元素子节点可断 → oversized → DOC-01 */
    expect(codes(problems)).toContain('DOC-01');
  });
});
