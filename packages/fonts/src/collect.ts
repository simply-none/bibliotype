/**
 * 用字统计（E3）
 *
 * 遍历 IR 全部文本节点（含 ruby 注音、标题、题注、注文），统计字符集与频次，
 * 作为字体子集化的输入。标点与数字天然包含在文本中，不额外造集。
 */
import { isTextNode, type BookDocument, type BookNode } from '@bibliotype/core';
import type { CharUsage } from './types.js';

/** 控制字符（保留 \t / \n / \r；其余不可见字符不进字体子集） */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** 逐节点收集文本（导出供测试与自定义遍历复用） */
export function collectNodeChars(node: BookNode, counts: Map<string, number>): void {
  if (isTextNode(node)) {
    const text = (node.text ?? '').replace(CONTROL_CHARS, '');
    if (text === '') return;
    for (const char of text) counts.set(char, (counts.get(char) ?? 0) + 1);
    return;
  }
  for (const child of node.children ?? []) collectNodeChars(child, counts);
}

/** 统计全书用字（去重升序 + 频次 + 总数） */
export function collectDocumentChars(
  document: BookDocument,
  options: { extraChars?: string } = {},
): CharUsage {
  const counts = new Map<string, number>();
  collectNodeChars(document.root, counts);
  if (options.extraChars !== undefined) {
    for (const char of options.extraChars.replace(CONTROL_CHARS, '')) {
      counts.set(char, (counts.get(char) ?? 0) + 1);
    }
  }
  const chars = [...counts.keys()].sort().join('');
  let total = 0;
  for (const count of counts.values()) total += count;
  return { chars, counts, total, unique: counts.size };
}
