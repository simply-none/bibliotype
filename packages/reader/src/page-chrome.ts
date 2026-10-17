/**
 * 页眉 / 页脚文本解析
 *
 * 与 `pageChrome` 布局选项配套：布局侧只关心「占位尺寸」（`resolvePageMainSize`
 * 扣减版心），本模块负责「内容」——把字段（书名 / 章名 / 页码）解析为当前页
 * 应显示的文字，供阅读视图、编辑画布、打印稿三端按页注入。
 *
 * 约定：
 * - 每页以页首块为锚点取章名（最近一层卷 / 章 / 节 / 标题祖先）；
 * - `mirror` 开启时偶数展示页（第 2、4、6… 页）取 `headerEven` / `footerEven`，
 *   缺省回落到奇数页配置；
 * - 未启用（`header` 与 `footer` 皆为 `none`）时调用方应走「无页眉页脚」的老路径，
 *   行为与加页眉页脚之前完全一致。
 */
import { NODE_TYPES, isTextNode, type BookNode } from '@bibliotype/core';
import type { PageChromeField, PageChromeOptions } from '@bibliotype/layout';
import { findNodeTrail } from './find-node.js';
import { resolveNodeTitle } from './outline.js';

/** 参与章名判定的节点类型（就近取最内层：标题优先于所属章） */
const CHAPTER_LIKE_TYPES: ReadonlySet<string> = new Set([
  NODE_TYPES.VOLUME,
  NODE_TYPES.CHAPTER,
  NODE_TYPES.SECTION,
  NODE_TYPES.HEADING,
]);

/** 不显示 */
const FIELD_NONE = 'none';

/** 页眉 / 页脚文本 */
export interface PageChromeTexts {
  /** 页眉文本（空串 = 不显示） */
  header: string;
  /** 页脚文本（空串 = 不显示） */
  footer: string;
}

/** 该页实际生效的字段（已按 mirror 解析奇偶页） */
export interface ResolvedPageChromeFields {
  header: PageChromeField;
  footer: PageChromeField;
}

/** 是否启用页眉 / 页脚（任一侧有内容） */
export function isPageChromeEnabled(chrome: PageChromeOptions | undefined): boolean {
  if (chrome === undefined) return false;
  return chrome.header !== FIELD_NONE || chrome.footer !== FIELD_NONE;
}

/**
 * 解析该页生效的字段
 *
 * @param pageIndex 0 基页序（第 1 页 = `pageIndex 0`，属奇数展示页）
 */
export function resolvePageChromeFields(
  chrome: PageChromeOptions,
  pageIndex: number,
): ResolvedPageChromeFields {
  const even = (pageIndex + 1) % 2 === 0;
  if (chrome.mirror !== true || !even) {
    return { header: chrome.header, footer: chrome.footer };
  }
  return {
    header: chrome.headerEven ?? chrome.header,
    footer: chrome.footerEven ?? chrome.footer,
  };
}

/** 页眉 / 页脚文本解析输入 */
export interface ResolvePageChromeInput {
  /** 布局中的页眉页脚配置 */
  chrome: PageChromeOptions;
  /** 0 基页序 */
  pageIndex: number;
  /** 书名（`bookTitle` 字段） */
  bookTitle: string;
  /** 该页章名（`chapterTitle` 字段；缺省空串） */
  chapterTitle: string;
  /** 已格式化的页码（`pageNumber` 字段，含中文 / 罗马数字样式） */
  pageNumberText: string;
}

/** 单字段 → 文本 */
function fieldText(
  field: PageChromeField,
  input: ResolvePageChromeInput,
): string {
  switch (field) {
    case 'bookTitle':
      return input.bookTitle;
    case 'chapterTitle':
      return input.chapterTitle;
    case 'pageNumber':
      return input.pageNumberText;
    default:
      return '';
  }
}

/**
 * 解析该页页眉 / 页脚文本
 *
 * 空串表示该侧不渲染（字段为 `none` 或对应内容缺失，如无章名的前言页）。
 */
export function resolvePageChromeTexts(input: ResolvePageChromeInput): PageChromeTexts {
  const fields = resolvePageChromeFields(input.chrome, input.pageIndex);
  return {
    header: fieldText(fields.header, input).trim(),
    footer: fieldText(fields.footer, input).trim(),
  };
}

/**
 * 取某节点最近的「章名」祖先标题（含自身）
 *
 * 从最内层向外找第一个有标题的卷 / 章 / 节 / 标题节点：
 * 导入型扁平书（无结构节点）靠 heading 提供章名，demo 型靠 chapter 的 title。
 * 无命中返回空串（页眉该字段留空）。
 */
export function resolveChapterTitleForNode(root: BookNode, id: string): string {
  const trail = findNodeTrail(root, id);
  for (let i = trail.length - 1; i >= 0; i -= 1) {
    const node = trail[i];
    if (node === undefined || !CHAPTER_LIKE_TYPES.has(node.type)) continue;
    const title = resolveNodeTitle(node).trim();
    if (title !== '') return title;
  }
  return '';
}

/**
 * 该节点是否位于封面子树内
 *
 * 封面页按书籍惯例不标页码 / 页眉页脚（与 BtBookView 的既有判定同义，
 * 这里收敛到 reader 侧，供阅读 / 编辑 / 导出三端复用）。
 */
export function isNodeInCover(root: BookNode, id: string): boolean {
  const trail = findNodeTrail(root, id);
  return trail.some((node) => node.type === NODE_TYPES.COVER);
}

/**
 * 逐页页眉页脚所需的「块 id 索引」（一次遍历产出两份表）
 *
 * 编辑画布逐页取页眉章名 / 判断封面，若每页各自回溯文档树会退化成
 * O(页数 × N)；这里一次 DFS 建好索引，逐页只做 Map/Set 命中。
 */
export interface PageChromeIndex {
  /** 块 id → 最近的卷 / 章 / 节 / 标题祖先标题（无命中为空串） */
  chapterTitles: Map<string, string>;
  /** 位于封面子树内的块 id 集合（封面不标页码 / 页眉页脚） */
  coverBlocks: Set<string>;
}

/**
 * 构建页眉页脚索引
 *
 * 键与 `extractBlocks` 的块 id 口径完全一致：节点有 id 用 id，否则用树路径
 * （`/0/1`，逐层按元素子节点索引）。
 */
export function buildPageChromeIndex(root: BookNode): PageChromeIndex {
  const chapterTitles = new Map<string, string>();
  const coverBlocks = new Set<string>();
  const walk = (node: BookNode, path: string, inherited: string, inCover: boolean): void => {
    const cover = inCover || node.type === NODE_TYPES.COVER;
    let current = inherited;
    if (CHAPTER_LIKE_TYPES.has(node.type)) {
      const title = resolveNodeTitle(node).trim();
      if (title !== '') current = title;
    }
    const id = node.id ?? path;
    chapterTitles.set(id, current);
    if (cover) coverBlocks.add(id);
    const children = (node.children ?? []).filter((child) => !isTextNode(child));
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i];
      if (child !== undefined) walk(child, `${path}/${i}`, current, cover);
    }
  };
  walk(root, '', '', false);
  return { chapterTitles, coverBlocks };
}
