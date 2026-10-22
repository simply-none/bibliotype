/**
 * 印前色彩提示（CMYK 转换与色域告警）
 *
 * 浏览器 / Chromium 打印管线的色彩链路是 sRGB → DeviceRGB，**不能直出
 * CMYK PDF**：无论 `@page` 怎么写，`printToPDF` 出来的都是 RGB 色彩空间。
 * 正式印刷必须在印前环节用 ICC 配置文件转 CMYK（Acrobat 预检、Ghostscript、
 * 印刷厂 RIP），转换时高饱和色（朱砂、石青、荧光绿）会超出 CMYK 色域。
 *
 * 本模块不碰色彩引擎，只把「导出前必须知道的事」整理成可展示的中文条目，
 * 与 K6 缺字报告 / 图片 DPI 报告同一口径（不阻断导出）。
 */
import { NODE_TYPES, type BookDocument, type BookNode } from '@bibliotype/core';

/** 印前色彩提示码 */
export type PrintColorAdviceCode =
  | 'PRINT-CMYK-UNSUPPORTED'
  | 'PRINT-ICC-MISSING'
  | 'PRINT-RGB-IMAGE';

/** 印前色彩提示条目 */
export interface PrintColorAdvice {
  code: PrintColorAdviceCode;
  /** 严重度：色彩空间不可直出为 warning，位图色域压缩为 info */
  severity: 'info' | 'warning';
  /** 中文说明（含处理建议） */
  message: string;
}

/** 印前色彩检查选项 */
export interface PrintColorCheckOptions {
  /**
   * 目标色彩空间（缺省 `'cmyk'`：印刷交付）
   *
   * `'rgb'` 表示仅数字校样 / 屏幕分发，不做 CMYK 提示（返回空数组）。
   */
  target?: 'cmyk' | 'rgb';
  /** 宿主是否已配置 ICC 输出配置文件（缺省 false：按未配置告警） */
  hasIccProfile?: boolean;
  /** 文档位图数量（缺省按 IR 扫描 `image` 节点；宿主已知时可直接给值） */
  rasterImageCount?: number;
}

/**
 * 收集印前色彩提示（导出前展示）
 *
 * @example
 * collectPrintColorAdvice(document, { hasIccProfile: false });
 * // [{ code: 'PRINT-CMYK-UNSUPPORTED', … }, { code: 'PRINT-ICC-MISSING', … }]
 */
export function collectPrintColorAdvice(
  document: BookDocument,
  options: PrintColorCheckOptions = {},
): PrintColorAdvice[] {
  if ((options.target ?? 'cmyk') === 'rgb') return [];

  const advice: PrintColorAdvice[] = [
    {
      code: 'PRINT-CMYK-UNSUPPORTED',
      severity: 'warning',
      message:
        '浏览器打印管线只输出 DeviceRGB（sRGB）PDF，不能直出 CMYK；印前需在下游（Acrobat / Ghostscript / 印刷厂 RIP）按输出条件转换，高饱和色可能超出 CMYK 色域而被压缩',
    },
  ];

  if (options.hasIccProfile !== true) {
    advice.push({
      code: 'PRINT-ICC-MISSING',
      severity: 'warning',
      message:
        '未提供 ICC 输出配置文件（如 ISO Coated v2 / Japan Color 2001 Coated）；转 CMYK 前请与印刷厂确认目标条件，避免总墨量超限与偏色',
    });
  }

  const images = options.rasterImageCount ?? countImages(document);
  if (images > 0) {
    advice.push({
      code: 'PRINT-RGB-IMAGE',
      severity: 'info',
      message: `文档含 ${images} 张位图（sRGB），转 CMYK 后高饱和与暗部会有色域压缩；关键图建议印前单独校色`,
    });
  }

  return advice;
}

/** 统计 IR 中的图片节点数（无 root 时为 0） */
function countImages(document: BookDocument): number {
  let count = 0;
  const walk = (node: BookNode): void => {
    if (node.type === NODE_TYPES.IMAGE) count += 1;
    for (const child of node.children ?? []) walk(child);
  };
  if (document.root !== undefined) walk(document.root);
  return count;
}

/**
 * 单行中文摘要（导出前 toast / 日志）
 *
 * @example
 * summarizePrintColorAdvice(advice);
 * // '印前色彩提示 2 条：RGB 不可直出 CMYK；未配置 ICC'
 */
export function summarizePrintColorAdvice(advice: readonly PrintColorAdvice[]): string {
  if (advice.length === 0) return '印前色彩检查通过：按 RGB 输出（非 CMYK 交付）';
  const labels: Record<PrintColorAdviceCode, string> = {
    'PRINT-CMYK-UNSUPPORTED': 'RGB 不可直出 CMYK',
    'PRINT-ICC-MISSING': '未配置 ICC',
    'PRINT-RGB-IMAGE': '位图需校色',
  };
  return `印前色彩提示 ${advice.length} 条：${advice.map((item) => labels[item.code]).join('；')}`;
}
