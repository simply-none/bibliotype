/**
 * 图片打印检查（像素尺寸嗅探 + 超限 / 低 DPI 告警）
 *
 * 浏览器打印管线只按 CSS 像素摆放图片（96dpi 口径）：版心宽 447px 的 A5 页
 * 放一张 1000px 宽的图，会等比缩到 447px 打印——成品上「每英寸墨点数」只有
 * 215dpi，印出来发虚；而一张 120px 的小图按原尺寸打印，实际只有 96dpi。
 * PDF 导出前必须能把这些数说清楚，否则用户要到打样才发现问题。
 *
 * 本模块只做纯函数（不碰 DOM）：
 * - 从文件头嗅探 PNG / JPEG / GIF / BMP 的真实像素尺寸（不信 MIME；
 *   SVG / WebP 等矢量或新格式不适配，按「无法测量」回传）；
 * - 按版心尺寸算出「实际打印尺寸」与有效 DPI；
 * - 超出版心（等比缩小，不裁切）、低于 DPI 阈值、无法测量 三类条目
 *   供导出前展示（不阻断导出，与 K6 缺字报告同一口径）。
 */
import {
  DEFAULT_THEME,
  NODE_TYPES,
  type BookDocument,
  type BookNode,
} from '@bibliotype/core';
import {
  DEFAULT_LAYOUT_OPTIONS,
  resolveContentBox,
  resolvePageMarginBox,
  type LayoutOptions,
} from '@bibliotype/layout';

/** 支持嗅探的位图格式 */
export type PrintImageFormat = 'png' | 'jpg' | 'gif' | 'bmp';

/** 位图像素尺寸（按文件头嗅探） */
export interface ImagePixelSize {
  /** 实际格式（魔术字节判定） */
  format: PrintImageFormat;
  /** 像素宽 */
  width: number;
  /** 像素高 */
  height: number;
}

/** 图片检查条目码 */
export type PrintImageIssueCode = 'IMAGE-OVERSIZE' | 'IMAGE-LOW-DPI' | 'IMAGE-UNMEASURED';

/** 图片检查条目（导出前展示用；不阻断导出） */
export interface PrintImageIssue {
  code: PrintImageIssueCode;
  /** 严重度：超限缩放轻微为 info，低 DPI / 无法校验为 warning */
  severity: 'info' | 'warning';
  /** 中文说明（含像素、打印尺寸、DPI） */
  message: string;
  /** 相关节点 id（有则带） */
  nodeId?: string;
  /** 节点树路径（`0.1.2`，定位用） */
  path: string;
}

/** 图片检查选项 */
export interface PdfImageCheckOptions {
  /** 布局选项（缺省 DEFAULT_LAYOUT_OPTIONS：决定版心尺寸） */
  layout?: LayoutOptions;
  /** 主题令牌表（缺省 DEFAULT_THEME：page-margin 决定版心尺寸） */
  tokens?: Readonly<Record<string, string | undefined>>;
  /** 版心宽（px，覆盖 layout 推导值；与打印样式同源时传同一口径） */
  contentWidthPx?: number;
  /** 版心高（px，覆盖 layout 推导值） */
  contentHeightPx?: number;
  /** 低 DPI 阈值（缺省 300：常规胶印彩图要求） */
  minDpi?: number;
  /** 是否报告无法测量的图片（缺省 true；外链 / SVG 等） */
  reportUnmeasured?: boolean;
}

/** data URI（`data:<mime>[;base64],<payload>`） */
const DATA_URI_RE = /^data:([^,]*),([\s\S]*)$/;

/** 超大图像素总量阈值（≈40MP）：再大打印引擎解码会明显拖慢 */
const HUGE_IMAGE_AREA = 40_000_000;

/**
 * 嗅探位图像素尺寸
 *
 * @returns 尺寸与格式；非 PNG / JPEG / GIF / BMP 或头部损坏返回 undefined
 */
export function readImagePixelSize(bytes: Uint8Array): ImagePixelSize | undefined {
  const format = sniffFormat(bytes);
  if (format === undefined) return undefined;
  const size = readSize(bytes, format);
  return size === undefined ? undefined : { format, width: size.width, height: size.height };
}

/** 魔术字节判格式 */
function sniffFormat(bytes: Uint8Array): PrintImageFormat | undefined {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpg';
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return 'gif';
  }
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return 'bmp';
  }
  return undefined;
}

/** 按格式读头（GIF / BMP / PNG 定长，JPEG 扫 SOF 段） */
function readSize(
  bytes: Uint8Array,
  format: PrintImageFormat,
): { width: number; height: number } | undefined {
  switch (format) {
    case 'png': {
      /* PNG：8 字节签名 + 4 长度 + 4 'IHDR'，宽高各 4 字节大端 */
      if (bytes.length < 24) return undefined;
      const width = readU32be(bytes, 16);
      const height = readU32be(bytes, 20);
      return width > 0 && height > 0 ? { width, height } : undefined;
    }
    case 'gif': {
      /* GIF：逻辑屏幕宽高各 2 字节小端 */
      if (bytes.length < 10) return undefined;
      const width = bytes[6]! + (bytes[7]! << 8);
      const height = bytes[8]! + (bytes[9]! << 8);
      return width > 0 && height > 0 ? { width, height } : undefined;
    }
    case 'bmp': {
      /* BMP：DIB 头 18 / 22 处宽高各 4 字节小端（高可为负：自上而下） */
      if (bytes.length < 26) return undefined;
      const width = Math.abs(readI32le(bytes, 18));
      const height = Math.abs(readI32le(bytes, 22));
      return width > 0 && height > 0 ? { width, height } : undefined;
    }
    case 'jpg':
      return jpegSize(bytes);
    default:
      return undefined;
  }
}

/** JPEG：跳过段头找 SOF0/1/2（含 4 个 SOF 变体外的 DHT/JPG/DAC 排除） */
function jpegSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1]!;
    /* 无长度的独立标记（SOI / EOI / RSTn / TEM） */
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    /* 填充字节 0xFF 自身 */
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    const length = (bytes[offset + 2]! << 8) + bytes[offset + 3]!;
    if (length < 2) return undefined;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      const height = (bytes[offset + 5]! << 8) + bytes[offset + 6]!;
      const width = (bytes[offset + 7]! << 8) + bytes[offset + 8]!;
      return width > 0 && height > 0 ? { width, height } : undefined;
    }
    offset += 2 + length;
  }
  return undefined;
}

function readU32be(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! * 0x1000000 +
    (bytes[offset + 1]! << 16) +
    (bytes[offset + 2]! << 8) +
    bytes[offset + 3]!
  );
}

function readI32le(bytes: Uint8Array, offset: number): number {
  const value =
    bytes[offset]! +
    (bytes[offset + 1]! << 8) +
    (bytes[offset + 2]! << 16) +
    bytes[offset + 3]! * 0x1000000;
  return value >= 0x80000000 ? value - 0x100000000 : value;
}

/**
 * 解码 base64 data URI 为字节
 *
 * @returns 非 data URI / 非 base64 / 解码失败返回 undefined
 */
export function decodeImageDataUri(src: string): Uint8Array | undefined {
  const match = DATA_URI_RE.exec(src.trim());
  if (match === null) return undefined;
  const meta = match[1] ?? '';
  if (!/;\s*base64\s*$/i.test(meta) && !/;\s*base64;/i.test(`${meta};`)) return undefined;
  const payload = (match[2] ?? '').replace(/\s+/g, '');
  if (payload === '') return undefined;
  try {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return undefined;
  }
}

/**
 * 收集 PDF 导出前的图片检查条目（文档顺序）
 *
 * 打印尺寸口径与 `buildPrintCss({ imageRules: true })` 一致：图片按
 * `max-width: 100%` / `max-height: 版心高` 等比缩小、不裁切、不放大；
 * 有效 DPI = 原始像素宽 ÷（打印宽 / 96）。
 */
export function collectPdfImageProblems(
  document: BookDocument,
  options: PdfImageCheckOptions = {},
): PrintImageIssue[] {
  const minDpi = options.minDpi ?? 300;
  const reportUnmeasured = options.reportUnmeasured ?? true;
  const content =
    options.contentWidthPx !== undefined && options.contentHeightPx !== undefined
      ? { width: options.contentWidthPx, height: options.contentHeightPx }
      : resolveContentSize(options);

  const issues: PrintImageIssue[] = [];
  const walk = (node: BookNode, path: string): void => {
    if (node.type === NODE_TYPES.IMAGE) {
      issues.push(...checkImage(node, path, content, minDpi, reportUnmeasured));
    }
    const children = node.children ?? [];
    for (let index = 0; index < children.length; index += 1) {
      walk(children[index]!, path === '' ? String(index) : `${path}.${index}`);
    }
  };
  if (document.root !== undefined) walk(document.root, '');
  return issues;
}

/** 版心尺寸（px）：layout + 令牌推导；越界时回退页面尺寸（不阻断检查） */
function resolveContentSize(options: PdfImageCheckOptions): { width: number; height: number } {
  const layout = options.layout ?? DEFAULT_LAYOUT_OPTIONS;
  const tokens = options.tokens ?? DEFAULT_THEME;
  try {
    return resolveContentBox(layout.pageSize, resolvePageMarginBox(tokens));
  } catch {
    return { width: layout.pageSize.width, height: layout.pageSize.height };
  }
}

/** 单张图片检查（同一张图可能同时命中「超限缩放」与「低 DPI」） */
function checkImage(
  node: BookNode,
  path: string,
  content: { width: number; height: number },
  minDpi: number,
  reportUnmeasured: boolean,
): PrintImageIssue[] {
  const nodeId = node.id === undefined ? {} : { nodeId: node.id };
  const src = typeof node.attrs?.['src'] === 'string' ? node.attrs.src : '';
  if (src.trim() === '') {
    return reportUnmeasured ? [unmeasured(nodeId, path, '缺少 src，DPI 未校验')] : [];
  }
  if (!src.trim().startsWith('data:')) {
    return reportUnmeasured
      ? [
          unmeasured(
            nodeId,
            path,
            '非 data URI（外链 / 相对路径），宿主取回字节后才能校验，DPI 未校验',
          ),
        ]
      : [];
  }
  const bytes = decodeImageDataUri(src);
  if (bytes === undefined) {
    return reportUnmeasured
      ? [unmeasured(nodeId, path, 'data URI 非 base64 或无法解码，DPI 未校验')]
      : [];
  }
  const size = readImagePixelSize(bytes);
  if (size === undefined) {
    return reportUnmeasured
      ? [unmeasured(nodeId, path, '非 PNG / JPEG / GIF / BMP 或文件头损坏，像素尺寸未知')]
      : [];
  }

  const { width, height } = size;
  /* 与 imageRules 同源：缩到版心内、不放大 */
  const scale = Math.min(1, content.width / width, content.height / height);
  const printWidth = Math.max(1, Math.round(width * scale));
  const printHeight = Math.max(1, Math.round(height * scale));
  /* 有效 DPI：原始像素宽 ÷ 打印宽（英寸，96dpi 口径） */
  const dpi = Math.round((width * 96) / printWidth);
  const sizeText = `${width}×${height}px`;
  const printText = `${printWidth}×${printHeight}px`;
  const issues: PrintImageIssue[] = [];

  if (scale < 1) {
    /*
     * 缩到版心内本身是好事（DPI 反而升高），常规只作 info；只有像素总量
     * 过大（解码慢 / 内存压力）才升为 warning。
     */
    const huge = width * height > HUGE_IMAGE_AREA;
    issues.push({
      code: 'IMAGE-OVERSIZE',
      severity: huge ? 'warning' : 'info',
      message: huge
        ? `图片 ${sizeText} 超出可用版面 ${content.width}×${content.height}px，导出时等比缩至 ${printText}（不裁切）；像素总量过大，打印引擎解码慢，建议先降采样`
        : `图片 ${sizeText} 超出可用版面 ${content.width}×${content.height}px，导出时等比缩至 ${printText}（不裁切）；有效 ${dpi} DPI`,
      ...nodeId,
      path,
    });
  }

  if (dpi < minDpi) {
    /* 阈值 DPI 下的最大成品尺寸（mm）：印刷厂据此判断是否可用 */
    const maxWidthMm = Math.round((width * 25.4) / minDpi);
    const maxHeightMm = Math.round((height * 25.4) / minDpi);
    issues.push({
      code: 'IMAGE-LOW-DPI',
      severity: 'warning',
      message: `图片 ${sizeText} 按 ${printText} 打印仅 ${dpi} DPI（低于 ${minDpi}）；印前请换更高分辨率图，或把成品控制在 ${maxWidthMm}×${maxHeightMm}mm 内`,
      ...nodeId,
      path,
    });
  }
  return issues;
}

/** 无法测量条目 */
function unmeasured(
  nodeId: { nodeId?: string },
  path: string,
  reason: string,
): PrintImageIssue {
  return { code: 'IMAGE-UNMEASURED', severity: 'warning', message: `图片${reason}`, ...nodeId, path };
}

/**
 * 单行中文摘要（导出前 toast / 日志）
 *
 * @example
 * summarizePdfImageProblems(issues);
 * // '图片检查 3 条：低 DPI 2 张；超出版面 1 张'
 */
export function summarizePdfImageProblems(issues: readonly PrintImageIssue[]): string {
  if (issues.length === 0) return '图片检查通过：无超限 / 低 DPI 项';
  const count = (code: PrintImageIssueCode): number =>
    issues.filter((issue) => issue.code === code).length;
  const parts: string[] = [];
  const low = count('IMAGE-LOW-DPI');
  if (low > 0) parts.push(`低 DPI ${low} 张`);
  const oversize = count('IMAGE-OVERSIZE');
  if (oversize > 0) parts.push(`超出版面 ${oversize} 张`);
  const unmeasured = count('IMAGE-UNMEASURED');
  if (unmeasured > 0) parts.push(`无法校验 ${unmeasured} 张`);
  return `图片检查 ${issues.length} 条：${parts.join('；')}`;
}
