/**
 * Markdown 文本 → ProseMirror 节点（纯函数，无 DOM）
 *
 * 定位：为编辑态「粘贴纯文本」与「文档导入」提供 Markdown → PM 结构的转换层。
 * - 直接按 schema 构造 PM 节点，与 ir-to-pm 的产出同构（块级内容 + 行内文本 + 标记），
 *   因而可被 pmNodeToIr 无损回收为 IR（导入链路复用）；
 * - 零依赖、确定性：不读当前时间、不用随机数，输入决定输出；
 * - 支持子集：标题（# 1~6）、粗体（双星 / 双下划线）、斜体（单星 / 单下划线）、删除线、行内码、
 *   围栏代码块、引用、有序 / 无序列表、链接、图片、分隔线、空行分段。
 *
 * 已知约束（schema 语义决定，非解析器缺陷）：
 * - image 为块级原子节点，故 `![a](s)` 仅识别独占一行的图片；行内图片退化为其 alt 文本；
 * - 列表项内容按单段落处理，不支持嵌套列表 / 松散列表（项间空行会结束该列表）。
 */
import { MARK_TYPES, NODE_TYPES } from '@bibliotype/core';
import { Fragment, type Mark, type Node as PmNode, type Schema } from 'prosemirror-model';

/** Markdown 结构特征（纯文本粘贴是否值得按 Markdown 解析的判据集合） */
const MARKDOWN_SIGNALS: readonly RegExp[] = [
  /^#{1,6}[ \t]+\S/m, // 标题
  /^[ \t]*>[ \t]+\S/m, // 引用
  /^[ \t]*[-*+][ \t]+\S/m, // 无序列表
  /^[ \t]*\d+\.[ \t]+\S/m, // 有序列表
  /^[ \t]*(```|~~~)/m, // 围栏代码块
  /^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/m, // 分隔线
  /\*\*[^*\n]+\*\*/, // 粗体
  /(^|[^*])\*[^*\n]+\*/, // 斜体
  /`[^`\n]+`/, // 行内码
  /\[[^\]]*\]\([^)\s]+\)/, // 链接
  /!\[[^\]]*\]\([^)\s]+\)/, // 图片
  /^[ \t]{0,3}\[\^[^\]\s]+\]:/m, // 脚注定义
  /\[\^[^\]\s]+\]/, // 脚注引用
];

/** 判断纯文本是否含 Markdown 结构特征（含任一信号即视为 Markdown） */
export function looksLikeMarkdown(text: string): boolean {
  if (text.trim() === '') {
    return false;
  }
  return MARKDOWN_SIGNALS.some((re) => re.test(text));
}

/** 创建标记实例（schema 未注册该标记时返回 undefined，退化为无标记） */
function makeMark(schema: Schema, type: string, attrs?: Record<string, unknown>): Mark | undefined {
  const markType = schema.marks[type];
  return markType === undefined ? undefined : markType.create(attrs ?? null);
}

/** 合并并去重标记（按标记类型名去重，保留既有叠加） */
function withMark(base: readonly Mark[], extra: Mark | undefined): readonly Mark[] {
  if (extra === undefined) {
    return base;
  }
  if (base.some((m) => m.type === extra.type)) {
    return base;
  }
  return [...base, extra];
}

/** 脚注定义（按出现顺序编号） */
interface FootnoteDefinition {
  /** 定义标签（`[^label]` 里的 label） */
  label: string;
  /** 注文（多行已合并） */
  text: string;
  /** 1 起序号（显示注码） */
  index: number;
  /** 注释块 id */
  id: string;
}

/** 行内脚注引用上下文（由块级解析器按段落提供） */
export interface FootnoteRefContext {
  /** 标签 → 定义 */
  definitions: ReadonlyMap<string, FootnoteDefinition>;
  /** 记录一次引用并返回该引用的唯一锚点 id；未定义标签返回 undefined */
  useRef: (label: string) => string | undefined;
}

/** 脚注定义行：`[^label]: 注文`（允许至多 3 个前导空格） */
const FOOTNOTE_DEF_RE = /^[ \t]{0,3}\[\^([^\]\s]+)\]:[ \t]*(.*)$/;

/**
 * 收集脚注定义并返回应跳过的行号
 *
 * 连续缩进行（2 空格或 Tab 起）并入上一条定义，用于折行的长注文。
 */
function collectFootnoteDefinitions(lines: readonly string[]): {
  definitions: Map<string, FootnoteDefinition>;
  consumed: Set<number>;
} {
  const definitions = new Map<string, FootnoteDefinition>();
  const consumed = new Set<number>();
  let order = 0;

  let inFence = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    /* 围栏代码块内的 `[^x]:` 是代码，不是脚注定义 */
    if (/^[ \t]*(?:```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const match = FOOTNOTE_DEF_RE.exec(line);
    if (match === null) continue;
    const label = match[1] ?? '';
    if (definitions.has(label)) {
      /* 重复定义：保留首条，后面的按普通段落处理（不静默吞内容） */
      continue;
    }
    const parts: string[] = [];
    const firstLine = (match[2] ?? '').trim();
    if (firstLine !== '') parts.push(firstLine);
    consumed.add(i);
    let j = i + 1;
    while (j < lines.length && /^(?:[ \t]{2,}|\t)\S/.test(lines[j] ?? '')) {
      parts.push((lines[j] ?? '').trim());
      consumed.add(j);
      j += 1;
    }
    order += 1;
    definitions.set(label, {
      label,
      text: parts.join(' '),
      index: order,
      id: `note-footnote-${order}`,
    });
    i = j - 1;
  }

  return { definitions, consumed };
}

/**
 * 解析行内 Markdown 为 PM 行内节点序列
 *
 * @param raw 行内文本
 * @param schema 编辑器 schema
 * @param base 继承的外层标记（嵌套构造时传入）
 * @param footnotes 脚注引用上下文（缺省时 `[^label]` 按字面文本保留）
 */
export function parseInlineToNodes(
  raw: string,
  schema: Schema,
  base: readonly Mark[] = [],
  footnotes?: FootnoteRefContext,
): PmNode[] {
  const out: PmNode[] = [];
  let plain = '';
  const flush = (): void => {
    if (plain.length > 0) {
      out.push(schema.text(plain, base));
      plain = '';
    }
  };

  let i = 0;
  while (i < raw.length) {
    const rest = raw.slice(i);
    let m: RegExpExecArray | null;

    // 行内码：内容不再解析其他标记（PM 惯例 code 排斥其余标记）
    if ((m = /^`([^`\n]+)`/.exec(rest)) !== null) {
      flush();
      out.push(schema.text(m[1] ?? '', withMark([], makeMark(schema, MARK_TYPES.CODE))));
      i += m[0].length;
      continue;
    }
    // 图片：image 为块级，行内退化为其 alt 文本
    if ((m = /^!\[([^\]]*)\]\(([^)\s]*)\)/.exec(rest)) !== null) {
      flush();
      const alt = m[1] ?? '';
      if (alt.length > 0) {
        out.push(schema.text(alt, base));
      }
      i += m[0].length;
      continue;
    }
    // 脚注引用 [^label]：需有定义上下文，未定义的标签按字面文本保留
    if (footnotes !== undefined && (m = /^\[\^([^\]\s]+)\]/.exec(rest)) !== null) {
      const label = m[1] ?? '';
      const definition = footnotes.definitions.get(label);
      const refId = footnotes.useRef(label);
      if (definition !== undefined && refId !== undefined) {
        flush();
        const mark = makeMark(schema, MARK_TYPES.NOTE_REF, {
          targetId: definition.id,
          refId,
        });
        out.push(schema.text(String(definition.index), withMark(base, mark)));
        i += m[0].length;
        continue;
      }
    }
    // 链接：内层继承 link(href) 标记
    if ((m = /^\[([^\]]*)\]\(([^)\s]*)\)/.exec(rest)) !== null) {
      flush();
      const href = m[2] ?? '';
      const linkMark = makeMark(schema, MARK_TYPES.LINK, href.length > 0 ? { href } : undefined);
      out.push(...parseInlineToNodes(m[1] ?? '', schema, withMark(base, linkMark), footnotes));
      i += m[0].length;
      continue;
    }
    // 粗体 **x** / __x__
    if ((m = /^\*\*([\s\S]+?)\*\*/.exec(rest)) !== null || (m = /^__([\s\S]+?)__/.exec(rest)) !== null) {
      flush();
      out.push(
        ...parseInlineToNodes(
          m[1] ?? '',
          schema,
          withMark(base, makeMark(schema, MARK_TYPES.STRONG)),
          footnotes,
        ),
      );
      i += m[0].length;
      continue;
    }
    // 斜体 *x* / _x_
    if ((m = /^\*([^*\n]+)\*/.exec(rest)) !== null || (m = /^_([^_\n]+)_/.exec(rest)) !== null) {
      flush();
      out.push(
        ...parseInlineToNodes(
          m[1] ?? '',
          schema,
          withMark(base, makeMark(schema, MARK_TYPES.EMPHASIS)),
          footnotes,
        ),
      );
      i += m[0].length;
      continue;
    }
    // 删除线 ~~x~~
    if ((m = /^~~([\s\S]+?)~~/.exec(rest)) !== null) {
      flush();
      out.push(
        ...parseInlineToNodes(
          m[1] ?? '',
          schema,
          withMark(base, makeMark(schema, MARK_TYPES.STRIKETHROUGH)),
          footnotes,
        ),
      );
      i += m[0].length;
      continue;
    }

    plain += raw.charAt(i);
    i += 1;
  }
  flush();
  return out;
}

/** 构造段落（行内为空时返回空段落，保留可编辑落点） */
function makeParagraph(
  schema: Schema,
  inlineText: string,
  footnotes?: FootnoteRefContext,
): PmNode | undefined {
  const paragraph = schema.nodes[NODE_TYPES.PARAGRAPH];
  if (paragraph === undefined) {
    return undefined;
  }
  const inline = parseInlineToNodes(inlineText, schema, [], footnotes);
  return paragraph.create(null, inline.length > 0 ? inline : undefined);
}

/** 构造脚注块（注文段落 + 注码 / id / 回跳锚点） */
function makeNoteBlock(
  schema: Schema,
  definition: FootnoteDefinition,
  refId: string | undefined,
): PmNode | undefined {
  const type = schema.nodes[NODE_TYPES.FOOTNOTE];
  if (type === undefined) return undefined;
  const paragraph = makeParagraph(schema, definition.text);
  if (paragraph === undefined) return undefined;
  return type.create(
    {
      marker: String(definition.index),
      id: definition.id,
      ...(refId === undefined ? {} : { refId }),
    },
    paragraph,
  );
}

/**
 * 解析块级 Markdown 为 PM 块节点数组
 *
 * @param text Markdown 全文
 * @param schema 编辑器 schema
 */
export function markdownToNodes(text: string, schema: Schema): PmNode[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const { definitions, consumed } = collectFootnoteDefinitions(lines);
  const blocks: PmNode[] = [];
  const paraBuffer: string[] = [];

  /** 当前段落引用到的脚注标签（按出现顺序） */
  let referenced: string[] = [];
  /** 每个标签的引用次数（同一标签多次引用要各自唯一锚点） */
  const refCounts = new Map<string, number>();
  /** 标签 → 首次引用的锚点 id（注文回跳指它） */
  const firstRefIds = new Map<string, string>();
  /** 已输出的注文（避免重复段落重复插入） */
  const emittedNotes = new Set<string>();

  const footnotes: FootnoteRefContext | undefined =
    definitions.size === 0
      ? undefined
      : {
          definitions,
          useRef: (label) => {
            const definition = definitions.get(label);
            if (definition === undefined) return undefined;
            const count = (refCounts.get(label) ?? 0) + 1;
            refCounts.set(label, count);
            const refId =
              count === 1
                ? `ref-footnote-${definition.index}`
                : `ref-footnote-${definition.index}-${count}`;
            if (count === 1) firstRefIds.set(label, refId);
            if (!referenced.includes(label)) referenced.push(label);
            return refId;
          },
        };

  /** 输出本段引用到的注文（紧随引用段落，符合页底注的就近习惯） */
  const flushReferencedNotes = (): void => {
    for (const label of referenced) {
      if (emittedNotes.has(label)) continue;
      const definition = definitions.get(label);
      if (definition === undefined) continue;
      emittedNotes.add(label);
      const note = makeNoteBlock(schema, definition, firstRefIds.get(label));
      if (note !== undefined) blocks.push(note);
    }
    referenced = [];
  };

  const flushParagraph = (): void => {
    if (paraBuffer.length === 0) {
      return;
    }
    const joined = paraBuffer.join(' ').trim();
    paraBuffer.length = 0;
    referenced = [];
    if (joined.length > 0) {
      const paragraph = makeParagraph(schema, joined, footnotes);
      if (paragraph !== undefined) {
        blocks.push(paragraph);
        flushReferencedNotes();
      }
    }
  };

  let idx = 0;
  while (idx < lines.length) {
    /* 脚注定义行已由预扫描收走，正文循环跳过 */
    if (consumed.has(idx)) {
      idx += 1;
      continue;
    }
    const line = lines[idx] ?? '';

    // 围栏代码块
    const fence = /^[ \t]*(?:```|~~~)(\S*)[ \t]*$/.exec(line);
    if (fence !== null) {
      flushParagraph();
      const language = fence[1] ?? '';
      const buf: string[] = [];
      idx += 1;
      while (idx < lines.length && !/^[ \t]*(?:```|~~~)[ \t]*$/.test(lines[idx] ?? '')) {
        buf.push(lines[idx] ?? '');
        idx += 1;
      }
      idx += 1; // 越过结束围栏（缺失则越界，循环条件自然终止）
      const codeBlock = schema.nodes[NODE_TYPES.CODE_BLOCK];
      if (codeBlock !== undefined) {
        const code = buf.join('\n');
        blocks.push(
          codeBlock.create(
            language.length > 0 ? { language } : null,
            code.length > 0 ? schema.text(code) : undefined,
          ),
        );
      }
      continue;
    }

    // 分隔线（--- *** ___）
    if (/^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(line)) {
      flushParagraph();
      const brk = schema.nodes[NODE_TYPES.BREAK];
      if (brk !== undefined) {
        blocks.push(brk.create({ variant: 'hr' }));
      }
      idx += 1;
      continue;
    }

    // 标题
    const heading = /^#{1,6}[ \t]+(.*)$/.exec(line);
    if (heading !== null) {
      flushParagraph();
      const hashes = /^#+/.exec(line)?.[0] ?? '#';
      const level = Math.min(6, Math.max(1, hashes.length));
      const headingType = schema.nodes[NODE_TYPES.HEADING];
      if (headingType !== undefined) {
        blocks.push(headingType.create({ level }, parseInlineToNodes((heading[1] ?? '').trim(), schema)));
      }
      idx += 1;
      continue;
    }

    // 独占一行的图片
    const image = /^[ \t]*!\[([^\]]*)\]\(([^)\s]*)\)[ \t]*$/.exec(line);
    if (image !== null) {
      flushParagraph();
      const imageType = schema.nodes[NODE_TYPES.IMAGE];
      const src = image[2] ?? '';
      if (imageType !== undefined && src.length > 0) {
        blocks.push(imageType.create({ src, alt: image[1] ?? null }));
      }
      idx += 1;
      continue;
    }

    // 引用块（连续 > 行，内容递归解析）
    if (/^[ \t]*>/.test(line)) {
      flushParagraph();
      const buf: string[] = [];
      while (idx < lines.length && /^[ \t]*>/.test(lines[idx] ?? '')) {
        buf.push((lines[idx] ?? '').replace(/^[ \t]*>[ \t]?/, ''));
        idx += 1;
      }
      const quoteType = schema.nodes[NODE_TYPES.QUOTE];
      if (quoteType !== undefined) {
        const inner = markdownToNodes(buf.join('\n'), schema);
        const fallback = makeParagraph(schema, '');
        blocks.push(quoteType.create(null, inner.length > 0 ? inner : fallback ? [fallback] : undefined));
      }
      continue;
    }

    // 列表（有序 / 无序；切换类型或空行结束）
    const bullet = /^[ \t]*[-*+][ \t]+(.*)$/.exec(line);
    const ordered = /^[ \t]*\d+\.[ \t]+(.*)$/.exec(line);
    if (bullet !== null || ordered !== null) {
      flushParagraph();
      const isOrdered = ordered !== null;
      const itemRe = isOrdered ? /^[ \t]*\d+\.[ \t]+(.*)$/ : /^[ \t]*[-*+][ \t]+(.*)$/;
      const otherRe = isOrdered ? /^[ \t]*[-*+][ \t]+/ : /^[ \t]*\d+\.[ \t]+/;
      const items: string[] = [];
      while (idx < lines.length) {
        const current = lines[idx] ?? '';
        const mm = itemRe.exec(current);
        if (mm === null || otherRe.test(current)) {
          break;
        }
        items.push(mm[1] ?? '');
        idx += 1;
      }
      const listType = schema.nodes[NODE_TYPES.LIST];
      const itemNodeType = schema.nodes[NODE_TYPES.LIST_ITEM];
      if (listType !== undefined && itemNodeType !== undefined) {
        const liNodes = items.map((content) => {
          const paragraph = makeParagraph(schema, content);
          const children = paragraph !== undefined ? [paragraph] : undefined;
          return itemNodeType.createChecked(null, children) ?? itemNodeType.create(null);
        });
        if (liNodes.length > 0) {
          blocks.push(listType.createChecked({ ordered: isOrdered }, liNodes) ?? listType.create(null));
        }
      }
      continue;
    }

    // 空行：分段
    if (line.trim() === '') {
      flushParagraph();
      idx += 1;
      continue;
    }

    // 普通段落累积行
    paraBuffer.push(line.trim());
    idx += 1;
  }
  flushParagraph();

  /* 未被引用的定义也落到文末，避免静默丢内容 */
  if (footnotes !== undefined) {
    for (const [label, definition] of definitions) {
      if (emittedNotes.has(label)) continue;
      emittedNotes.add(label);
      const note = makeNoteBlock(schema, definition, firstRefIds.get(label));
      if (note !== undefined) blocks.push(note);
    }
  }

  return blocks;
}

/** 解析 Markdown 为 PM Fragment（供粘贴 / setContent 直接消费） */
export function markdownToFragment(text: string, schema: Schema): Fragment {
  return Fragment.from(markdownToNodes(text, schema));
}
