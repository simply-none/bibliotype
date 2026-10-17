/**
 * IR → HTML 序列化器（@bibliotype/layout/html）
 *
 * 输出语义化 HTML 片段，供 EPUB 章节（XHTML）与 PDF 打印稿共用：
 * - XHTML 兼容：void 元素自闭合、属性双引号、实体转义；
 * - 类型 → 标签映射内置 core 全部节点；未知类型按容器启发式兜底
 *   （有元素子节点 → div，否则 span），可用 tagOverrides 精确覆盖；
 * - 每个元素输出 class="bt-{type}"，与 buildBookCss 的类样式配套；
 * - marks（标记）数组索引 0 约定为最内层（贴近文本），
 *   序列化时自内向外逐层包裹；
 * - 节点 id 优先输出；无 id 的节点可由调用方经 anchorIds 注入锚点
 *   （EPUB 目录跳转依赖）；
 * - 非白名单属性统一输出为 data-*，保证语义信息不丢失。
 */
import {
  MARK_TYPES,
  NODE_TYPES,
  isTextNode,
  type BookMark,
  type BookNode,
} from '@bibliotype/core';

/** 序列化选项 */
export interface SerializeNodeOptions {
  /** 节点类型 → 标签覆盖（优先级最高，用于插件节点定制） */
  tagOverrides?: Readonly<Record<string, string>>;
  /** 节点 → 锚点 id 注入（仅对无 id 节点生效，如 EPUB 自动锚点） */
  anchorIds?: ReadonlyMap<BookNode, string>;
  /**
   * 图片 src 改写回调（EPUB 导出用：把 data URI / 本地路径改写为包内相对路径）
   *
   * 序列化器对 `src` 值原样透传（仅做 XML 转义）；调用方经本回调拦截，
   * 可在转义前完成「收集媒体 + 改写引用」。返回非 string 时按原样透传。
   */
  rewriteSrc?: (src: string) => string | undefined;
}

/** core 节点类型的默认标签映射（heading / list / text / book 动态处理） */
const CORE_TAG_MAP: Readonly<Record<string, string>> = {
  /* 结构容器 */
  [NODE_TYPES.COVER]: 'section',
  [NODE_TYPES.TITLE_PAGE]: 'section',
  [NODE_TYPES.COPYRIGHT_PAGE]: 'section',
  [NODE_TYPES.BACK_COVER]: 'section',
  [NODE_TYPES.VOLUME]: 'section',
  [NODE_TYPES.CHAPTER]: 'section',
  [NODE_TYPES.SECTION]: 'section',
  [NODE_TYPES.APPENDIX]: 'section',
  [NODE_TYPES.PREFACE]: 'section',
  [NODE_TYPES.POSTSCRIPT]: 'section',
  [NODE_TYPES.TOC]: 'nav',

  /* 块级内容 */
  [NODE_TYPES.PARAGRAPH]: 'p',
  [NODE_TYPES.QUOTE]: 'blockquote',
  [NODE_TYPES.LIST_ITEM]: 'li',
  [NODE_TYPES.IMAGE]: 'img',
  [NODE_TYPES.CAPTION]: 'div',
  [NODE_TYPES.TABLE]: 'table',
  [NODE_TYPES.TABLE_ROW]: 'tr',
  [NODE_TYPES.TABLE_CELL]: 'td',
  [NODE_TYPES.CODE_BLOCK]: 'pre',
  [NODE_TYPES.MATH_BLOCK]: 'div',
  [NODE_TYPES.BREAK]: 'hr',

  /* 注释 */
  [NODE_TYPES.FOOTNOTE]: 'aside',
  [NODE_TYPES.ENDNOTE]: 'aside',
  [NODE_TYPES.MARGIN_NOTE]: 'aside',

  /* 行内 */
  [NODE_TYPES.MATH_INLINE]: 'span',
};

/** 无需闭合的 void 标签 */
const VOID_TAGS: ReadonlySet<string> = new Set(['img', 'hr', 'br']);

/** 直接透传为原生 HTML 属性的白名单（其余属性输出为 data-*） */
const ATTR_WHITELIST: Readonly<Record<string, readonly string[]>> = {
  [NODE_TYPES.IMAGE]: ['src', 'alt'],
};

/**
 * XML 1.0 非法字符集（除进一步受限项外的全部非法码位）
 *
 * XML 1.0 合法字符为 #x9(TAB) / #xA(LF) / #xD(CR) / #x20-#xD7FF / #xE000-#xFFFD / #x10000-#x10FFFF，
 * 故非法者为：除 TAB/LF/CR 外的全部 C0 控制符（#x0-#x8、#xB、#xC、#xE-#x1F）与 #xFFFE / #xFFFF。
 * 代理项（emoji、扩展汉字群等以 JS 代理对承载的码位）**不在其中**：
 * 简单按码元剔除会连合法代理对一起破坏（如 U+1F600 的两个码元落在 #xD800-#xDFFF）。
 * 孤代理项理论上也非法，但导入侧口径（`TextDecoder` / `File.text()`）不会产生，故不在此处理。
 */
const INVALID_XML_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g;

/**
 * 剥离 XML 1.0 非法字符
 *
 * 现实出处：外部素材（PDF / TXT 转换的 EPUB、docx）常夹带竖向制表符 #xB、换页符 #xC 等控制符，
 * 导入侧（xmldom 容错 + DOM 宽容解析）会原样收进 IR 文本。留到导出会带来严重后果：
 * XHTML 内容文档必须是**格式良好**的 XML，携带非法字符会让严格 XML 解析的阅读器
 * （多数 EPUB 2 / 3 引擎）判定 `not well-formed` 而**拒开整本书**。
 */
export function stripInvalidXmlChars(value: string): string {
  return value.replace(INVALID_XML_CHARS, '');
}

/**
 * XML 文本 / 属性值转义（实体转义 + 非法字符剥离）
 *
 * 在实体转义前先剥非法字符：先转义会把控制符原样保留在结果里，顺序不可颠倒。
 * 导出链路（XHTML / OPF / NCX / nav 的文本与属性出口）统一使用本函数，
 * 不再用 `escapeHtml`——后者只转义实体、不保格式良好。
 */
export function escapeXml(value: string): string {
  return stripInvalidXmlChars(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * HTML/XML 实体转义（文本与属性值共用）
 *
 * 行为已与 `escapeXml` 对齐（含非法字符剥离）：本文件的序列化产物最终进入 XHTML，
 * 任何一处只做实体转义都会形成「打了补丁但仍非格式良好」的产物，故统一兜底。
 * 新代码请用语义更明确的 `escapeXml`。
 */
export function escapeHtml(value: string): string {
  return escapeXml(value);
}

/** 元素子节点（剔除文本叶子） */
function elementChildren(node: BookNode): BookNode[] {
  return (node.children ?? []).filter((child) => !isTextNode(child));
}

/** 递归收集纯文本（代码块等逐字内容用） */
function plainText(node: BookNode): string {
  if (isTextNode(node)) return node.text ?? '';
  return (node.children ?? []).map(plainText).join('');
}

/** 解析节点标签（覆盖 > 动态规则 > 内置表 > 容器启发式） */
function resolveTag(node: BookNode, options: SerializeNodeOptions): string {
  const override = options.tagOverrides?.[node.type];
  if (override !== undefined) return override;

  if (node.type === NODE_TYPES.HEADING) {
    const raw = node.attrs?.level;
    // 缺省回退为 1：与 heading spec 的 `level.default = 1` 对齐。
    // IR 对「等于默认值」的 level 省略输出，若此处回退 2 会导致 H1 经 IR 往返退化成 h2（R3）。
    const level = typeof raw === 'number' ? Math.round(raw) : 1;
    return `h${Math.min(6, Math.max(1, level))}`;
  }
  if (node.type === NODE_TYPES.LIST) {
    return node.attrs?.ordered === true ? 'ol' : 'ul';
  }

  const mapped = CORE_TAG_MAP[node.type];
  if (mapped !== undefined) return mapped;
  return elementChildren(node).length > 0 ? 'div' : 'span';
}

/**
 * 属性名 → data-* 名称的特例
 *
 * camelCase 属性直接拼成 `data-styleId` 在 HTML 里大小写不敏感、看不出问题，
 * 但 EPUB 是 XHTML（XML）——属性选择器**大小写敏感**，`[data-style-id]` 不会命中
 * `data-styleId`，命名样式因此在阅读器里静默失效。故显式转 kebab-case。
 */
const DATA_ATTR_NAME_OVERRIDES: Readonly<Record<string, string>> = {
  styleId: 'style-id',
};

/** 非白名单属性 → data-* 属性串（值统一字符串化并转义） */
function dataAttrs(
  attrs: Readonly<Record<string, unknown>> | undefined,
  exclude: readonly string[],
): string {
  if (attrs === undefined) return '';
  let result = '';
  for (const [key, value] of Object.entries(attrs)) {
    if (exclude.includes(key) || value === undefined || value === null) continue;
    const name = DATA_ATTR_NAME_OVERRIDES[key] ?? key;
    result += ` data-${name}="${escapeHtml(String(value))}"`;
  }
  return result;
}

/** 元素节点 → HTML（id / class / 属性 / 特例标签 / 子内容） */
function elementToHtml(node: BookNode, options: SerializeNodeOptions): string {
  const tag = resolveTag(node, options);
  const id = options.anchorIds?.get(node) ?? node.id;
  const attrs = node.attrs;

  const idAttr = id !== undefined && id !== '' ? ` id="${escapeHtml(id)}"` : '';
  const classAttr = ` class="bt-${escapeHtml(node.type)}"`;
  const whitelist = ATTR_WHITELIST[node.type] ?? [];

  /* 图片：src / alt 透传为原生属性（无值时输出空串占位） */
  if (node.type === NODE_TYPES.IMAGE) {
    const rawSrc = typeof attrs?.src === 'string' ? attrs.src : '';
    const rewritten = options.rewriteSrc?.(rawSrc);
    const src = typeof rewritten === 'string' ? rewritten : rawSrc;
    const alt = typeof attrs?.alt === 'string' ? attrs.alt : '';
    const extras = dataAttrs(attrs, whitelist);
    const rest = serializeChildren(node, options);
    return `<img${idAttr}${classAttr} src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${extras} />${rest}`;
  }

  const extras = dataAttrs(attrs, whitelist);

  if (VOID_TAGS.has(tag)) {
    return `<${tag}${idAttr}${classAttr}${extras} />`;
  }

  /* 代码块：内容逐字输出，不解析标记与子结构 */
  if (node.type === NODE_TYPES.CODE_BLOCK) {
    return `<${tag}${idAttr}${classAttr}${extras}><code>${escapeHtml(plainText(node))}</code></${tag}>`;
  }

  /* 公式：优先子内容，缺省回退 attrs.tex 源码文本（data-tex 由 extras 携带） */
  if (node.type === NODE_TYPES.MATH_BLOCK || node.type === NODE_TYPES.MATH_INLINE) {
    const inner = serializeChildren(node, options);
    const tex = typeof attrs?.tex === 'string' ? attrs.tex : '';
    return `<${tag}${idAttr}${classAttr}${extras}>${inner !== '' ? inner : escapeHtml(tex)}</${tag}>`;
  }

  return `<${tag}${idAttr}${classAttr}${extras}>${serializeChildren(node, options)}</${tag}>`;
}

/** 标记包裹（marks[0] 为最内层，自内向外逐层包裹） */
function applyMarks(html: string, marks: readonly BookMark[] | undefined): string {
  if (marks === undefined || marks.length === 0) return html;
  let result = html;
  for (let i = 0; i < marks.length; i += 1) {
    const mark = marks[i];
    if (mark !== undefined) result = wrapMark(mark, result);
  }
  return result;
}

/** 单个标记 → HTML 包裹 */
function wrapMark(mark: BookMark, inner: string): string {
  const attrs = mark.attrs;

  switch (mark.type) {
    case MARK_TYPES.EMPHASIS:
      return `<em>${inner}</em>`;
    case MARK_TYPES.STRONG:
      return `<strong>${inner}</strong>`;
    case MARK_TYPES.CODE:
      return `<code>${inner}</code>`;
    case MARK_TYPES.UNDERLINE:
      return `<span class="bt-mark-underline">${inner}</span>`;
    case MARK_TYPES.STRIKETHROUGH:
      return `<span class="bt-mark-strikethrough">${inner}</span>`;
    case MARK_TYPES.HIGHLIGHT:
      return `<span class="bt-mark-highlight">${inner}</span>`;
    case MARK_TYPES.LINK: {
      const href = typeof attrs?.href === 'string' ? attrs.href : undefined;
      const extras = dataAttrs(attrs, ['href']);
      if (href === undefined) {
        return `<span class="bt-mark-link"${extras}>${inner}</span>`;
      }
      return `<a class="bt-mark-link" href="${escapeHtml(href)}"${extras}>${inner}</a>`;
    }
    case MARK_TYPES.RUBY: {
      const rt = typeof attrs?.text === 'string' && attrs.text.length > 0
        ? `<rt>${escapeHtml(attrs.text)}</rt>`
        : '';
      return `<ruby>${inner}${rt}</ruby>`;
    }
    default: {
      const extras = dataAttrs(attrs, []);
      return `<span class="bt-mark-${escapeHtml(mark.type)}"${extras}>${inner}</span>`;
    }
  }
}

/** 子节点序列化拼接 */
function serializeChildren(node: BookNode, options: SerializeNodeOptions): string {
  return (node.children ?? []).map((child) => nodeToHtml(child, options)).join('');
}

/** 节点分发（文本叶子 / 透明根 / 元素） */
function nodeToHtml(node: BookNode, options: SerializeNodeOptions): string {
  if (isTextNode(node)) {
    return applyMarks(escapeHtml(node.text ?? ''), node.marks);
  }
  if (node.type === NODE_TYPES.BOOK) {
    return serializeChildren(node, options);
  }
  return elementToHtml(node, options);
}

/**
 * 序列化单个 IR 节点为 HTML 片段
 *
 * book 根为透明容器，直接输出其子内容（即全书 HTML）。
 */
export function serializeNode(
  node: BookNode,
  options: SerializeNodeOptions = {},
): string {
  return nodeToHtml(node, options);
}
