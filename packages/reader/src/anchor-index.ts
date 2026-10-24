/**
 * 文档内锚点索引（纯函数）
 *
 * 链接标记的 hash（`#ch1-9`；EPUB 遗留的 `text00012.html#ch1-9` 同理取末段）
 * → 所在叶块 id。存量导入书的锚点目标块没有源 id，`getPageOfNode` 无从命中；
 * 但注码与注文之间的链接标记仍在块内容里，按 hash 反查所在块是跨页定位的
 * 最后一跳。首次出现优先（与 pageByBlockId / noteAnchors 同口径）。
 */
import { isTextNode, type BookNode } from '@bibliotype/core';

/** 从块节点子树收集链接 hash → 块 id（就地写入 map，首次出现优先） */
export function indexLinkAnchors(node: BookNode, blockId: string, map: Map<string, string>): void {
  if (node.children === undefined) return;
  for (const child of node.children) {
    if (isTextNode(child)) {
      for (const mark of child.marks ?? []) {
        const href = mark.attrs?.['href'];
        if (typeof href !== 'string') continue;
        const hashAt = href.lastIndexOf('#');
        if (hashAt < 0) continue;
        const hash = href.slice(hashAt + 1);
        if (hash !== '' && !map.has(hash)) map.set(hash, blockId);
      }
      continue;
    }
    indexLinkAnchors(child, blockId, map);
  }
}
