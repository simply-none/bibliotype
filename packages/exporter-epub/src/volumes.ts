/**
 * 按卷导出 EPUB
 *
 * 含多个 `volume` 顶层节点的文档一次导出多个 EPUB：每卷独立成书（自己的
 * OPF / nav / ncx / spine），目录只含本卷章节。无卷文档退化为单本，产物与
 * `exportEpub` 完全一致。
 *
 * 切分规则：
 * - 每个 `volume` 节点起一卷，卷的区间延续到下一个 `volume` 之前（卷后
 *   散落的顶层章节归入该卷，避免内容丢失）；
 * - 首个 `volume` 之前的顶层节点（封面 / 书名页 / 版权页 / 前言等）只随
 *   **首卷**导出，避免多卷重复封面；
 * - 卷名取 `volume` 标题，缺省「卷 N」；书名取「原书名·卷名」。
 *
 * 标识符派生是确定性的：以基础标识符 + 卷序号散列成 `urn:bibliotype:<hash>`，
 * 不使用时间戳 / 随机数（既有导出红线）。单卷（无 volume 节点）保留原标识符。
 */
import { NODE_TYPES, type BookDocument, type BookNode } from '@bibliotype/core';
import { resolveNodeTitle } from '@bibliotype/reader';
import { exportEpub, type EpubExportOptions } from './epub.js';
import { buildDefaultIdentifier, fnv1a, normalizeIdentifier, resolveIdentifier } from './identifier.js';

/** 分卷导出产物 */
export interface EpubVolumeOutput {
  /** 建议文件名（已清洗路径分隔符，含 `.epub` 后缀） */
  name: string;
  /** 卷序号（自 0 起；无卷文档为 0） */
  index: number;
  /** 完整 EPUB 字节（含 zip 容器） */
  bytes: Uint8Array;
}

/** 基础标识符（与 exportEpub 的缺省解析顺序一致） */
function baseIdentifierOf(document: BookDocument, options: EpubExportOptions): string {
  return normalizeIdentifier(
    options.identifier ?? resolveIdentifier(document.metadata) ?? buildDefaultIdentifier(document),
  );
}

/** 卷标识符：确定性散列，避免多卷共用同一 dc:identifier */
function volumeIdentifier(base: string, index: number, total: number): string {
  if (total <= 1) return base;
  return `urn:bibliotype:${fnv1a(`${base}|volume|${index + 1}`)}`;
}

/** 文件名清洗（去掉路径分隔符与常见非法字符） */
function safeFileName(value: string, fallback: string): string {
  const cleaned = value.replace(/[\\/:*?"<>|\r\n\t]/g, '_').trim();
  return `${cleaned === '' ? fallback : cleaned}.epub`;
}

/** 卷标题（无标题时回退「卷 N」） */
function volumeTitleOf(node: BookNode | undefined, index: number): string {
  if (node === undefined) return `卷 ${index + 1}`;
  const title = resolveNodeTitle(node);
  return title.trim() === '' ? `卷 ${index + 1}` : title;
}

/**
 * 按卷导出 EPUB
 *
 * @param document 书籍文档
 * @param options  与 `exportEpub` 相同的导出选项（`identifier` / `modified`
 *                 会作为各卷的派生基准）
 * @returns 每卷一个产物；无 `volume` 节点时返回单卷，等价 `exportEpub`
 */
export function exportEpubVolumes(
  document: BookDocument,
  options: EpubExportOptions = {},
): EpubVolumeOutput[] {
  const children = document.root.children ?? [];
  const volumeIndexes: number[] = [];
  children.forEach((node, index) => {
    if (node.type === NODE_TYPES.VOLUME) volumeIndexes.push(index);
  });

  const base = baseIdentifierOf(document, options);
  /* 一次导出内共享同一 modified：避免各卷因 new Date() 抖动而不可复现 */
  const sharedModified =
    options.modified ??
    document.metadata.updatedAt ??
    document.metadata.createdAt ??
    new Date().toISOString();

  if (volumeIndexes.length === 0) {
    return [
      {
        name: safeFileName(document.metadata.title, 'book'),
        index: 0,
        bytes: exportEpub(document, { ...options, modified: sharedModified }),
      },
    ];
  }

  /* 首个 volume 之前的顶层节点（封面 / 前置页）只随首卷导出 */
  const preamble = children.slice(0, volumeIndexes[0]);

  const outputs: EpubVolumeOutput[] = [];
  volumeIndexes.forEach((start, order) => {
    const end = order + 1 < volumeIndexes.length ? (volumeIndexes[order + 1] as number) : children.length;
    const slice = children.slice(start, end);
    const group = order === 0 && preamble.length > 0 ? [...preamble, ...slice] : slice;
    const volumeNode = children[start];
    const volumeTitle = volumeTitleOf(volumeNode, order);
    const title =
      document.metadata.title.trim() === ''
        ? volumeTitle
        : `${document.metadata.title}·${volumeTitle}`;

    const volumeDocument: BookDocument = {
      ...document,
      metadata: { ...document.metadata, title },
      root: { ...document.root, children: group },
    };

    outputs.push({
      name: safeFileName(`${order + 1}-${volumeTitle}`, `volume-${order + 1}`),
      index: order,
      bytes: exportEpub(volumeDocument, {
        ...options,
        identifier: volumeIdentifier(base, order, volumeIndexes.length),
        modified: sharedModified,
      }),
    });
  });

  return outputs;
}
