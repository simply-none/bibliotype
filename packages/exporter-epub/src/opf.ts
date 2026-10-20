/**
 * OPF 包文档生成（EPUB 2 / EPUB 3）
 *
 * 输出 content.opf：package / metadata（DC 元数据 + dcterms:modified）/
 * manifest / spine。所有值经 XML 转义。
 *
 * 版本差异（默认导出 EPUB 3，显式传 version: '2.0' 走 RMSDK 兼容路径）：
 * - EPUB 3：`<meta property="dcterms:modified">`、副标题 refines、封面走
 *   manifest item 的 `properties="cover-image"`、creator 带 `opf:role`；
 * - EPUB 2：仅 `dc:date`、封面走 `<meta name="cover">`，不输出任何 EPUB 3
 *   专属 `<meta property>`（RMSDK 解析器不识别 property 属性）。
 */
import type { BookMetadata, Contributor } from '@bibliotype/core';
import { escapeXml } from '@bibliotype/layout/html';

/** manifest 条目 */
export interface OpfManifestItem {
  id: string;
  href: string;
  mediaType: string;
  /** EPUB 属性（如 nav 文档的 "nav"） */
  properties?: string;
}

/** OPF 生成输入 */
export interface OpfInput {
  /** 唯一标识符（dc:identifier） */
  identifier: string;
  metadata: BookMetadata;
  /** 语言标记（BCP 47） */
  language: string;
  /** dcterms:modified（ISO 8601；内部会规范化到 CCYY-MM-DDThh:mm:ssZ） */
  modified: string;
  manifest: readonly OpfManifestItem[];
  /** spine 顺序（manifest item id） */
  spine: readonly string[];
  /** OPF package 版本（缺省 "3.0"；京东读书等 RMSDK 显式传 "2.0"） */
  version?: string;
  /** 兼容 EPUB 2 的 NCX 条目 id；提供时 spine 挂 toc="ncxId" 以启用 toc.ncx */
  ncxId?: string;
  /** EPUB 2 封面 manifest item id（输出 `<meta name="cover">`；EPUB 3 用 manifest properties） */
  coverItemId?: string;
  /**
   * 翻页方向（缺省 `'ltr'`，不输出属性）
   *
   * 直排书（`writing-mode: vertical-rl`）在阅读器里必须从右往左翻，
   * 否则双页视图 / 滑动方向与世界阅读习惯相反；`'rtl'` 时输出
   * `<spine page-progression-direction="rtl">`。
   */
  pageProgressionDirection?: 'ltr' | 'rtl';
  /** EPUB 2 `<guide>` 结构导航（EPUB 3 阅读器忽略，向后兼容用） */
  guide?: readonly OpfGuideReference[];
}

/** `<guide>` 条目（EPUB 2 结构导航） */
export interface OpfGuideReference {
  /** 引用类型：`toc` / `text` / `cover` 等 */
  type: string;
  /** 相对 OPF 的路径 */
  href: string;
  /** 显示标题 */
  title?: string;
}

/**
 * 古籍责任者角色 → MARC relator code（EPUB 3 `opf:role`）
 *
 * 平台书目库（京东读书 / 微信读书入库）按 relator 归类责任者；
 * 古籍角色（撰 / 注 / 译 / 校 / 编）映射到最接近的通用 code，未知名退 aut。
 */
const CONTRIBUTOR_ROLE_CODES: Readonly<Record<string, string>> = {
  撰: 'aut',
  著: 'aut',
  作: 'aut',
  注: 'edt',
  注释: 'edt',
  译: 'trl',
  翻译: 'trl',
  译注: 'edt',
  校: 'edt',
  编: 'edt',
  辑: 'edt',
  点校: 'edt',
  整理: 'edt',
  绘: 'ill',
  书: 'aui',
};

/** 责任者角色 → MARC relator code（缺省 aut） */
export function contributorRoleCode(role: string | undefined): string {
  if (role === undefined || role === '') return 'aut';
  return CONTRIBUTOR_ROLE_CODES[role] ?? 'aut';
}

/**
 * 规范化 dcterms:modified 为 EPUB 3.3 要求的
 * `CCYY-MM-DDThh:mm:ssZ`（UTC、无小数秒、字面量 Z）。
 *
 * 输入可为任意 ISO 8601（含小数秒 / 时区偏移），统一换算到 UTC。
 * 无效值回退到当前 UTC 时间。该格式是 EPUB 硬性要求（epubcheck ERROR），
 * 否则严格阅读系统会拒绝加载或闪退。
 */
export function normalizeModified(iso: string): string {
  const time = Date.parse(iso);
  const date = Number.isNaN(time) ? new Date() : new Date(time);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}Z`
  );
}

/** 生成 OPF 包文档 */
export function buildOpf(input: OpfInput): string {
  const { metadata } = input;
  const lang = escapeXml(input.language);
  const modified = normalizeModified(input.modified);
  const version = input.version ?? '3.0';

  /* metadata：DC 元素 + 修改时间 */
  const epub3 = version === '3.0';
  const metaLines: string[] = [
    `    <dc:identifier id="pub-id">${escapeXml(input.identifier)}</dc:identifier>`,
    `    <dc:title id="bt-title">${escapeXml(metadata.title)}</dc:title>`,
  ];
  if (epub3 && metadata.subtitle !== undefined && metadata.subtitle !== '') {
    /* 副标题按 EPUB 3.3 推荐做法用 meta refines 关联主标题，
       避免写第二个 <dc:title>（epubcheck WARNING：同语言多标题）。
       该写法为 EPUB 3 专属，EPUB 2（RMSDK）解析器不认 property 属性，故仅 3.0 输出。 */
    metaLines.push(
      `    <meta refines="#bt-title" property="dcterms:title" xml:lang="${lang}">${escapeXml(
        metadata.subtitle,
      )}</meta>`,
    );
  }
  metaLines.push(`    <dc:language>${lang}</dc:language>`);
  for (const contributor of metadata.contributors ?? []) {
    /* EPUB 3 带 opf:role（MARC relator）供平台书目库归类；EPUB 2 不挂属性 */
    const role = epub3 ? ` opf:role="${contributorRoleCode(contributor.role)}"` : '';
    metaLines.push(`    <dc:creator${role}>${escapeXml(contributor.name)}</dc:creator>`);
  }
  const publisher = metadata.publication?.publisher;
  if (publisher !== undefined && publisher !== '') {
    metaLines.push(`    <dc:publisher>${escapeXml(publisher)}</dc:publisher>`);
  }
  /* 修改时间：EPUB 2（京东读书等 RMSDK）用 dc:date；EPUB 3 额外保留 dcterms:modified。
     RMSDK 的 OPF 解析器不识别 <meta property>，遇之可能解析失败导致整本书打不开，
     故 EPUB 2 路径仅输出 dc:date，dcterms:modified 只在 version=3.0 时输出。 */
  metaLines.push(`    <dc:date>${escapeXml(modified.slice(0, 10))}</dc:date>`);
  if (epub3) {
    metaLines.push(`    <meta property="dcterms:modified">${escapeXml(modified)}</meta>`);
  }
  /* 封面声明：EPUB 2 用 meta name="cover" 指向 manifest item；
     EPUB 3 封面挂在 manifest item 的 properties="cover-image"（调用方设置）。 */
  if (!epub3 && input.coverItemId !== undefined && input.coverItemId !== '') {
    metaLines.push(`    <meta name="cover" content="${escapeXml(input.coverItemId)}"/>`);
  }

  /* manifest */
  const manifestLines = input.manifest.map((item) => {
    const properties =
      item.properties !== undefined ? ` properties="${escapeXml(item.properties)}"` : '';
    return (
      `    <item id="${escapeXml(item.id)}" href="${escapeXml(item.href)}"` +
      ` media-type="${escapeXml(item.mediaType)}"${properties}/>`
    );
  });

  /* spine */
  const spineLines = input.spine.map((id) => `    <itemref idref="${escapeXml(id)}"/>`);

  /* 翻页方向：缺省 ltr 不输出属性（避免无谓改动既有产物），仅直排书输出 rtl */
  const progression =
    input.pageProgressionDirection === 'rtl'
      ? ' page-progression-direction="rtl"'
      : '';
  const spineTag =
    input.ncxId !== undefined
      ? `<spine toc="${escapeXml(input.ncxId)}"${progression}>`
      : `<spine${progression}>`;

  /* guide：EPUB 2 阅读器按 type 找目录 / 正文入口；EPUB 3 阅读器忽略 */
  const guideLines = (input.guide ?? []).map((ref) => {
    const title = ref.title !== undefined ? ` title="${escapeXml(ref.title)}"` : '';
    return `    <reference type="${escapeXml(ref.type)}" href="${escapeXml(ref.href)}"${title}/>`;
  });
  const guideBlock =
    guideLines.length === 0
      ? ''
      : `  <guide>\n${guideLines.join('\n')}\n  </guide>\n`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="${escapeXml(version)}" unique-identifier="pub-id" xml:lang="${lang}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
${metaLines.join('\n')}
  </metadata>
  <manifest>
${manifestLines.join('\n')}
  </manifest>
  ${spineTag}
${spineLines.join('\n')}
  </spine>
${guideBlock}</package>
`;
}
