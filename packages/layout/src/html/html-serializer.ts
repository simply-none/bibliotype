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
  evaluateCondition,
  isTextNode,
  noteRoleOf,
  resolveMarksForView,
  type BookMark,
  type BookNode,
  type RevisionView,
  type ConditionContext,
} from '@bibliotype/core';
import { renderSealSvg, type SealBorder, type SealLayout, type SealStyle } from '../svg/seal.js';
import { transformVerticalText, type VerticalTextOptions } from '../vertical-text.js';

/** 序列化选项 */
export interface SerializeNodeOptions {
  /** 节点类型 → 标签覆盖（优先级最高，用于插件节点定制） */
  tagOverrides?: Readonly<Record<string, string>>;
  /** 节点 → 锚点 id 注入（仅对无 id 节点生效，如 EPUB 自动锚点） */
  anchorIds?: ReadonlyMap<BookNode, string>;
  /**
   * 竖排文字形态（B7）：标点 / 引号换成竖排形态（`︒` `︑` `﹁` `﹂`），
   * 数字可选汉字（`1850` → `一八五〇`）或全角。
   *
   * 缺省不转换（交给浏览器 OpenType `vert` 特性）；导出管线（PDF / EPUB）或
   * 需要「所见即所得」逐字控制的场景可显式开启。转换逐字符一一对应，
   * 不改变字符偏移 / 锚点，代码块内容不受影响。
   */
  verticalText?: VerticalTextOptions;
  /**
   * 图片 src 改写回调（EPUB 导出用：把 data URI / 本地路径改写为包内相对路径）
   *
   * 序列化器对 `src` 值原样透传（仅做 XML 转义）；调用方经本回调拦截，
   * 可在转义前完成「收集媒体 + 改写引用」。返回非 string 时按原样透传。
   */
  rewriteSrc?: (src: string) => string | undefined;
  /**
   * 输出 EPUB 3 结构语义属性（`epub:type`）
   *
   * 仅 EPUB 导出开启：注释块随之带 `footnote` / `endnote` / `sidebar`，
   * 阅读器据此把注文收进注释系统（页底 / 篇末 / 旁栏），而不是当正文段落读。
   * 纯 HTML 出口（站点 / PDF 打印稿）保持关闭，不输出 HTML 规范外的属性。
   */
  epubSemantics?: boolean;
  /**
   * 条件内容上下文（`condition.when` 求值用）
   *
   * 缺省不传：保留全部条件内容（导出 / 阅读器不注入上下文时不会误删）。
   */
  conditionContext?: ConditionContext;
  /**
   * 印章是否输出内联 SVG 印谱（缺省 true）
   *
   * EPUB 2 阅读器对 SVG 支持不齐，导出侧可关闭改为**文字印章**兜底
   * （`.bt-seal:empty::after` 读取 `data-text`），不打包位图、不增加资源。
   */
  inlineSealSvg?: boolean;
  /**
   * 修订视图（C5）：`marked`（缺省，输出修订标记）/ `final`（终稿）/ `original`（原稿）
   *
   * 投影发生在**序列化边界**：编辑器内部文档始终保留被删内容，
   * 导出与阅读侧按视图投影，不会出现「终稿视图编辑后丢失原文」。
   */
  revisionView?: RevisionView;
  /**
   * 缺字合成回调（K6）：逐字符调用，返回 HTML 片段则替换该字符
   *
   * - 缺省不传：文本按原样输出，产物与既有版本逐字节一致；
   * - 返回 `undefined` 时该字符按原文转义输出；
   * - 返回值视为**已转义的受信 HTML**（调用方通常是 `renderIdsGlyphHtml`），
   *   序列化器不再二次转义——宿主不得把用户输入拼进片段。
   */
  glyph?: (char: string) => string | undefined;
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
  [NODE_TYPES.PAGE_HEADER]: 'header',
  [NODE_TYPES.PAGE_FOOTER]: 'footer',
  [NODE_TYPES.CONDITION]: 'div',

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
  [NODE_TYPES.IMAGE]: ['src', 'alt', 'width', 'height'],
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

/**
 * 文本节点序列化：可选逐字符替换缺字字形（K6）
 *
 * 空白字符不调用回调（缺字只可能是可见字符，减少一次字符串比较）；
 * 返回片段视为受信 HTML，不再二次转义——调用方须保证片段由
 * `renderIdsGlyphHtml` 之类经过转义的生成器产出。
 */
function serializeGlyphText(
  text: string,
  glyph: ((char: string) => string | undefined) | undefined,
): string {
  if (glyph === undefined) return escapeHtml(text);

  let html = '';
  for (const char of text) {
    if (/^\s$/u.test(char)) {
      html += escapeHtml(char);
      continue;
    }
    const replacement = glyph(char);
    html += replacement === undefined ? escapeHtml(char) : replacement;
  }
  return html;
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

/**
 * 恒用行内标签（span）的类型表
 *
 * 容器启发式（有元素子级 → div）对**行内容器**不安全：行内节点落在段落内，
 * 输出块级标签会破坏行内流（如夹注带标记子级时被启发式判成 div）。
 * 本批登记行内化节点（double-note）与新原子（ink-nail）；其余行内类型
 * 待各自批次处理。
 */
const INLINE_TAG_TYPES: ReadonlySet<string> = new Set(['double-note', 'ink-nail']);

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
  if (INLINE_TAG_TYPES.has(node.type)) return 'span';
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
  sortKey: 'sort-key',
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

/** 修订标记的元信息属性串（change-id / author / timestamp，值缺省时省略） */
function revisionDataAttrs(attrs: Readonly<Record<string, unknown>> | undefined): string {
  if (attrs === undefined) return '';
  const mapping: readonly (readonly [string, string])[] = [
    ['changeId', 'change-id'],
    ['author', 'author'],
    ['timestamp', 'timestamp'],
  ];
  let result = '';
  for (const [key, name] of mapping) {
    const value = attrs[key];
    if (value === undefined || value === null) continue;
    result += ` data-${name}="${escapeHtml(String(value))}"`;
  }
  return result;
}

/** 单元格 colspan / rowspan 原生属性串（仅 > 1 输出，保持默认单元格输出不变） */
function cellSpanAttrs(attrs: BookNode['attrs']): string {
  let result = '';
  for (const name of ['colspan', 'rowspan'] as const) {
    const raw = attrs?.[name];
    const value =
      typeof raw === 'number' ? Math.round(raw) : Number.parseInt(String(raw ?? ''), 10);
    if (Number.isFinite(value) && value > 1) result += ` ${name}="${value}"`;
  }
  return result;
}

/** img 原生尺寸属性串（正数才输出；供浏览器在图片加载前预留版位，渲染保真） */
function imageSizeAttrs(attrs: BookNode['attrs']): string {
  let result = '';
  for (const name of ['width', 'height'] as const) {
    const value = attrs?.[name];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      result += ` ${name}="${value}"`;
    }
  }
  return result;
}

/** 表格单元格 → HTML（表头行输出 `th`，跨行跨列走原生属性） */
function tableCellToHtml(
  cell: BookNode,
  headerRow: boolean,
  options: SerializeNodeOptions,
): string {
  const tag = headerRow ? 'th' : 'td';
  const id = options.anchorIds?.get(cell) ?? cell.id;
  const idAttr = id !== undefined && id !== '' ? ` id="${escapeHtml(id)}"` : '';
  const attrs = cell.attrs;
  const spans = cellSpanAttrs(attrs);
  // colspan / rowspan 已输出为原生属性，其余（align / styleId / 扩展属性）仍走 data-*
  const extras = dataAttrs(attrs, ['colspan', 'rowspan']);
  return `<${tag}${idAttr} class="bt-table-cell"${spans}${extras}>${serializeChildren(cell, options)}</${tag}>`;
}

/** 表格行 → HTML（表头行标记 data-header，供 CSS 加粗 / 底色） */
function tableRowToHtml(row: BookNode, headerRow: boolean, options: SerializeNodeOptions): string {
  const id = options.anchorIds?.get(row) ?? row.id;
  const idAttr = id !== undefined && id !== '' ? ` id="${escapeHtml(id)}"` : '';
  const extras = dataAttrs(row.attrs, ['header']);
  const headerAttr = headerRow || row.attrs?.['header'] === true ? ' data-header="true"' : '';
  const cells = elementChildren(row)
    .filter((child) => child.type === NODE_TYPES.TABLE_CELL)
    .map((cell) => tableCellToHtml(cell, headerRow, options))
    .join('');
  return `<tr${idAttr} class="bt-table-row"${headerAttr}${extras}>${cells}</tr>`;
}

/**
 * 表格 → HTML
 *
 * - 开头的连续 `header: true` 行归入 `<thead>`（单元格输出 `th`），其余进 `<tbody>`；
 * - **无表头行时保持旧输出**（不包 tbody），避免既有 EPUB / 快照产物发生无意义变化；
 * - 跨行跨列写 `colspan` / `rowspan`，对齐写 `data-align`（CSS 负责渲染）。
 */
function tableToHtml(table: BookNode, options: SerializeNodeOptions): string {
  const id = options.anchorIds?.get(table) ?? table.id;
  const idAttr = id !== undefined && id !== '' ? ` id="${escapeHtml(id)}"` : '';
  const extras = dataAttrs(table.attrs, []);
  const rows = elementChildren(table).filter((child) => child.type === NODE_TYPES.TABLE_ROW);

  let headerCount = 0;
  while (headerCount < rows.length && rows[headerCount]?.attrs?.['header'] === true) {
    headerCount += 1;
  }

  const headerHtml = rows
    .slice(0, headerCount)
    .map((row) => tableRowToHtml(row, true, options))
    .join('');
  const bodyHtml = rows
    .slice(headerCount)
    .map((row) => tableRowToHtml(row, false, options))
    .join('');

  const inner =
    headerCount > 0
      ? `<thead>${headerHtml}</thead>${bodyHtml !== '' ? `<tbody>${bodyHtml}</tbody>` : ''}`
      : bodyHtml;
  return `<table${idAttr} class="bt-table"${extras}>${inner}</table>`;
}

/** 元素节点 → HTML（id / class / 属性 / 特例标签 / 子内容） */
function elementToHtml(node: BookNode, options: SerializeNodeOptions): string {
  const tag = resolveTag(node, options);
  const id = options.anchorIds?.get(node) ?? node.id;
  const attrs = node.attrs;

  const idAttr = id !== undefined && id !== '' ? ` id="${escapeHtml(id)}"` : '';
  const classAttr = ` class="bt-${escapeHtml(node.type)}"`;
  const whitelist = ATTR_WHITELIST[node.type] ?? [];

  /* 印章（classical 插件节点，layout 不能依赖它，故按类型名识别）：内联 SVG 印谱 */
  if (node.type === 'seal') {
    const text = typeof attrs?.text === 'string' ? attrs.text : '';
    const extras = dataAttrs(attrs, ['text', 'style', 'layout', 'border']);
    const textAttr = ` data-text="${escapeHtml(text)}"`;
    if (options.inlineSealSvg === false || text === '') {
      return `<span${idAttr} class="bt-seal"${textAttr}${extras}></span>`;
    }
    const sealStyle: SealStyle = attrs?.style === 'bai' ? 'bai' : 'zhu';
    const sealLayout: SealLayout = attrs?.layout === 'column' ? 'column' : 'square';
    const rawBorder = attrs?.border;
    const sealBorder: SealBorder =
      rawBorder === 'none' || rawBorder === 'thin' || rawBorder === 'thick' ? rawBorder : 'thick';
    const svg = renderSealSvg({
      text,
      style: sealStyle,
      layout: sealLayout,
      border: sealBorder,
    });
    return `<span${idAttr} class="bt-seal"${textAttr}${extras}>${svg}</span>`;
  }

  /* 表格：需要按表头行分组 thead/tbody 并把表头单元格输出为 th */
  if (node.type === NODE_TYPES.TABLE) {
    return tableToHtml(node, options);
  }

  /* 图片：src / alt 透传为原生属性（无值时输出空串占位），width / height 输出原生尺寸 */
  if (node.type === NODE_TYPES.IMAGE) {
    const rawSrc = typeof attrs?.src === 'string' ? attrs.src : '';
    const rewritten = options.rewriteSrc?.(rawSrc);
    const src = typeof rewritten === 'string' ? rewritten : rawSrc;
    const alt = typeof attrs?.alt === 'string' ? attrs.alt : '';
    const extras = dataAttrs(attrs, whitelist);
    const rest = serializeChildren(node, options);
    return `<img${idAttr}${classAttr} src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${imageSizeAttrs(attrs)}${extras} />${rest}`;
  }

  /* 行内字图（K6）：一个字位的缺字替代图，随文字流内联排版；
   * 尺寸 / 基线 / 直排旋转由 book-css 的 .bt-glyph-image 负责，
   * 原字走 data-char（无障碍与检索用），原始尺寸不输出（渲染恒 1em）。 */
  if (node.type === NODE_TYPES.GLYPH_IMAGE) {
    const rawSrc = typeof attrs?.src === 'string' ? attrs.src : '';
    const rewritten = options.rewriteSrc?.(rawSrc);
    const src = typeof rewritten === 'string' ? rewritten : rawSrc;
    const alt = typeof attrs?.alt === 'string' ? attrs.alt : '';
    const char = typeof attrs?.char === 'string' && attrs.char !== '' ? attrs.char : undefined;
    const charAttr = char !== undefined ? ` data-char="${escapeHtml(char)}"` : '';
    return `<img${idAttr}${classAttr} src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${charAttr} />`;
  }

  /* 注释块：注码提为独立 span（老引擎也能显示），marker / refId 不再重复输出为 data-* */
  const noteRole = noteRoleOf(node.type);
  const extras = dataAttrs(
    attrs,
    noteRole === undefined ? whitelist : [...whitelist, 'marker', 'refId'],
  );

  if (noteRole !== undefined) {
    const rawMarker = attrs?.marker;
    const marker =
      typeof rawMarker === 'string' || typeof rawMarker === 'number'
        ? String(rawMarker)
        : '';
    const rawRef = attrs?.refId;
    const refId = typeof rawRef === 'string' && rawRef !== '' ? rawRef : '';
    /*
     * 注码带 `data-note-ref`：让「注文 → 正文引用」有第二个命中点（回跳符号之外的
     * 注码本身），阅读器据此做双向高亮；`refId` 此前仅用于回跳 href，未落 DOM。
     */
    const markerHtml =
      marker === ''
        ? ''
        : `<span class="bt-note-marker"${refId === '' ? '' : ` data-note-ref="${escapeHtml(refId)}"`}>${escapeHtml(marker)}</span>`;
    const epubType = options.epubSemantics === true ? ` epub:type="${noteRole}"` : '';
    const backref =
      refId === '' ? '' : `<a class="bt-note-backref" href="#${escapeHtml(refId)}">↩</a>`;
    /*
     * 注释块自带 `data-note-id`：正文流里的注文（未浮注 / 尾注）没有页底注区包裹，
     * 阅读器需要统一锚点做「注码 → 注文」跳转与高亮；与 `serializePageNotes` 的
     * 容器属性同值，选择器取最外层也不会错位。
     */
    const noteId = node.id !== undefined && node.id !== '' ? node.id : '';
    const noteIdAttr = noteId === '' ? '' : ` data-note-id="${escapeHtml(noteId)}"`;
    return `<${tag}${idAttr}${classAttr}${epubType}${extras}${noteIdAttr}>${serializeNoteContent(node, markerHtml, options)}${backref}</${tag}>`;
  }

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
function applyMarks(
  html: string,
  marks: readonly BookMark[] | undefined,
  options: SerializeNodeOptions,
): string {
  if (marks === undefined || marks.length === 0) return html;
  let result = html;
  for (let i = 0; i < marks.length; i += 1) {
    const mark = marks[i];
    if (mark !== undefined) result = wrapMark(mark, result, options);
  }
  return result;
}

/** 单个标记 → HTML 包裹 */
function wrapMark(mark: BookMark, inner: string, options: SerializeNodeOptions): string {
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
    case MARK_TYPES.NOTE_REF: {
      const targetId = typeof attrs?.targetId === 'string' ? attrs.targetId : '';
      const refId = typeof attrs?.refId === 'string' ? attrs.refId : '';
      const idAttr = refId !== '' ? ` id="${escapeHtml(refId)}"` : '';
      const epubType = options.epubSemantics === true ? ' epub:type="noteref"' : '';
      const href = targetId !== '' ? ` href="#${escapeHtml(targetId)}"` : '';
      return `<a${idAttr} class="bt-mark-noteref"${href}${epubType}>${inner}</a>`;
    }
    /* C5 修订：语义标签 + 修订元信息（`previous` 体积大，不落 DOM） */
    case MARK_TYPES.INSERTION: {
      const extras = dataAttrs(attrs, ['changeId', 'author', 'timestamp', 'previous']);
      return `<ins class="bt-mark-insertion"${revisionDataAttrs(attrs)}${extras}>${inner}</ins>`;
    }
    case MARK_TYPES.DELETION: {
      const extras = dataAttrs(attrs, ['changeId', 'author', 'timestamp', 'previous']);
      return `<del class="bt-mark-deletion"${revisionDataAttrs(attrs)}${extras}>${inner}</del>`;
    }
    case MARK_TYPES.FORMAT_CHANGE: {
      const extras = dataAttrs(attrs, ['changeId', 'author', 'timestamp', 'previous']);
      return `<span class="bt-mark-format-change"${revisionDataAttrs(attrs)}${extras}>${inner}</span>`;
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

/**
 * 注释块内容序列化（注码与注文同起一行）
 *
 * 注码若与注文段落平级输出，块级段落会另起一行，注码独自占一行——
 * 阅读器里表现为「1」后面空一行才见注文。故把注码 span 注入**首个块的开始标签之后**，
 * 让 `<p>` 内首行是「1 注文…」，与纸书页底注的排法一致。
 */
function serializeNoteContent(
  note: BookNode,
  markerHtml: string,
  options: SerializeNodeOptions,
): string {
  const children = note.children ?? [];
  const rendered = children.map((child) => nodeToHtml(child, options));
  if (markerHtml === '' || rendered.length === 0) {
    return rendered.join('') + (markerHtml === '' ? '' : markerHtml);
  }
  const first = children[0];
  const firstHtml = rendered[0] ?? '';
  if (first === undefined || isTextNode(first)) {
    rendered[0] = `${markerHtml}${firstHtml}`;
    return rendered.join('');
  }
  /* 取首个开始标签（如 `<p class="bt-paragraph">`）并紧随其后插入注码 */
  const open = /^<[^>]*>/.exec(firstHtml)?.[0];
  rendered[0] =
    open !== undefined ? `${open}${markerHtml}${firstHtml.slice(open.length)}` : `${markerHtml}${firstHtml}`;
  return rendered.join('');
}

/** 节点分发（文本叶子 / 透明根 / 元素） */
function nodeToHtml(node: BookNode, options: SerializeNodeOptions): string {
  if (isTextNode(node)) {
    const raw = node.text ?? '';
    const text = options.verticalText === undefined ? raw : transformVerticalText(raw, options.verticalText);
    const html = serializeGlyphText(text, options.glyph);
    if (options.revisionView !== undefined && options.revisionView !== 'marked') {
      const resolved = resolveMarksForView(node.marks, options.revisionView);
      if (resolved.hidden) return '';
      return applyMarks(html, resolved.marks, options);
    }
    return applyMarks(html, node.marks, options);
  }
  if (node.type === NODE_TYPES.BOOK) {
    return serializeChildren(node, options);
  }
  /* A6：条件内容按上下文裁剪；缺省上下文保留 */
  if (node.type === NODE_TYPES.CONDITION) {
    const when = typeof node.attrs?.when === 'string' ? node.attrs.when : '';
    if (!evaluateCondition(when, options.conditionContext)) return '';
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
