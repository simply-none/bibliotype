/**
 * 内容文档跨文件链接改写
 *
 * EPUB 的内容文档统一位于 `OEBPS/text/`（sections 规划与体积拆分共同保证），
 * 而序列化器输出的正文注码（`noteref`）与注文回链（`backref`）都是局部
 * `#锚点`——尾注聚合（groupEndnotes）把注文移到别的文件后，局部锚点必然
 * 落空；索引附录 / 调用方附录里指向正文的局部锚点同理。
 *
 * 本模块在序列化产物上按「锚点 → 所在文件」映射做一遍改写：锚点位于
 * 其它内容文档时，href 重写为同目录相对地址（如 `sec-2.xhtml#en-1`）；
 * 本文件锚点与未命中的地址原样保留。改写放在**拆分之后**：体积兜底拆分
 * （splitSections）可能丢弃空节并重排文件序号，先于拆分建立的映射会过期。
 */
import { MARK_TYPES, isTextNode, type BookNode } from '@bibliotype/core';

/** 锚点 → 所在内容文档（OEBPS 内相对路径，如 `text/sec-2.xhtml`） */
export type AnchorFileMap = ReadonlyMap<string, string>;

/** 参与规划的节（与 sections 的 SectionPlan 结构同形，避免循环依赖） */
interface PlannedFile {
  /** OEBPS 内相对路径 */
  file: string;
  /** 该文件承载的节点 */
  nodes: readonly BookNode[];
}

/**
 * 建立「锚点 → 所在文件」映射
 *
 * 遍历拆分后每份内容文档的节点树，登记三类锚点：
 * - 节点自带 id（注文块、结构节点、段段落等）；
 * - 自动锚点（plan.anchors 给无 id 结构节点分配的 `bt-a-N`）；
 * - 注码锚点（`noteref` 标记的 `refId`——它只存在于标记属性上，序列化时
 *   落为 `<a id="refId">`，是注文回链的落点，必须按所在文件登记）。
 *
 * 同名锚点以先出现者为准（文档序确定）。
 */
export function buildAnchorFileMap(
  sections: readonly PlannedFile[],
  anchors: ReadonlyMap<BookNode, string>,
): AnchorFileMap {
  const map = new Map<string, string>();
  const visit = (node: BookNode, file: string): void => {
    if (typeof node.id === 'string' && node.id !== '') map.set(node.id, file);
    const anchor = anchors.get(node);
    if (anchor !== undefined && !map.has(anchor)) map.set(anchor, file);
    if (isTextNode(node)) {
      for (const mark of node.marks ?? []) {
        if (mark.type !== MARK_TYPES.NOTE_REF) continue;
        const refId = mark.attrs?.['refId'];
        if (typeof refId === 'string' && refId !== '' && !map.has(refId)) {
          map.set(refId, file);
        }
      }
    }
    for (const child of node.children ?? []) visit(child, file);
  };
  for (const section of sections) {
    for (const node of section.nodes) visit(node, section.file);
  }
  return map;
}

/** 目录部分（含结尾斜杠；无目录返回空串） */
function dirOf(file: string): string {
  const cut = file.lastIndexOf('/');
  return cut === -1 ? '' : file.slice(0, cut + 1);
}

/**
 * 内容文档 A → 内容文档 B 的相对地址
 *
 * 规划保证全部内容文档同在 `text/` 一层，命中同目录时退化为文件名
 * （`sec-2.xhtml`）；不同目录时按公共前缀折算 `../` 回退（防御性分支）。
 */
export function relativeContentHref(fromFile: string, toFile: string): string {
  const fromDir = dirOf(fromFile);
  if (fromDir === dirOf(toFile)) return toFile.slice(toFile.lastIndexOf('/') + 1);
  const fromParts = fromDir.split('/').filter((part) => part !== '');
  const toParts = toFile.split('/');
  let common = 0;
  while (
    common < fromParts.length &&
    common < toParts.length - 1 &&
    fromParts[common] === toParts[common]
  ) {
    common += 1;
  }
  const ups = fromParts.length - common;
  return `${'../'.repeat(ups)}${toParts.slice(common).join('/')}`;
}

/** 序列化产物中的局部锚点 href（引号内为 XML 转义后的 id） */
const LOCAL_HREF = /href="#([^"]*)"/g;

/** XML 属性转义的反解（escapeXml 的逆；只用于锚点 id 比对） */
function unescapeXmlId(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * 改写序列化产物中的局部锚点为跨文件相对地址
 *
 * 只处理 `href="#锚点"` 形态（注码 / 回链 / 局部链接）：锚点登记在其它
 * 内容文档时重写为相对地址；本文件锚点、未命中映射、跨文件与外链地址
 * 均原样保留。
 */
export function rewriteLocalAnchors(
  html: string,
  currentFile: string,
  anchorFiles: AnchorFileMap,
): string {
  return html.replace(LOCAL_HREF, (match, escapedId: string) => {
    const file = anchorFiles.get(unescapeXmlId(escapedId));
    if (file === undefined || file === currentFile) return match;
    return `href="${relativeContentHref(currentFile, file)}#${escapedId}"`;
  });
}
