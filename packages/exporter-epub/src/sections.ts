/**
 * 章节文件规划（BookDocument → EPUB spine 拆分）
 *
 * 文件切分策略：
 * - 结构节点（卷/章/节/附录/序/跋/目录）各成一文件（卷容纳其全部子结构）；
 * - 连续的非结构块（散段）聚合为一个匿名文件；
 * - 结构节点无 id 时自动分配锚点（bt-a-N），经序列化器注入并由 nav 跳转。
 *
 * **体积兜底拆分（splitSections）**：导入型扁平文档（外部 EPUB 回收后只剩
 * 标题 + 段落的扁平序列，无任何结构节点）若整体聚合成单文件，会产出
 * MB 级 XHTML——京东读书（RMSDK）/ 微信读书解析超大单文档 + 中部锚点
 * 定位直接失败（实测：335 篇原书导出成 1 个 1.5MB 文档即打不开）。
 * 故在结构分组之后按「单文档未压缩字节上限」做贪心拆分，拆分边界只取
 * 元素节点之间（不在元素内部断），保证每份产物仍是格式良好的 XHTML。
 *
 * 目录来源有二（`buildNavItems` 统一汇总）：
 * - 结构节点：卷 / 章 / 节的层级，古籍与自撰书籍走这条；
 * - **顶层标题**：导入型文档（外部 EPUB 经 IR 回收后往往塌缩为 h1/h2 + 段落的扁平序列，
 *   不产生任何结构节点）若只认结构节点，导出目录会是**空的**——
 *   补充「顶层且层级 ≤ MAX_NAV_HEADING_LEVEL 的标题」作为第二目录来源，保证导入的书目录不丢。
 * 结构节点内部的标题不另行入目录，以免与所属章 / 节的条目重复。
 *
 * 目录深度与阅读器目录面板同口径：结构节点不限深度，标题回退分支收 h1~h6 并按
 * 级别嵌套；**目录深度与文件切分深度解耦**——后者只认 h1/h2 断节（MAX_SPLIT_HEADING_LEVEL），
 * 以免小节数量让 XHTML 文件数翻倍。
 */
import { NODE_TYPES, isTextNode, type BookNode } from '@bibliotype/core';
import { resolveNodeTitle } from '@bibliotype/reader';

/** 独立成文件 / 参与导航的结构节点类型 */
export const SECTION_TYPES: ReadonlySet<string> = new Set([
  NODE_TYPES.VOLUME,
  NODE_TYPES.CHAPTER,
  NODE_TYPES.SECTION,
  NODE_TYPES.APPENDIX,
  NODE_TYPES.PREFACE,
  NODE_TYPES.POSTSCRIPT,
  NODE_TYPES.TOC,
]);

/**
 * 前置页类型（各成独立 XHTML，但**不进目录**）
 *
 * 封面 / 书名页 / 版权页 / 封底是书的前后件：单独成文件便于阅读器按页加载与
 * 打印；但它们不是正文章节，进目录会污染导航。
 */
export const FRONT_MATTER_TYPES: ReadonlySet<string> = new Set([
  NODE_TYPES.COVER,
  NODE_TYPES.TITLE_PAGE,
  NODE_TYPES.COPYRIGHT_PAGE,
  NODE_TYPES.BACK_COVER,
]);

/** 前置页 → EPUB 结构语义（`body epub:type`；封底不标注） */
const FRONT_MATTER_EPUB_TYPES: Readonly<Record<string, string>> = {
  [NODE_TYPES.COVER]: 'cover',
  [NODE_TYPES.TITLE_PAGE]: 'titlepage',
  [NODE_TYPES.COPYRIGHT_PAGE]: 'copyright-page',
};

/** 取前置页的 EPUB 语义类型（非前置页返回 undefined） */
export function frontMatterEpubType(nodeType: string | undefined): string | undefined {
  if (nodeType === undefined) return undefined;
  return FRONT_MATTER_EPUB_TYPES[nodeType];
}

/** 结构节点缺省导航标签（无标题时回退） */
const FALLBACK_LABELS: Readonly<Record<string, string>> = {
  [NODE_TYPES.VOLUME]: '卷',
  [NODE_TYPES.CHAPTER]: '章',
  [NODE_TYPES.SECTION]: '节',
  [NODE_TYPES.APPENDIX]: '附录',
  [NODE_TYPES.PREFACE]: '序',
  [NODE_TYPES.POSTSCRIPT]: '跋',
  [NODE_TYPES.TOC]: '目录',
};

/**
 * 参与目录的标题最大层级（h1~h6，与 `headingLevel` 的夹持范围一致）
 *
 * 与阅读器目录面板同口径：面板的标题回退分支收录 h1~h6 并按级别嵌套。
 * 导出若只收 h1/h2，导入型文档（Markdown / DOCX / 无目录 EPUB）的目录会比
 * 面板明显「浅」，第三方阅读器看到的层级也就与作者看到的对不上。
 * 目录条目变多不增加 XHTML 文件数（见 MAX_SPLIT_HEADING_LEVEL）。
 */
export const MAX_NAV_HEADING_LEVEL = 6;

/**
 * 优先断点的最大标题层级（h1 / h2）
 *
 * 只影响「体积兜底拆分」的断节位置：顶层标题在此断节，使每份文档以标题开头
 * （与中华书局面 EPUB「一篇一文件」同构）；h3 及更深标题仍进目录，但不额外
 * 开一份 XHTML。与目录深度解耦，故单列常量。
 */
export const MAX_SPLIT_HEADING_LEVEL = 2;

/** 章节文件计划 */
export interface SectionPlan {
  /** OEBPS 内相对路径（如 'text/sec-0.xhtml'） */
  file: string;
  /** 该文件承载的顶层节点（结构节点为一个；散块聚合为多个） */
  nodes: readonly BookNode[];
}

/** 文档规划结果 */
export interface DocumentPlan {
  sections: SectionPlan[];
  /** 节点 → 锚点 id（无 id 的结构节点自动分配，序列化时经 anchorIds 注入） */
  anchors: ReadonlyMap<BookNode, string>;
}

/**
 * 单文档未压缩字节上限（默认 256 KiB）
 *
 * 参照：中华书局正版 EPUB 单文档中位 ~7KB、最大 ~43KB；256KiB 留有数量级余量，
 * 又能把「335 篇聚合成 1.5MB 单文档」这类导入型书籍切回正常规模。
 */
export const DEFAULT_MAX_SECTION_BYTES = 256 * 1024;

/** XHTML 文档壳（head / title / link / body 包裹）的近似字节开销（含长标题与节点间换行的余量） */
const XHTML_SHELL_OVERHEAD = 2048;

/** 拆分选项 */
export interface SplitSectionsOptions {
  /** 单文档未压缩字节上限（缺省 DEFAULT_MAX_SECTION_BYTES） */
  maxSectionBytes?: number;
  /** 序列化函数（exporter 传 layout/html 的 serializeNode；测试可注入桩） */
  serialize: (node: BookNode, options: SerializeOptions) => string;
  /** 透传给序列化函数的选项（anchorIds / tagOverrides / rewriteSrc） */
  serializeOptions?: SerializeOptions;
}

/** 序列化选项（与 @bibliotype/layout/html 的 SerializeNodeOptions 同构，避免导出包反向依赖其类型出口） */
export interface SerializeOptions {
  tagOverrides?: Readonly<Record<string, string>>;
  anchorIds?: ReadonlyMap<BookNode, string>;
  rewriteSrc?: (src: string) => string | undefined;
  /** 输出 EPUB 3 结构语义属性（注释块的 epub:type） */
  epubSemantics?: boolean;
}

/** 拆分结果（含体积超限的告警，由校验器转换为 ERROR/WARNING） */
export interface SplitResult {
  sections: SectionPlan[];
  /** 无法再拆的巨型节点（单块超上限且无元素子节点可断） */
  oversized: BookNode[];
}

/**
 * 结构分组之后按字节上限贪心拆分
 *
 * 规则：
 * - 逐节点序列化并测量（UTF-8 字节），只累加到「内容 + 文档壳 ≤ 上限」为止；
 * - 单个节点超上限且含元素子节点 → 递归拆其子节点：首桶保留原节点外壳
 *   （含 id，导航锚点继续有效），后续桶用「剥 id 的克隆外壳」承接剩余子节点，
 *   避免同一 id 出现在多份文档；
 * - 单块超上限且无元素子节点（巨型段落）→ 独占一桶并记入 `oversized`
 *   （段内切断会破坏文本连续性，交由校验器报 WARNING）；
 * - 空节点（如空 section）不占桶（避免产出空文档）。
 */
export function splitSections(plan: DocumentPlan, options: SplitSectionsOptions): SplitResult {
  const max = Math.max(4 * 1024, options.maxSectionBytes ?? DEFAULT_MAX_SECTION_BYTES);
  const budget = max - XHTML_SHELL_OVERHEAD;
  const oversized: BookNode[] = [];
  const buckets: BookNode[][] = [];

  const measure = (node: BookNode): string =>
    options.serialize(node, options.serializeOptions ?? {});

  /** 把一组节点贪心装桶（超限结构节点先递归展开为「外壳克隆」桶） */
  const pack = (nodes: readonly BookNode[]): void => {
    let current: BookNode[] = [];
    let currentBytes = 0;
    const flush = (): void => {
      if (current.length > 0) {
        buckets.push(current);
        current = [];
        currentBytes = 0;
      }
    };
    for (const node of nodes) {
      const html = measure(node);
      if (html === '') continue; /* 空节点不占桶 */
      const bytes = byteLength(html);
      if (bytes > budget) {
        /* 单节点超限：先结算当前桶，再按子节点边界递归拆（不在元素内部断） */
        flush();
        const children = elementChildrenOf(node);
        if (children.length > 1) {
          const childBuckets = packToBuckets(children);
          childBuckets.forEach((slice, index) => {
            buckets.push([
              index === 0
                ? withChildren(node, slice)
                : withChildren(node, slice, /* keepId */ false),
            ]);
          });
        } else {
          /* 无元素子节点可断（巨型段落）：独占一桶并记入 oversized（校验器告警） */
          oversized.push(node);
          buckets.push([node]);
        }
        continue;
      }
      /*
       * 优先断点：顶层标题（h1/h2，目录范围内）强制开新桶。
       * 导入型扁平书的「篇 / 节」边界即顶层标题——在此断节，每份文档
       * 以标题开头（与中华书局面 EPUB「一篇一文件」的结构同构），
       * 目录锚点天然落在节首，阅读器按节加载也更轻。
       */
      if (isPreferredBreak(node) && current.length > 0) flush();
      if (current.length > 0 && currentBytes + bytes > budget) flush();
      current.push(node);
      currentBytes += bytes;
    }
    flush();
  };

  /** 递归装桶（返回桶数组而非直接写入 buckets） */
  const packToBuckets = (nodes: readonly BookNode[]): BookNode[][] => {
    const saved = buckets.length;
    const restore = (): BookNode[][] => {
      const produced = buckets.slice(saved);
      buckets.length = saved;
      return produced;
    };
    pack(nodes);
    return restore();
  };

  for (const section of plan.sections) {
    pack(section.nodes);
  }

  /* 空书兜底：保证至少一个内容文档（EPUB spine 不能为空） */
  if (buckets.length === 0) {
    buckets.push([]);
  }

  return {
    sections: buckets.map((nodes, index) => ({ file: `text/sec-${index}.xhtml`, nodes })),
    oversized,
  };
}

/** 元素子节点（剔除文本叶子） */
function elementChildrenOf(node: BookNode): BookNode[] {
  return (node.children ?? []).filter((child) => !isTextNode(child));
}

/**
 * 是否为「优先断点」节点：目录范围内的顶层标题（h1 / h2）
 *
 * 导入型扁平书的「篇 / 节」边界即顶层标题；在此断节使每份文档以标题开头，
 * 目录锚点落在节首，结构上与「一篇一文件」的正式 EPUB 同构。
 */
function isPreferredBreak(node: BookNode): boolean {
  if (node.type !== NODE_TYPES.HEADING) return false;
  const raw = node.attrs?.level;
  const level = typeof raw === 'number' ? Math.round(raw) : 1;
  return level <= MAX_SPLIT_HEADING_LEVEL;
}

/** 浅克隆节点并替换子节点（keepId=false 时剥掉 id，避免跨文档重复） */
function withChildren(node: BookNode, children: BookNode[], keepId = true): BookNode {
  const clone: BookNode = { ...node, children };
  if (!keepId) delete clone.id;
  return clone;
}

/** UTF-8 字节长度（TextEncoder 两端可用；导出路径对总体积敏感，用近似亦可，此处取精确值） */
function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** 规划文档章节文件与锚点 */
export function planDocument(root: BookNode): DocumentPlan {
  const elements = (root.children ?? []).filter((child) => !isTextNode(child));

  const sections: SectionPlan[] = [];
  let pending: BookNode[] = [];

  const flushPending = (): void => {
    if (pending.length === 0) return;
    sections.push({ file: `text/sec-${sections.length}.xhtml`, nodes: pending });
    pending = [];
  };

  for (const child of elements) {
    if (SECTION_TYPES.has(child.type) || FRONT_MATTER_TYPES.has(child.type)) {
      flushPending();
      sections.push({ file: `text/sec-${sections.length}.xhtml`, nodes: [child] });
    } else {
      pending.push(child);
    }
  }
  flushPending();

  /* 空书：保证至少一个内容文档（EPUB spine 不能为空） */
  if (sections.length === 0) {
    sections.push({ file: 'text/sec-0.xhtml', nodes: [] });
  }

  /* 锚点分配：候选导航节点无 id 时自动编号（确定性：按文档序递增）
     候选含两类：结构节点（既有行为）与**顶层**标题（导入型文档的目录锚点）。
     结构节点内部的标题不分配——它们不产生目录条目，多给 id 只会污染 XHTML 输出。 */
  const anchors = new Map<BookNode, string>();
  let counter = 0;
  const allocate = (node: BookNode): void => {
    if (anchors.has(node)) return;
    counter += 1;
    anchors.set(node, `bt-a-${counter}`);
  };
  const visit = (node: BookNode): void => {
    if (
      SECTION_TYPES.has(node.type) &&
      (node.id === undefined || node.id === '')
    ) {
      allocate(node);
    }
    for (const child of node.children ?? []) {
      if (!isTextNode(child)) visit(child);
    }
  };
  for (const section of sections) {
    for (const node of section.nodes) {
      if (isNavHeadingCandidate(node)) allocate(node);
      visit(node);
    }
  }

  return { sections, anchors };
}

/** 解析标题层级（attrs.level；缺省 / 非法值回退 1，并夹在 1..6 内） */
function headingLevel(node: BookNode): number {
  const raw = node.attrs?.level;
  const level = typeof raw === 'number' ? Math.round(raw) : 1;
  return Math.min(6, Math.max(1, level));
}

/** 是否为「需自动分配锚点的顶层标题」：无 id、标题非空且层级在目录范围内 */
function isNavHeadingCandidate(node: BookNode): boolean {
  return (
    node.type === NODE_TYPES.HEADING &&
    (node.id === undefined || node.id === '') &&
    headingLevel(node) <= MAX_NAV_HEADING_LEVEL &&
    /* 空标题不产生目录条目，不必为它注入锚点 */
    resolveNodeTitle(node) !== ''
  );
}

/** 导航条目 */
export interface NavItem {
  label: string;
  href: string;
  children: NavItem[];
}

/**
 * 构建导航条目
 *
 * 两类来源（与阅读器目录面板同口径）：
 * - 结构层级（卷 / 章 / 节）→ 嵌套 NavItem，深度不限；
 * - 顶层标题（h1~h6）→ **按标题级别栈式嵌套**；这是导入型文档唯一的目录来源。
 *   二级先于一级出现（书以 h2 开头）时落顶层，宁平勿丢。
 *
 * href 为「文件相对路径 + 锚点」（相对 OEBPS，nav.xhtml 与 toc.ncx 同在此目录）。
 *
 * @param sections 拆分后的章节列表（`splitSections` 产物；结构分组结果亦可）
 * @param anchors 节点 → 锚点 id 表（`planDocument` 产物）
 */
export function buildNavItems(
  sections: readonly SectionPlan[],
  anchors: ReadonlyMap<BookNode, string>,
): NavItem[] {
  const items: NavItem[] = [];
  /*
   * 标题层级栈：栈顶是当前最深的祖先标题条目。遇结构节点清空——结构节点
   * 自带子树，标题不能再挂到上一个结构节点里去（避免跨结构串挂）。
   */
  const stack: { level: number; item: NavItem }[] = [];

  for (const section of sections) {
    for (const node of section.nodes) {
      if (SECTION_TYPES.has(node.type)) {
        const item = structureItem(node, section.file, anchors);
        if (item !== null) items.push(item);
        stack.length = 0;
        continue;
      }
      if (node.type !== NODE_TYPES.HEADING) continue;

      const level = headingLevel(node);
      if (level > MAX_NAV_HEADING_LEVEL) continue;
      const label = resolveNodeTitle(node);
      /* 无可读标题（空标题节点）不产出空目录条目 */
      if (label === '') continue;

      const id = anchors.get(node) ?? node.id;
      const href = id !== undefined && id !== '' ? `${section.file}#${id}` : section.file;
      const item: NavItem = { label, href, children: [] };

      /* 出栈至「更高级的祖先」：同级或更深者都是兄弟，不能当父节点 */
      while (stack.length > 0 && (stack[stack.length - 1]?.level ?? 0) >= level) stack.pop();
      const parent = stack[stack.length - 1];
      if (parent === undefined) items.push(item);
      else parent.item.children.push(item);
      stack.push({ level, item });
    }
  }
  return items;
}

/** 结构节点 → 导航项（非结构节点返回 null；标题缺省回退类型名） */
function structureItem(
  node: BookNode,
  file: string,
  anchors: ReadonlyMap<BookNode, string>,
): NavItem | null {
  if (!SECTION_TYPES.has(node.type)) return null;

  const id = anchors.get(node) ?? node.id;
  const href = id !== undefined && id !== '' ? `${file}#${id}` : file;
  const label = resolveNodeTitle(node) || FALLBACK_LABELS[node.type] || node.type;

  const children: NavItem[] = [];
  for (const child of node.children ?? []) {
    if (isTextNode(child)) continue;
    const item = structureItem(child, file, anchors);
    if (item !== null) children.push(item);
  }

  return { label, href, children };
}
