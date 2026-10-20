/**
 * 标注解析：把锚点落到当前文档上
 *
 * 文档会被编辑：段落可能被删除、文本可能变短。解析结果分成两类，
 * 由上层决定如何提示（孤儿注记应可批量清理或人工重新定位）：
 * - `resolved`：锚点有效，附带当前文本（文本可能已被裁剪）；
 * - `orphans`：目标节点已不存在。
 */
import type { BookNode } from '@bibliotype/core';
import { resolveAnchor } from '@bibliotype/core';
import type { Annotation } from './types.js';

/** 已解析的标注 */
export interface ResolvedAnnotation {
  /** 原标注 */
  annotation: Annotation;
  /** 命中的节点 */
  node: BookNode;
  /** 锚点当前覆盖的文本 */
  text: string;
  /** 偏移是否因原文变短被裁剪 */
  clamped: boolean;
}

/** 批量解析结果 */
export interface AnnotationResolution {
  /** 有效标注 */
  resolved: ResolvedAnnotation[];
  /** 孤儿标注（目标节点已删除） */
  orphans: Annotation[];
}

/** 解析单条标注（目标不存在返回 undefined） */
export function resolveAnnotation(
  root: BookNode,
  annotation: Annotation,
): ResolvedAnnotation | undefined {
  const hit = resolveAnchor(root, annotation.anchor);
  if (!hit) {
    return undefined;
  }
  return { annotation, node: hit.node, text: hit.text, clamped: hit.clamped };
}

/** 批量解析（保持输入顺序） */
export function resolveAnnotations(
  root: BookNode,
  annotations: readonly Annotation[],
): AnnotationResolution {
  const resolved: ResolvedAnnotation[] = [];
  const orphans: Annotation[] = [];
  annotations.forEach((annotation) => {
    const hit = resolveAnnotation(root, annotation);
    if (hit) {
      resolved.push(hit);
    } else {
      orphans.push(annotation);
    }
  });
  return { resolved, orphans };
}

/** 按节点 id 分组（Map 键按 nodeId 升序，保证遍历确定性） */
export function groupAnnotationsByNode(
  resolution: AnnotationResolution,
): Map<string, ResolvedAnnotation[]> {
  const groups = new Map<string, ResolvedAnnotation[]>();
  resolution.resolved.forEach((item) => {
    const key = item.annotation.anchor.nodeId;
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(item);
    } else {
      groups.set(key, [item]);
    }
  });
  return new Map([...groups.entries()].sort((left, right) => (left[0] < right[0] ? -1 : 1)));
}

/** 取有效标注的数量统计（按种类，供侧栏角标使用） */
export function countByKind(
  resolution: AnnotationResolution,
): Record<string, number> {
  const counts: Record<string, number> = {};
  resolution.resolved.forEach((item) => {
    counts[item.annotation.kind] = (counts[item.annotation.kind] ?? 0) + 1;
  });
  return counts;
}
