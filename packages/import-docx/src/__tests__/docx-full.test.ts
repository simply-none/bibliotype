// @vitest-environment happy-dom
/**
 * F5 DOCX 全量导入：styles.xml → NamedStyle、图片 data URI、脚注往返
 *
 * 夹具在测试内用 fflate 现场拼装（最小 OOXML 包），避免维护 base64 常量。
 */
import { NODE_TYPES, type BookNode } from '@bibliotype/core';
import { buildEditorSchema } from '@bibliotype/editor';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { docxToBookDocumentWithStyles } from '../from-docx.js';
import { parseDocxStyleInfo } from '../docx-styles.js';

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function pngBytes(): Uint8Array {
  const binary = atob(PNG_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOCUMENT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
</Relationships>`;

const DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="BodyIndent"/></w:pPr>
      <w:r><w:t>正文有注</w:t></w:r>
      <w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="1"/></w:r>
    </w:p>
    <w:p>
      <w:r>
        <w:drawing>
          <wp:inline>
            <wp:extent cx="100" cy="100"/>
            <wp:docPr id="1" name="pic"/>
            <a:graphic>
              <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
                <pic:pic>
                  <pic:nvPicPr><pic:cNvPr id="1" name="pic"/><pic:cNvPicPr/></pic:nvPicPr>
                  <pic:blipFill>
                    <a:blip r:embed="rId3"/>
                    <a:stretch><a:fillRect/></a:stretch>
                  </pic:blipFill>
                  <pic:spPr>
                    <a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm>
                    <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
                  </pic:spPr>
                </pic:pic>
              </a:graphicData>
            </a:graphic>
          </wp:inline>
        </w:drawing>
      </w:r>
    </w:p>
    <w:sectPr/>
  </w:body>
</w:document>`;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="BodyIndent">
    <w:name w:val="正文缩进"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:ind w:firstLine="480"/>
      <w:spacing w:before="120" w:line="360" w:lineRule="auto"/>
      <w:jc w:val="both"/>
    </w:pPr>
    <w:rPr><w:sz w:val="28"/><w:color w:val="FF0000"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Unused"><w:name w:val="未使用样式"/></w:style>
</w:styles>`;

const FOOTNOTES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:footnote w:id="1"><w:p><w:r><w:t>注文内容</w:t></w:r></w:p></w:footnote>
</w:footnotes>`;

function buildDocx(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(ROOT_RELS),
    'word/document.xml': strToU8(DOCUMENT_XML),
    'word/_rels/document.xml.rels': strToU8(DOCUMENT_RELS),
    'word/styles.xml': strToU8(STYLES_XML),
    'word/footnotes.xml': strToU8(FOOTNOTES_XML),
    'word/media/image1.png': pngBytes(),
  });
}

function findNode(nodes: readonly BookNode[] | undefined, type: string): BookNode | undefined {
  for (const node of nodes ?? []) {
    if (node.type === type) return node;
    const found = findNode(node.children, type);
    if (found !== undefined) return found;
  }
  return undefined;
}

describe('parseDocxStyleInfo', () => {
  it('解析中文样式名、basedOn 与常用声明，过滤未引用样式', () => {
    const info = parseDocxStyleInfo(buildDocx());
    expect(info.usedStyleIds.has('BodyIndent')).toBe(true);

    const style = info.namedStyles.styles.find((item) => item.id === 'ns-docx-BodyIndent');
    expect(style?.name).toBe('正文缩进');
    expect(style?.basedOn).toBe('ns-docx-Normal');
    expect(style?.declarations['text-indent']).toBe('32px');
    expect(style?.declarations['line-height']).toBe('1.5');
    expect(style?.declarations['margin-top']).toBe('8px');
    expect(style?.declarations['font-size']).toBe('19px');
    expect(style?.declarations['color']).toBe('#ff0000');
    expect(style?.declarations['text-align']).toBe('justify');

    expect(info.namedStyles.styles.some((item) => item.id === 'ns-docx-Unused')).toBe(false);
    expect(info.styleMap.some((rule) => rule.includes('正文缩进'))).toBe(true);
  });
});

describe('docxToBookDocumentWithStyles', () => {
  it('段落挂 styleId、图片内联、脚注成对', async () => {
    const schema = buildEditorSchema();
    const { document, namedStyles } = await docxToBookDocumentWithStyles(buildDocx(), schema, {
      title: 'DOCX 全量',
    });

    const paragraph = findNode(document.root.children, NODE_TYPES.PARAGRAPH);
    expect(paragraph?.attrs?.['styleId']).toBe('ns-docx-BodyIndent');

    const image = findNode(document.root.children, NODE_TYPES.IMAGE);
    expect(String(image?.attrs?.['src'] ?? '')).toMatch(/^data:image\/png;base64,/);

    const note = findNode(document.root.children, NODE_TYPES.FOOTNOTE);
    expect(note?.attrs?.['marker']).toBe(1);
    expect(namedStyles.styles.some((item) => item.id === 'ns-docx-BodyIndent')).toBe(true);
  });
});
