/**
 * IR 节点行级切片（纸书跨页续排的片段渲染契约）
 *
 * 分页器（paginate）在块标记 `splittable` 时按「行」把段落拆成跨页片段
 * （`fromLine` / `lineCount`）。渲染层需要据此只输出「本片段应显示的那部分
 * 内容」，而非整块——否则预览页会把整段重复渲染、编辑页会溢出。本模块提供
 * 纯函数：给定块节点与「字符半开区间 [from, to)」，产出一个仅含该区间内联
 * 内容的新节点，保留跨切点文本的行内标记（marks），行内非文本载体按位置整体
 * 归属（其文本长度为 0，落在区间内则随片段保留）。
 *
 * 说明：字符偏移以「节点聚合文本」为轴（与 collectNodeText / 估算器口径一致），
 * 由调用方经行→字符映射（DOM 实测或 charsPerLine 估算）换算后传入。
 */
import { isTextNode, type BookNode } from '@bibliotype/core';

/** 节点聚合文本长度（与 reader.collectNodeText 口径一致，layout 内联避免反向依赖） */
function nodeTextLength(node: BookNode): number {
  if (isTextNode(node)) return node.text?.length ?? 0;
  return (node.children ?? []).reduce((sum, child) => sum + nodeTextLength(child), 0);
}

/**
 * 按字符半开区间 [from, to) 切出节点的子内容，返回新节点（不修改入参）。
 *
 * - 区间覆盖整块（from<=0 且 to>=总长）时原样返回同一引用（免复制）；
 * - 空区间返回无子节点的副本（渲染为空片段）；
 * - 文本叶子按区间裁剪并保留其 marks；行内元素载体按其起始位置是否落区间内整体保留。
 */
export function sliceNodeByCharRange(node: BookNode, from: number, to: number): BookNode {
  const children = node.children ?? [];
  const total = nodeTextLength(node);
  const start = Math.max(0, Math.min(from, total));
  const end = Math.max(start, Math.min(to, total));
  // 完整覆盖：无需切片，复用原节点
  if (start === 0 && end === total) return node;

  const out: BookNode[] = [];
  let off = 0;
  for (const child of children) {
    if (isTextNode(child)) {
      const text = child.text ?? '';
      const childStart = off;
      const childEnd = off + text.length;
      off = childEnd;
      const a = Math.max(start, childStart);
      const b = Math.min(end, childEnd);
      if (a < b) {
        out.push({ ...child, text: text.slice(a - childStart, b - childStart) });
      }
    } else {
      const len = nodeTextLength(child);
      const childStart = off;
      const childEnd = off + len;
      off = childEnd;
      // 行内元素载体：文本长度为 0 时按其位置归属；有文本时与区间相交则整体保留
      const intersects = len === 0
        ? childStart >= start && childStart < end
        : childStart < end && childEnd > start;
      if (intersects) out.push(child);
    }
  }
  return { ...node, children: out };
}
