/**
 * 功能样式表（Feature StyleSheet）
 *
 * 设计背景见仓库根 `编辑功能细节设置改造清单.md`：
 * 令牌层（tokens）只能表达「全局基准」，而书册里每个节点 / 标记的样式（双行注字号、
 * 眉批边框、圈点样式、专名号线型……）此前全部硬编码在 `packages/layout/src/html/book-css.ts`。
 * 本模块引入第三层：**按功能粒度覆盖 CSS 声明**，且与内容（IR）解耦：
 *
 * - 内容只记结构（`mark.underline`），外观全在样式表 → 导入器不认识样式也不会丢内容；
 * - 样式表稀疏存储（只记被改过的功能），空对象 = 完全继承默认；
 * - 编译出口唯一（`buildBookCss`），编辑画布 / 阅读预览 / EPUB / PDF 四端同源。
 *
 * 本模块只含类型与纯函数，无 DOM 依赖。
 */

/* -------------------------------------------------------------------------- */
/* 功能标识                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * 可单独配置的功能标识
 *
 * 命名规则：`<类别>.<对象>[.<变体>]`
 * - `block.*` 块级节点：core 内置节点与古籍专有节点；
 * - `mark.*` 行内标记：core 标准标记与古籍标记；
 * - `role.*` 版式角色：结构页（封面 / 扉页 / 版权页 / 目录）与页脚页码等
 *   （序列化器以 `data-role` 输出，不是独立节点类型）。
 *
 * 与 CSS 选择器的一一映射见 `packages/layout/src/html/feature-selectors.ts`，
 * 两侧必须保持同步（`feature-selectors.test.ts` 有覆盖校验）。
 */
export const FEATURE_STYLE_IDS = [
  /* ---------- 块级：正文与常规块 ---------- */
  'block.paragraph',
  'block.heading.1',
  'block.heading.2',
  'block.heading.3',
  'block.heading.4',
  'block.heading.5',
  'block.heading.6',
  'block.quote',
  'block.list',
  'block.list-item',
  'block.code-block',
  'block.table',
  'block.table-cell',
  'block.image',
  'block.caption',
  'block.break',
  'block.math-block',

  /* ---------- 注释块 ---------- */
  'block.footnote',
  'block.endnote',
  'block.margin-note',

  /* ---------- 行内标记：core ---------- */
  'mark.strong',
  'mark.emphasis',
  'mark.underline',
  'mark.strikethrough',
  'mark.highlight',
  'mark.code',
  'mark.link',
  'mark.ruby',

  /* ---------- 行内标记：古籍 ---------- */
  'mark.proper-name',
  'mark.book-title',
  'mark.circle-emphasis',
  'mark.note-ref',
  'mark.variant',
  'mark.taboo',

  /* ---------- 古籍节点：注疏 ---------- */
  'block.double-note',
  'block.inline-note',
  'block.head-note',
  'block.tail-note',

  /* ---------- 古籍节点：校勘 / 字形 ---------- */
  'block.collation-note',
  'block.collation-mark',
  'block.variant-char',
  'block.taboo-char',

  /* ---------- 古籍节点：版本形态 ---------- */
  'block.imprint',
  'block.colophon',
  'block.seal',
  'block.border-frame',
  'block.fish-tail',

  /* ---------- 版式角色：页面装饰 ---------- */
  'role.page-number',
  'role.page-header',
  'role.page-footer',

  /* ---------- 版式角色：结构页 ---------- */
  'role.cover-title',
  'role.cover-subtitle',
  'role.cover-creator',
  'role.cover-publisher',
  'role.title-page-title',
  'role.title-page-subtitle',
  'role.title-page-creator',
  'role.title-page-publisher',
  'role.copyright-title',
  'role.copyright-line',
  'role.toc-title',
  'role.toc-entry',
  'role.toc-subentry',
  'role.volume-title',
  'role.volume-creator',
  'role.back-cover-line',
] as const;

/** 功能样式标识 */
export type FeatureStyleId = (typeof FEATURE_STYLE_IDS)[number];

/** 功能分组（UI 左导航顺序） */
export const FEATURE_STYLE_GROUPS = [
  { id: 'text', label: '文字与标记' },
  { id: 'block', label: '段落与块' },
  { id: 'classical', label: '古籍注疏' },
  { id: 'mark-classical', label: '古籍标记' },
  { id: 'page-role', label: '页面与结构页' },
] as const;

/** 功能分组标识 */
export type FeatureStyleGroupId = (typeof FEATURE_STYLE_GROUPS)[number]['id'];

/** 功能元信息（中文标签 + 分组 + 是否古籍专有） */
export interface FeatureStyleMeta {
  id: FeatureStyleId;
  label: string;
  group: FeatureStyleGroupId;
  /** 古籍专有（现代书籍主题下同样生效，仅在 UI 上折叠） */
  classical?: boolean;
}

/** 功能元信息表（UI 与文档共用同一份来源） */
export const FEATURE_STYLE_META: Readonly<Record<FeatureStyleId, Omit<FeatureStyleMeta, 'id'>>> = {
  'block.paragraph': { label: '正文段落', group: 'block' },
  'block.heading.1': { label: '标题 1', group: 'block' },
  'block.heading.2': { label: '标题 2', group: 'block' },
  'block.heading.3': { label: '标题 3', group: 'block' },
  'block.heading.4': { label: '标题 4', group: 'block' },
  'block.heading.5': { label: '标题 5', group: 'block' },
  'block.heading.6': { label: '标题 6', group: 'block' },
  'block.quote': { label: '引用块', group: 'block' },
  'block.list': { label: '列表', group: 'block' },
  'block.list-item': { label: '列表项', group: 'block' },
  'block.code-block': { label: '代码块', group: 'block' },
  'block.table': { label: '表格', group: 'block' },
  'block.table-cell': { label: '表格单元格', group: 'block' },
  'block.image': { label: '图片', group: 'block' },
  'block.caption': { label: '图注 / 图表题', group: 'block' },
  'block.break': { label: '分隔线 / 分页符', group: 'block' },
  'block.math-block': { label: '块级公式', group: 'block' },
  'block.footnote': { label: '脚注', group: 'block' },
  'block.endnote': { label: '尾注', group: 'block' },
  'block.margin-note': { label: '边注', group: 'block' },

  'mark.strong': { label: '粗体', group: 'text' },
  'mark.emphasis': { label: '斜体', group: 'text' },
  'mark.underline': { label: '下划线', group: 'text' },
  'mark.strikethrough': { label: '删除线', group: 'text' },
  'mark.highlight': { label: '高亮', group: 'text' },
  'mark.code': { label: '行内代码', group: 'text' },
  'mark.link': { label: '链接', group: 'text' },
  'mark.ruby': { label: '注音', group: 'text' },

  'mark.proper-name': { label: '专名号', group: 'mark-classical', classical: true },
  'mark.book-title': { label: '书名号', group: 'mark-classical', classical: true },
  'mark.circle-emphasis': { label: '圈点', group: 'mark-classical', classical: true },
  'mark.note-ref': { label: '注号', group: 'mark-classical', classical: true },
  'mark.variant': { label: '异体字标记', group: 'mark-classical', classical: true },
  'mark.taboo': { label: '避讳标记', group: 'mark-classical', classical: true },

  'block.double-note': { label: '双行小注', group: 'classical', classical: true },
  'block.inline-note': { label: '夹注', group: 'classical', classical: true },
  'block.head-note': { label: '眉批', group: 'classical', classical: true },
  'block.tail-note': { label: '跋文', group: 'classical', classical: true },
  'block.collation-note': { label: '校勘记', group: 'classical', classical: true },
  'block.collation-mark': { label: '出校符号', group: 'classical', classical: true },
  'block.variant-char': { label: '异体字载体', group: 'classical', classical: true },
  'block.taboo-char': { label: '避讳字载体', group: 'classical', classical: true },
  'block.imprint': { label: '牌记', group: 'classical', classical: true },
  'block.colophon': { label: '题记', group: 'classical', classical: true },
  'block.seal': { label: '印章', group: 'classical', classical: true },
  'block.border-frame': { label: '版框', group: 'classical', classical: true },
  'block.fish-tail': { label: '鱼尾', group: 'classical', classical: true },

  'role.page-number': { label: '页码', group: 'page-role' },
  'role.page-header': { label: '页眉', group: 'page-role' },
  'role.page-footer': { label: '页脚', group: 'page-role' },
  'role.cover-title': { label: '封面主书名', group: 'page-role' },
  'role.cover-subtitle': { label: '封面副题', group: 'page-role' },
  'role.cover-creator': { label: '封面著者', group: 'page-role' },
  'role.cover-publisher': { label: '封面出版者', group: 'page-role' },
  'role.title-page-title': { label: '扉页书名', group: 'page-role' },
  'role.title-page-subtitle': { label: '扉页副题', group: 'page-role' },
  'role.title-page-creator': { label: '扉页著者', group: 'page-role' },
  'role.title-page-publisher': { label: '扉页出版者', group: 'page-role' },
  'role.copyright-title': { label: '版权页标题', group: 'page-role' },
  'role.copyright-line': { label: '版权页条目', group: 'page-role' },
  'role.toc-title': { label: '目录标题', group: 'page-role' },
  'role.toc-entry': { label: '目录条目', group: 'page-role' },
  'role.toc-subentry': { label: '目录子条目', group: 'page-role' },
  'role.volume-title': { label: '卷端题名', group: 'page-role' },
  'role.volume-creator': { label: '卷端题署', group: 'page-role' },
  'role.back-cover-line': { label: '封底文字', group: 'page-role' },
};

/* -------------------------------------------------------------------------- */
/* 样式声明与样式表                                                            */
/* -------------------------------------------------------------------------- */

/** 单个功能的 CSS 声明（属性名 kebab-case → 值；空对象 = 继承默认） */
export type FeatureDeclarations = Record<string, string>;

/** 用户样式表（稀疏：只存被覆盖过的功能） */
export type FeatureStyleSheet = Partial<Record<FeatureStyleId, FeatureDeclarations>>;

/** 合并两份样式表（后者优先，逐声明合并；空声明视为删除该覆盖） */
export function mergeFeatureStyleSheets(
  ...sheets: ReadonlyArray<FeatureStyleSheet | undefined>
): FeatureStyleSheet {
  const result: FeatureStyleSheet = {};
  for (const sheet of sheets) {
    if (sheet === undefined) continue;
    for (const [id, declarations] of Object.entries(sheet) as Array<
      [FeatureStyleId, FeatureDeclarations | undefined]
    >) {
      if (declarations === undefined) continue;
      const keys = Object.keys(declarations);
      if (keys.length === 0) {
        delete result[id];
        continue;
      }
      result[id] = { ...result[id], ...declarations };
    }
  }
  return result;
}

/* -------------------------------------------------------------------------- */
/* 度量影响判定                                                                */
/* -------------------------------------------------------------------------- */

/**
 * 影响排版度量的 CSS 属性
 *
 * 改动这些属性会改变「每行字数 / 行高 / 块高」，因此必须让尺寸表失效并重新分页；
 * 其余属性（颜色、线型、底色、圆角、阴影……）只影响绘制，改完只换样式表，**禁止重排**。
 *
 * 判定原则：
 * - 改变字形宽度 / 字号 / 字距 → 影响每行字数；
 * - 改变行盒高度 → 影响每页行数；
 * - 改变 margin / padding / border-width / 列数 → 影响块高或版心；
 * - transform / text-emphasis / text-decoration / background 等纯绘制属性 → 不影响。
 */
export const METRIC_PROPERTIES: ReadonlySet<string> = new Set([
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'font-stretch',
  'font-variant-ligatures',
  'font-feature-settings',
  'line-height',
  'letter-spacing',
  'word-spacing',
  'text-indent',
  'text-transform',
  'white-space',
  'overflow-wrap',
  'word-break',
  'hyphens',
  'tab-size',
  'vertical-align',
  'ruby-position',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'margin-block',
  'margin-block-start',
  'margin-block-end',
  'margin-inline',
  'margin-inline-start',
  'margin-inline-end',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'padding-block',
  'padding-block-start',
  'padding-block-end',
  'padding-inline',
  'padding-inline-start',
  'padding-inline-end',
  'border-width',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'display',
  'writing-mode',
  'column-count',
  'column-gap',
  'columns',
  'width',
  'max-width',
  'min-width',
  'height',
]);

/** 判断一组声明是否含度量类属性 */
export function declarationsImpactMetrics(
  declarations: FeatureDeclarations | undefined,
): boolean {
  if (declarations === undefined) return false;
  for (const key of Object.keys(declarations)) {
    if (METRIC_PROPERTIES.has(key)) return true;
  }
  return false;
}

/** 判断样式表是否含任何度量类覆盖 */
export function featureSheetImpactsMetrics(sheet: FeatureStyleSheet | undefined): boolean {
  if (sheet === undefined) return false;
  for (const declarations of Object.values(sheet)) {
    if (declarationsImpactMetrics(declarations)) return true;
  }
  return false;
}

/**
 * 计算样式表的「度量签名」
 *
 * 只纳入度量类声明，且对键排序保证稳定：签名不变 → 不必重新分页（只换样式表）。
 * 返回空串表示该样式表不含任何度量类覆盖。
 */
export function computeFeatureMetricsSignature(sheet: FeatureStyleSheet | undefined): string {
  if (sheet === undefined) return '';
  const parts: string[] = [];
  for (const id of FEATURE_STYLE_IDS) {
    const declarations = sheet[id];
    if (declarations === undefined) continue;
    const entries = Object.entries(declarations)
      .filter(([property]) => METRIC_PROPERTIES.has(property))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    if (entries.length === 0) continue;
    parts.push(`${id}{${entries.map(([k, v]) => `${k}:${v}`).join(';')}}`);
  }
  return parts.join('|');
}

/* -------------------------------------------------------------------------- */
/* 命名样式（Word 式 styleId）                                                 */
/* -------------------------------------------------------------------------- */

/**
 * 命名样式
 *
 * 与「功能样式」的区别：功能样式是按类型统一生效（所有下划线共用一个样式），
 * 命名样式是**给个别段落挂一个具名样式**（如「引文-楷体」「图表题注」），
 * 由节点 attrs 的 `styleId` 引用、序列化器输出 `data-style-id`，再经 CSS 命中。
 *
 * 之所以不进正式 attrs：导入器（docx / epub / markdown）不认识 styleId，
 * 写成正式属性会破坏 IR 无损往返约定；因此 `styleId` 走 rawAttrs 兜底容器，
 * 导入侧不识别即自然丢弃，导出侧再由 serializer 输出。
 */
export interface NamedStyle {
  /** 唯一标识（CSS 选择器里使用，建议 `ns-` 前缀 + 短随机串） */
  id: string;
  /** 显示名 */
  name: string;
  /** 依据的功能（决定「修改」面板显示哪一组参数、以及默认目标节点类型） */
  featureId: FeatureStyleId;
  /**
   * 依据的命名样式 id（Word 式「基于」）
   *
   * 声明按「祖先在前、后代覆盖」合并；CSS 不支持跨规则继承，故渲染侧必须
   * 先经 `resolveNamedStyleDeclarations` 扁平化。缺省表示不继承。
   */
  basedOn?: string;
  /** 声明（覆盖该功能样式与令牌基准） */
  declarations: FeatureDeclarations;
}

/** 命名样式集合 */
export interface NamedStyleSet {
  version: 1;
  styles: NamedStyle[];
}

/** 空命名样式集合 */
export function createEmptyNamedStyleSet(): NamedStyleSet {
  return { version: 1, styles: [] };
}

/** 按 id 查找命名样式 */
export function findNamedStyle(
  set: NamedStyleSet | undefined,
  id: string | null | undefined,
): NamedStyle | undefined {
  if (set === undefined || id === null || id === undefined) return undefined;
  return set.styles.find((style) => style.id === id);
}

/**
 * 生成命名样式 id
 *
 * 不依赖 crypto.randomUUID（Node 18 以下 / 非安全上下文可能缺失），
 * 用时间戳 + 随机后缀保证可读且足够唯一。
 */
export function createNamedStyleId(): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `ns-${Date.now().toString(36)}-${random}`;
}
