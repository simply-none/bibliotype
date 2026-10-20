/**
 * IR 校验测试：合法文档零问题、各类结构问题可被定位。
 */
import { describe, expect, it } from 'vitest';
import { DOCUMENT_ISSUE_CODES, IR_SCHEMA_VERSION, createEmptyDocument, validateDocument } from '../index.js';
import type { BookDocument } from '../index.js';

function validDocument(): BookDocument {
  const doc = createEmptyDocument({ title: '论语' });
  doc.root.children = [
    {
      id: 'ch1',
      type: 'chapter',
      children: [
        { id: 'p1', type: 'paragraph', children: [{ type: 'text', text: '学而时习之' }] },
        { id: 'img1', type: 'image', attrs: { src: 'a.png', alt: '插图' } },
      ],
    },
  ];
  return doc;
}

describe('validateDocument', () => {
  it('合法文档通过且无问题', () => {
    const result = validateDocument(validDocument());
    expect(result.ok).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('非对象输入直接判错', () => {
    const result = validateDocument(null);
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.code).toBe(DOCUMENT_ISSUE_CODES.INVALID_STRUCTURE);
  });

  it('未知节点类型报错，可降级为 warning', () => {
    const doc = validDocument();
    doc.root.children?.push({ id: 'x1', type: 'unknown-block' });
    expect(validateDocument(doc).errors.some((issue) => issue.code === DOCUMENT_ISSUE_CODES.UNKNOWN_NODE_TYPE)).toBe(true);
    const lenient = validateDocument(doc, { unknownTypesAsWarning: true });
    expect(lenient.ok).toBe(true);
    expect(lenient.warnings.some((issue) => issue.code === DOCUMENT_ISSUE_CODES.UNKNOWN_NODE_TYPE)).toBe(true);
  });

  it('插件节点类型经 knownNodeTypes 放行', () => {
    const doc = validDocument();
    doc.root.children?.push({ id: 'd1', type: 'double-note', children: [{ type: 'text', text: '注文' }] });
    const result = validateDocument(doc, { knownNodeTypes: ['double-note'] });
    expect(result.ok).toBe(true);
  });

  it('容器直挂 text 报 text-on-container', () => {
    const doc = validDocument();
    doc.root.children?.[0]?.children?.push({ id: 'bad', type: 'paragraph', text: '直挂文本' });
    const result = validateDocument(doc);
    expect(result.errors.some((issue) => issue.code === DOCUMENT_ISSUE_CODES.TEXT_ON_CONTAINER)).toBe(true);
  });

  it('重复节点 id 报错', () => {
    const doc = validDocument();
    doc.root.children?.[0]?.children?.push({ id: 'p1', type: 'paragraph' });
    const result = validateDocument(doc);
    expect(result.errors.some((issue) => issue.code === DOCUMENT_ISSUE_CODES.DUPLICATE_NODE_ID)).toBe(true);
  });

  it('容器携带 marks 报错，未知标记报错', () => {
    const doc = validDocument();
    const paragraph = doc.root.children?.[0]?.children?.[0];
    if (paragraph) {
      paragraph.marks = [{ type: 'emphasis' }];
    }
    const result = validateDocument(doc);
    expect(result.errors.some((issue) => issue.code === DOCUMENT_ISSUE_CODES.MARK_ON_CONTAINER)).toBe(true);

    const doc2 = validDocument();
    const leaf = doc2.root.children?.[0]?.children?.[0]?.children?.[0];
    if (leaf) {
      leaf.marks = [{ type: 'mystery-mark' }];
    }
    expect(
      validateDocument(doc2).errors.some(
        (issue) => issue.code === DOCUMENT_ISSUE_CODES.UNKNOWN_MARK_TYPE,
      ),
    ).toBe(true);
  });

  it('属性值类型非法报错', () => {
    const doc = validDocument();
    const image = doc.root.children?.[0]?.children?.[1];
    if (image) {
      image.attrs = { src: 'a.png', meta: { nested: true } as unknown as string };
    }
    const result = validateDocument(doc);
    expect(result.errors.some((issue) => issue.code === DOCUMENT_ISSUE_CODES.INVALID_ATTR_VALUE)).toBe(true);
  });

  it('根节点类型与 schemaVersion 期望不符时报错', () => {
    const doc = validDocument();
    doc.root.type = 'chapter';
    expect(validateDocument(doc).errors.some((issue) => issue.code === DOCUMENT_ISSUE_CODES.INVALID_STRUCTURE)).toBe(true);

    const mismatch = validateDocument(validDocument(), { expectedSchemaVersion: '9.9.9' });
    expect(
      mismatch.errors.some((issue) => issue.code === DOCUMENT_ISSUE_CODES.SCHEMA_VERSION_MISMATCH),
    ).toBe(true);
    expect(validateDocument(validDocument(), { expectedSchemaVersion: IR_SCHEMA_VERSION }).ok).toBe(true);
  });

  it('缺少 id 时可产出 warning', () => {
    const doc = validDocument();
    const chapter = doc.root.children?.[0];
    if (chapter) {
      delete chapter.id;
    }
    const result = validateDocument(doc, { requireNodeIds: true });
    expect(result.ok).toBe(true);
    expect(result.warnings.some((issue) => issue.severity === 'warning')).toBe(true);
  });

  it('问题项带节点路径便于定位', () => {
    const doc = validDocument();
    doc.root.children?.[0]?.children?.push({ id: 'bad2', type: 'paragraph', text: 'x' });
    const issue = validateDocument(doc).errors.find(
      (item) => item.code === DOCUMENT_ISSUE_CODES.TEXT_ON_CONTAINER,
    );
    expect(issue?.path).toBe('root.children[0].children[2].text');
    expect(issue?.nodeId).toBe('bad2');
  });
});
