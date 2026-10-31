/**
 * 用字统计（E3）
 *
 * 遍历 IR 全部文本节点（含 ruby 注音、标题、题注、注文），统计字符集与频次，
 * 作为字体子集化的输入。标点与数字天然包含在文本中，不额外造集。
 *
 * IR 之外、但会印在版面上的字符（元数据、页眉页脚字段、页码）经
 * `extraSources` 由调用方拼好传入（本模块保持纯函数，不读文档外部结构）。
 */
import { isTextNode, type BookDocument, type BookNode } from '@bibliotype/core';
import type { CharUsage, ExtraCharSources } from './types.js';

/** 控制字符（保留 \t / \n / \r；其余不可见字符不进字体子集） */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** 统计一段文本的用字（控制字符不进字体子集） */
function collectTextChars(text: string, counts: Map<string, number>): void {
  const clean = text.replace(CONTROL_CHARS, '');
  if (clean === '') return;
  for (const char of clean) counts.set(char, (counts.get(char) ?? 0) + 1);
}

/** 逐节点收集文本（导出供测试与自定义遍历复用） */
export function collectNodeChars(node: BookNode, counts: Map<string, number>): void {
  if (isTextNode(node)) {
    collectTextChars(node.text ?? '', counts);
    return;
  }
  for (const child of node.children ?? []) collectNodeChars(child, counts);
}

/**
 * 页码样式 → 页码用字字符集
 *
 * 与 layout 的 `PAGE_NUMBER_STYLES` / reader 的 `formatPageNumber` 输出对齐
 * （fonts 不依赖 layout / reader，按键名字符串映射）：
 * - `decimal`：阿拉伯数字；
 * - `chinese`：中文数字（reader 输出「零」「十百千万」；「〇」为手写体补集）；
 * - `roman`：罗马数字（reader 缺省小写，大小写都收，防样式层转大写）；
 * - `leaf-ab`：筒子叶页码（中文数字 + 「第」「叶」「·」「上」「下」）。
 */
export const PAGE_NUMBER_STYLE_CHARS: Readonly<Record<string, string>> = {
  decimal: '0123456789',
  chinese: '〇零一二三四五六七八九十百千万',
  roman: 'ivxlcdmIVXLCDM',
  'leaf-ab': '第叶·上下〇零一二三四五六七八九十百千万',
};

/** 折算页码样式的页码用字字符集（未知样式返回空串，调用方无需判空拼接） */
export function pageNumberStyleChars(style: string): string {
  return PAGE_NUMBER_STYLE_CHARS[style] ?? '';
}

/** 统计全书用字（去重升序 + 频次 + 总数） */
export function collectDocumentChars(
  document: BookDocument,
  options: { extraChars?: string; extraSources?: ExtraCharSources } = {},
): CharUsage {
  const counts = new Map<string, number>();
  collectNodeChars(document.root, counts);
  if (options.extraChars !== undefined) {
    collectTextChars(options.extraChars, counts);
  }
  if (options.extraSources !== undefined) {
    const sources = [
      ...(options.extraSources.metadata ?? []),
      ...(options.extraSources.chrome ?? []),
    ];
    for (const source of sources) {
      collectTextChars(source, counts);
    }
  }
  const chars = [...counts.keys()].sort().join('');
  let total = 0;
  for (const count of counts.values()) total += count;
  return { chars, counts, total, unique: counts.size };
}
