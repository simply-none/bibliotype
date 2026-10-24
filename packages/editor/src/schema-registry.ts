/**
 * 编辑器规格注册表（对应 D8）
 *
 * editor 仅提供节点 / 标记的 ProseMirror 规格注册 API；
 * 古籍等插件包（如 @bibliotype/classical）在初始化时批量注册其专有节点，
 * 卸载时按命名空间注销，保证未安装插件时 editor 独立可用。
 */
import { BIBLIOTYPE_ERROR_CODES, BibliotypeError, NODE_TYPES } from '@bibliotype/core';
import {
  Schema,
  type DOMOutputSpec,
  type MarkSpec,
  type Node as PmNode,
  type NodeSpec,
} from 'prosemirror-model';
import { RAW_ATTRS_ATTR } from './attr-mapper.js';

/** 编辑器节点规格条目 */
export interface EditorNodeSpecEntry {
  /** 节点类型名（须与 IR 节点 type 一致，如 paragraph） */
  type: string;
  /** ProseMirror 节点规格 */
  spec: NodeSpec;
  /** 所属命名空间（按此注销），缺省为 core */
  namespace?: string;
}

/** 编辑器标记规格条目 */
export interface EditorMarkSpecEntry {
  /** 标记类型名（须与 IR 标记 type 一致，如 strong） */
  type: string;
  /** ProseMirror 标记规格 */
  spec: MarkSpec;
  /** 所属命名空间（按此注销），缺省为 core */
  namespace?: string;
}

/** 默认命名空间 */
export const DEFAULT_EDITOR_NAMESPACE = 'core';

/** 默认根节点类型（IR 的 book 根） */
export const DEFAULT_EDITOR_TOP_NODE: string = NODE_TYPES.BOOK;

/** 默认 DOM 表现的类名前缀（与书册样式 bt- 约定一致） */
const DEFAULT_DOM_CLASS_PREFIX = 'bt-';

/**
 * 默认 DOM 的 data-* 属性表（与 @bibliotype/layout/html 序列化器对齐）
 *
 * 让编辑画布与阅读 / 导出共用同一套书册样式：结构页 `[data-role]`、
 * 校勘符号 `.bt-collation-mark::after { content: attr(data-symbol) }` 等
 * 规则依赖节点属性落到 data-*。产出规则与序列化器一致：
 * - rawAttrs 兜底容器逐键展开；
 * - spec 显式声明属性（排除 id / rawAttrs）在非空且不等于默认值时输出
 *   （与 PM → IR 的「默认值规范化省略」同口径）。
 */
function domDataAttrs(
  specAttrs: NodeSpec['attrs'],
  nodeAttrs: PmNode['attrs'],
): Record<string, string> {
  const result: Record<string, string> = {};

  const raw = nodeAttrs[RAW_ATTRS_ATTR];
  if (typeof raw === 'object' && raw !== null) {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (value === undefined || value === null) continue;
      result[`data-${key}`] = String(value);
    }
  }

  if (specAttrs && !Array.isArray(specAttrs)) {
    for (const [key, attrSpec] of Object.entries(specAttrs)) {
      if (key === 'id' || key === RAW_ATTRS_ATTR) continue;
      const value = nodeAttrs[key];
      if (value === undefined || value === null) continue;
      const def =
        typeof attrSpec === 'object' && attrSpec !== null
          ? (attrSpec as { default?: unknown }).default
          : undefined;
      if (def !== undefined && def === value) continue;
      result[`data-${key}`] = String(value);
    }
  }

  return result;
}

/**
 * 复合节点的语义 DOM 标签
 *
 * 默认 toDOM 用 div 占位；表格若渲染成 `div.bt-table > div.bt-table-row > div.bt-table-cell`，
 * 浏览器不会建立表格布局，编辑态表现为「一片空白」。这里改用 table / tr / td，
 * 同时保留 bt-* class 与 data-* 属性（与默认表现共用同一套 attrs 组装）。
 * 表格内容需包一层 tbody，保证与浏览器解析出的 DOM 结构一致。
 */
function semanticDomShape(
  type: string,
): { tag: string; wrapper?: string; parseTags?: readonly string[] } | null {
  switch (type) {
    case NODE_TYPES.TABLE:
      return { tag: 'table', wrapper: 'tbody', parseTags: ['table.bt-table', 'table'] };
    case NODE_TYPES.TABLE_ROW:
      return { tag: 'tr', parseTags: ['tr'] };
    case NODE_TYPES.TABLE_CELL:
      return { tag: 'td', parseTags: ['td', 'th'] };
    default:
      return null;
  }
}

/**
 * 表格单元格的原生 DOM 属性
 *
 * `colspan` / `rowspan` 必须落在原生属性上浏览器才会建立跨行跨列布局；
 * `data-colspan` / `data-rowspan` 仅作数据镜像，这里从输出中剔除避免重复。
 */
function tableCellNativeAttrs(node: PmNode): Record<string, string> {
  const result: Record<string, string> = {};
  const colspan = Number(node.attrs['colspan']);
  if (Number.isFinite(colspan) && colspan > 1) result['colspan'] = String(colspan);
  const rowspan = Number(node.attrs['rowspan']);
  if (Number.isFinite(rowspan) && rowspan > 1) result['rowspan'] = String(rowspan);
  return result;
}

/** 为缺省 toDOM / parseDOM 的节点规格生成默认 DOM 表现（解锁视图渲染） */
function withDefaultNodeDom(type: string, spec: NodeSpec): NodeSpec {
  // text 节点由 ProseMirror 直接渲染为文本，无需 DOM 表现
  if (type === NODE_TYPES.TEXT) {
    return spec;
  }
  const next: NodeSpec = { ...spec };
  const className = `${DEFAULT_DOM_CLASS_PREFIX}${type}`;
  const shape = semanticDomShape(type);
  const tag = shape?.tag ?? (spec.inline === true || spec.group === 'inline' ? 'span' : 'div');
  if (next.toDOM === undefined || next.toDOM === null) {
    const hasContent = typeof spec.content === 'string' && spec.content.length > 0;
    next.toDOM = (node: PmNode): DOMOutputSpec => {
      const domAttrs: Record<string, string> = {
        class: className,
        ...domDataAttrs(spec.attrs, node.attrs),
      };
      if (type === NODE_TYPES.TABLE_CELL) {
        Object.assign(domAttrs, tableCellNativeAttrs(node));
        delete domAttrs['data-colspan'];
        delete domAttrs['data-rowspan'];
      }
      // 稳定 id 落到 data-bt-id（供编辑画布分页参考线按块定位）
      const id = node.attrs.id;
      if (typeof id === 'string' && id !== '') {
        domAttrs['data-bt-id'] = id;
      }
      if (hasContent && shape?.wrapper !== undefined) {
        return [tag, domAttrs, [shape.wrapper, 0]];
      }
      return hasContent ? [tag, domAttrs, 0] : [tag, domAttrs];
    };
  }
  if (next.parseDOM === undefined || next.parseDOM === null) {
    next.parseDOM =
      shape?.parseTags !== undefined
        ? shape.parseTags.map((parseTag) => ({ tag: parseTag }))
        : [{ tag: `${tag}.${className}` }];
  }
  return next;
}

/** 为缺省 toDOM / parseDOM 的标记规格生成默认 DOM 表现 */
function withDefaultMarkDom(type: string, spec: MarkSpec): MarkSpec {
  const next: MarkSpec = { ...spec };
  const className = `${DEFAULT_DOM_CLASS_PREFIX}${type}`;
  if (next.toDOM === undefined || next.toDOM === null) {
    next.toDOM = (): DOMOutputSpec => ['span', { class: className }, 0];
  }
  if (next.parseDOM === undefined || next.parseDOM === null) {
    next.parseDOM = [{ tag: `span.${className}` }];
  }
  return next;
}

/**
 * 为节点解析规则补充「保留源元素 id」
 *
 * 导入的 HTML / docx / EPUB 里 `<a href="#…">` 的跳转目标（段落 / 列表项 /
 * 标题等）靠源 id 对应，parse 时丢 id 文档内锚点就断链；同时修复 bt-* 渲染
 * 产物 HTML 回编辑器往返丢节点 id。克隆规则不改动共享 spec；规则已显式返回
 * id 与返回 false / null 的跳过情形均保持原样；spec 未声明 id 属性时 PM 会
 * 忽略多余键，无需特判。
 */
function withSourceIdParsing(spec: NodeSpec): NodeSpec {
  if (spec.parseDOM === undefined || spec.parseDOM === null) return spec;
  return {
    ...spec,
    parseDOM: spec.parseDOM.map((rule) => {
      const original = rule.getAttrs;
      return {
        ...rule,
        getAttrs: (dom: HTMLElement): Record<string, unknown> | false | null => {
          const parsed = original !== undefined ? original(dom) : {};
          if (!parsed) return parsed;
          const id = dom.getAttribute('id');
          return id !== null && parsed['id'] === undefined ? { ...parsed, id } : parsed;
        },
      };
    }),
  };
}

/** 规格注册冲突错误 */
export class EditorSpecConflictError extends BibliotypeError {
  constructor(kind: 'node' | 'mark', type: string) {
    super(
      BIBLIOTYPE_ERROR_CODES.EDITOR_SPEC_CONFLICT,
      `编辑器 ${kind === 'node' ? '节点' : '标记'}规格 "${type}" 已注册。`,
      {
        details: { kind, type },
        hint: '检查插件是否重复注册同名规格，或改用其它 type。',
      },
    );
    this.name = 'EditorSpecConflictError';
  }
}

/** 注册表初始化参数 */
export interface EditorSchemaRegistryInit {
  nodes?: readonly EditorNodeSpecEntry[];
  marks?: readonly EditorMarkSpecEntry[];
}

/** 构建 schema 选项 */
export interface BuildSchemaOptions {
  /** 根节点类型（缺省 book） */
  topNode?: string;
}

/** 编辑器规格注册表 */
export class EditorSchemaRegistry {
  private readonly nodes = new Map<string, EditorNodeSpecEntry>();
  private readonly marks = new Map<string, EditorMarkSpecEntry>();

  constructor(init: EditorSchemaRegistryInit = {}) {
    for (const entry of init.nodes ?? []) {
      this.registerNode(entry);
    }
    for (const entry of init.marks ?? []) {
      this.registerMark(entry);
    }
  }

  /** 注册单个节点规格（重复注册抛错） */
  registerNode(entry: EditorNodeSpecEntry): void {
    if (this.nodes.has(entry.type)) {
      throw new EditorSpecConflictError('node', entry.type);
    }
    this.nodes.set(entry.type, {
      ...entry,
      namespace: entry.namespace ?? DEFAULT_EDITOR_NAMESPACE,
    });
  }

  /** 注册单个标记规格（重复注册抛错） */
  registerMark(entry: EditorMarkSpecEntry): void {
    if (this.marks.has(entry.type)) {
      throw new EditorSpecConflictError('mark', entry.type);
    }
    this.marks.set(entry.type, {
      ...entry,
      namespace: entry.namespace ?? DEFAULT_EDITOR_NAMESPACE,
    });
  }

  /** 批量注册（原子操作：任一冲突则全部回滚） */
  registerAll(init: EditorSchemaRegistryInit): void {
    const nodeTypes: string[] = [];
    const markTypes: string[] = [];
    try {
      for (const entry of init.nodes ?? []) {
        this.registerNode(entry);
        nodeTypes.push(entry.type);
      }
      for (const entry of init.marks ?? []) {
        this.registerMark(entry);
        markTypes.push(entry.type);
      }
    } catch (error) {
      for (const type of nodeTypes) {
        this.nodes.delete(type);
      }
      for (const type of markTypes) {
        this.marks.delete(type);
      }
      throw error;
    }
  }

  /** 是否已注册节点规格 */
  hasNode(type: string): boolean {
    return this.nodes.has(type);
  }

  /** 是否已注册标记规格 */
  hasMark(type: string): boolean {
    return this.marks.has(type);
  }

  /** 注销单个节点规格 */
  unregisterNode(type: string): boolean {
    return this.nodes.delete(type);
  }

  /** 注销单个标记规格 */
  unregisterMark(type: string): boolean {
    return this.marks.delete(type);
  }

  /**
   * 按命名空间批量注销（节点与标记一并清理，插件卸载时调用）
   *
   * @returns 注销的数量
   */
  unregisterByNamespace(namespace: string): number {
    let removed = 0;
    for (const [type, entry] of this.nodes) {
      if (entry.namespace === namespace) {
        this.nodes.delete(type);
        removed += 1;
      }
    }
    for (const [type, entry] of this.marks) {
      if (entry.namespace === namespace) {
        this.marks.delete(type);
        removed += 1;
      }
    }
    return removed;
  }

  /** 列出全部节点规格条目 */
  listNodes(): EditorNodeSpecEntry[] {
    return [...this.nodes.values()];
  }

  /** 列出全部标记规格条目 */
  listMarks(): EditorMarkSpecEntry[] {
    return [...this.marks.values()];
  }

  /** 构建 ProseMirror Schema（根节点缺省为 book） */
  buildSchema(options: BuildSchemaOptions = {}): Schema {
    const topNode = options.topNode ?? DEFAULT_EDITOR_TOP_NODE;
    if (!this.nodes.has(topNode)) {
      throw new RangeError(`无法构建 schema：根节点类型 "${topNode}" 未注册。`);
    }

    const nodes: Record<string, NodeSpec> = {};
    for (const [type, entry] of this.nodes) {
      nodes[type] = withSourceIdParsing(withDefaultNodeDom(type, entry.spec));
    }
    const marks: Record<string, MarkSpec> = {};
    for (const [type, entry] of this.marks) {
      marks[type] = withDefaultMarkDom(type, entry.spec);
    }

    return new Schema({ topNode, nodes, marks });
  }
}
