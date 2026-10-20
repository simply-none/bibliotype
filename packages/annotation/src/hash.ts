/**
 * 字符串内容哈希（FNV-1a 32 位）
 *
 * 标注 id 必须确定性：同一区间 + 同一作者 + 同一时间创建的标注意味着同一条记录，
 * 用内容哈希做 id 可天然去重，也便于跨端合并与协同比对。
 */

/** 计算字符串的 FNV-1a 32 位十六进制哈希 */
export function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
