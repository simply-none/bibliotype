/**
 * EPUB 3 导航文档生成（nav.xhtml）
 *
 * 由「章节计划 + 锚点」产出的 NavItem 树渲染为嵌套 <ol>；
 * EPUB 3 阅读系统以 nav 文档为目录权威来源（NCX 不再需要）。
 */
import { escapeXml } from '@bibliotype/layout/html';
import type { NavItem } from './sections.js';
import { renderXhtmlDocument } from './xhtml.js';

/** 地标入口（EPUB 3 landmarks：目录 / 正文起点等） */
export interface NavLandmark {
  /** EPUB 结构语义类型（如 `toc` / `bodymatter`） */
  type: string;
  /** 目标位置（相对 OEBPS 的文件路径，可带锚点） */
  href: string;
  /** 展示名 */
  title: string;
}

/** 导航文档生成输入 */
export interface NavXhtmlInput {
  /** 导航标题（如「目录」） */
  title: string;
  /** 语言标记（BCP 47） */
  language: string;
  items: readonly NavItem[];
  /** 文档壳风格（与内容文档一致：'xhtml5' EPUB 3 缺省 / 'xhtml11' EPUB 2） */
  flavor?: 'xhtml5' | 'xhtml11';
  /**
   * 地标（`nav epub:type="landmarks"`，缺省不输出）
   *
   * 第三方阅读器的「跳到正文」/「回目录」入口靠它，Catalog / 京东读书等
   * 在缺 landmarks 时只能退化成按 spine 首项猜。
   */
  landmarks?: readonly NavLandmark[];
}

/** 生成 nav.xhtml（EPUB 3 目录文档） */
export function buildNavXhtml(input: NavXhtmlInput): string {
  const body = `<nav epub:type="toc" id="bt-toc">
<h1>${escapeXml(input.title)}</h1>
${renderList(input.items)}
</nav>
${renderLandmarks(input.landmarks ?? [])}`;
  return renderXhtmlDocument({
    title: input.title,
    language: input.language,
    body,
    cssHref: 'style.css',
    flavor: input.flavor,
  });
}

/** 渲染地标导航（空列表输出空串） */
function renderLandmarks(landmarks: readonly NavLandmark[]): string {
  if (landmarks.length === 0) return '';
  const items = landmarks
    .map(
      (landmark) =>
        `<li><a epub:type="${escapeXml(landmark.type)}" href="${escapeXml(landmark.href)}">${escapeXml(landmark.title)}</a></li>`,
    )
    .join('\n');
  /* XHTML 是 XML：布尔属性必须带值（裸 hidden 会让整份 nav 变非良构 XML，校验器直接报 XML-01） */
  return `<nav epub:type="landmarks" id="bt-landmarks" hidden="hidden">
<ol>
${items}
</ol>
</nav>`;
}

/** 渲染嵌套列表（空列表输出空 <ol>） */
function renderList(items: readonly NavItem[]): string {
  if (items.length === 0) return '<ol></ol>';
  return `<ol>\n${items.map(renderItem).join('\n')}\n</ol>`;
}

/** 渲染单条目（有子项时嵌套一层 <ol>） */
function renderItem(item: NavItem): string {
  const children = item.children.length > 0 ? `\n${renderList(item.children)}` : '';
  return `<li><a href="${escapeXml(item.href)}">${escapeXml(item.label)}</a>${children}</li>`;
}
