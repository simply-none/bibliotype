/**
 * IR ⇄ Y.Doc 双向映射（D6：IR 的 CRDT 化）
 *
 * Y.Doc 结构（与 y-prosemirror 约定对齐，便于编辑器直连）：
 * - `metadata`（Y.Map）：书目元数据字段；
 * - `bibliotype-meta`（Y.Map）：schemaVersion 等映射元信息；
 * - `root`（Y.XmlFragment）：正文树，块节点为 Y.XmlElement，
 *   行内文本聚合入 Y.XmlText 的 delta（marks 存于 delta 的 attributes）。
 *
 * 设计说明（POC 边界）：
 * - 本映射为「全量写入 / 全量读出」语义，用于初始加载与快照；
 * - 增量编辑由 editor 包基于同一结构驱动（y-prosemirror 适配在后续迭代）；
 * - 节点稳定 id 与 attrs 序列化存于 XmlElement 的保留属性。
 */
import {
  IR_SCHEMA_VERSION,
  NODE_TYPES,
  isTextNode,
  type Attrs,
  type BookDocument,
  type BookMark,
  type BookNode,
} from '@bibliotype/core';
import * as Y from 'yjs';

/** Y.Doc 内结构键名 */
export const YDOC_KEYS = {
  /** 书目元数据（Y.Map） */
  METADATA: 'metadata',
  /** 映射元信息（Y.Map，存 schemaVersion） */
  META: 'bibliotype-meta',
  /** 正文树（Y.XmlFragment） */
  ROOT: 'root',
} as const;

/** 写入来源标识（供事务/观察者区分映射层写入） */
export const ORIGIN_DOCUMENT_MAPPER = 'bibliotype:doc-mapper';

/** XmlElement 保留属性：节点 id */
const ID_ATTR = '__id';
/** XmlElement 保留属性：节点 attrs（JSON） */
const ATTRS_ATTR = '__attrs';

/* ------------------------------------------------------------------ */
/* 编码：IR → Y.Doc                                                    */
/* ------------------------------------------------------------------ */

/** marks → delta format（y-prosemirror 风格：{ markType: attrs }） */
function marksToFormat(marks?: BookMark[]): Record<string, Attrs | Record<string, never>> | undefined {
  if (marks === undefined || marks.length === 0) return undefined;
  const format: Record<string, Attrs | Record<string, never>> = {};
  for (const mark of marks) {
    format[mark.type] = mark.attrs ?? {};
  }
  return format;
}

/** 将文本子序列聚合为一个 Y.XmlText（保持 delta 连续） */
function buildXmlText(textNodes: readonly BookNode[]): Y.XmlText {
  const xmlText = new Y.XmlText();
  let offset = 0;
  for (const node of textNodes) {
    const text = node.text ?? '';
    // 注意：attributes 必须显式传对象（空对象表示无格式）；
    // 省略会让 Yjs 继承相邻字符的格式，导致无标记文本被折叠进上一段。
    xmlText.insert(offset, text, marksToFormat(node.marks) ?? {});
    offset += text.length;
  }
  return xmlText;
}

/** IR 节点 → Y.XmlElement（递归） */
function nodeToXmlElement(node: BookNode): Y.XmlElement {
  const element = new Y.XmlElement(node.type);
  if (node.id !== undefined) {
    element.setAttribute(ID_ATTR, node.id);
  }
  if (node.attrs !== undefined && Object.keys(node.attrs).length > 0) {
    element.setAttribute(ATTRS_ATTR, JSON.stringify(node.attrs));
  }

  const children = node.children ?? [];
  if (children.length > 0) {
    // 行内文本聚合为单个 XmlText；嵌套元素各自成 XmlElement 并保持顺序
    const content: Array<Y.XmlElement | Y.XmlText> = [];
    let inlineBuffer: BookNode[] = [];

    const flushInline = (): void => {
      if (inlineBuffer.length > 0) {
        content.push(buildXmlText(inlineBuffer));
        inlineBuffer = [];
      }
    };

    for (const child of children) {
      if (isTextNode(child)) {
        inlineBuffer.push(child);
      } else {
        flushInline();
        content.push(nodeToXmlElement(child));
      }
    }
    flushInline();

    element.insert(0, content);
  }
  return element;
}

/**
 * 将 BookDocument 全量写入 Y.Doc
 *
 * 在单个事务内完成：清空旧内容 → 写入 metadata / schemaVersion / 正文树。
 * 事务来源标记为 ORIGIN_DOCUMENT_MAPPER，便于协同端区分。
 */
export function writeDocument(ydoc: Y.Doc, doc: BookDocument): void {
  ydoc.transact(() => {
    /* 元数据 */
    const meta = ydoc.getMap<unknown>(YDOC_KEYS.METADATA);
    meta.clear();
    for (const [key, value] of Object.entries(doc.metadata)) {
      if (value !== undefined) {
        meta.set(key, value);
      }
    }

    /* 映射元信息 */
    ydoc.getMap(YDOC_KEYS.META).set('schemaVersion', doc.schemaVersion);

    /* 正文树 */
    const fragment = ydoc.getXmlFragment(YDOC_KEYS.ROOT);
    if (fragment.length > 0) {
      fragment.delete(0, fragment.length);
    }
    fragment.insert(0, [nodeToXmlElement(doc.root)]);
  }, ORIGIN_DOCUMENT_MAPPER);
}

/* ------------------------------------------------------------------ */
/* 解码：Y.Doc → IR                                                    */
/* ------------------------------------------------------------------ */

/** delta format → marks */
function formatToMarks(format: object | undefined): BookMark[] | undefined {
  if (format === undefined) return undefined;
  const entries = Object.entries(format);
  if (entries.length === 0) return undefined;
  return entries.map(([type, attrs]) => {
    const record = attrs as Attrs;
    const hasAttrs = record !== null
      && typeof record === 'object'
      && Object.keys(record).length > 0;
    return hasAttrs ? { type, attrs: record } : { type };
  });
}

/** Y.XmlText → 文本节点序列 */
function xmlTextToNodes(xmlText: Y.XmlText): BookNode[] {
  const nodes: BookNode[] = [];
  for (const op of xmlText.toDelta() as Array<{ insert: unknown; attributes?: object }>) {
    if (typeof op.insert === 'string') {
      const node: BookNode = { type: 'text', text: op.insert };
      const marks = formatToMarks(op.attributes);
      if (marks !== undefined) {
        node.marks = marks;
      }
      nodes.push(node);
    }
  }
  return nodes;
}

/** Y.XmlElement → IR 节点（递归） */
function xmlElementToNode(element: Y.XmlElement): BookNode {
  const node: BookNode = { type: element.nodeName };

  const attributes = element.getAttributes();
  const id = attributes[ID_ATTR];
  if (typeof id === 'string' && id.length > 0) {
    node.id = id;
  }
  const rawAttrs = attributes[ATTRS_ATTR];
  if (typeof rawAttrs === 'string' && rawAttrs.length > 0) {
    try {
      node.attrs = JSON.parse(rawAttrs) as Attrs;
    } catch {
      // 属性损坏时忽略，保证整体读取不因单节点失败
    }
  }

  const children: BookNode[] = [];
  for (const child of element.toArray()) {
    if (child instanceof Y.XmlText) {
      children.push(...xmlTextToNodes(child));
    } else if (child instanceof Y.XmlElement) {
      children.push(xmlElementToNode(child));
    }
  }
  if (children.length > 0) {
    node.children = children;
  }
  return node;
}

/**
 * 从 Y.Doc 全量读出 BookDocument
 *
 * - metadata 空时返回最小文档（title 为空串）；
 * - schemaVersion 缺失时回退到当前 IR_SCHEMA_VERSION。
 */
export function readDocument(ydoc: Y.Doc): BookDocument {
  const meta = ydoc.getMap<unknown>(YDOC_KEYS.METADATA).toJSON() as Record<
    string,
    unknown
  >;
  const schemaVersion = (ydoc.getMap(YDOC_KEYS.META).get('schemaVersion') as
    | string
    | undefined) ?? IR_SCHEMA_VERSION;

  const fragment = ydoc.getXmlFragment(YDOC_KEYS.ROOT);
  const first = fragment.length > 0 ? fragment.get(0) : undefined;
  const root: BookNode = first instanceof Y.XmlElement
    ? xmlElementToNode(first)
    : { type: NODE_TYPES.BOOK, children: [] };

  return {
    schemaVersion,
    metadata: { title: '', ...meta } as BookDocument['metadata'],
    root,
  };
}
