/**
 * 第二遍排版：把正文里的引用占位替换成真实页码
 *
 * 占位语法（内容作者手写，或由编辑器插入命令生成）：
 * - `{{page:<nodeId>}}` —— 直接按节点 id 取页码；
 * - `{{ref:<label>}}`  —— 按登记表标签取页码（推荐：作者只维护语义标签）。
 *
 * 目标缺失时替换为 `options.missing`（缺省 `？`），绝不抛错——
 * 稿件里存在指向已删除章节的引用是常态，应在预览中显示待修而不是中断导出。
 */
import { lookupPage } from './build.js';
import type { CrossReferenceRegistry } from './registry.js';
import type {
  LabelReferenceMatch,
  PageIndex,
  PageReferenceMatch,
  PageReferenceOptions,
} from './types.js';

/** 节点 id 占位符模式 */
export const PAGE_REFERENCE_PATTERN = /\{\{page:([^}]+)\}\}/g;

/** 标签占位符模式 */
export const LABEL_REFERENCE_PATTERN = /\{\{ref:([^}]+)\}\}/g;

/** 扫描节点 id 占位符（不修改文本） */
export function findPageReferences(text: string): PageReferenceMatch[] {
  const matches: PageReferenceMatch[] = [];
  const pattern = new RegExp(PAGE_REFERENCE_PATTERN.source, 'g');
  let hit = pattern.exec(text);
  while (hit) {
    const nodeId = (hit[1] ?? '').trim();
    matches.push({
      raw: hit[0],
      nodeId,
      start: hit.index,
      end: hit.index + hit[0].length,
    });
    hit = pattern.exec(text);
  }
  return matches;
}

/** 扫描标签占位符（不修改文本） */
export function findLabelReferences(text: string): LabelReferenceMatch[] {
  const matches: LabelReferenceMatch[] = [];
  const pattern = new RegExp(LABEL_REFERENCE_PATTERN.source, 'g');
  let hit = pattern.exec(text);
  while (hit) {
    const label = (hit[1] ?? '').trim();
    matches.push({
      raw: hit[0],
      label,
      start: hit.index,
      end: hit.index + hit[0].length,
    });
    hit = pattern.exec(text);
  }
  return matches;
}

/** 格式化单个页码（应用模板与缺省值） */
function formatMatch(
  match: PageReferenceMatch,
  page: number | undefined,
  options: PageReferenceOptions,
): string {
  const missing = options.missing ?? '？';
  const formatted =
    page === undefined ? missing : (options.format ? options.format(page) : String(page));
  if (options.template) {
    return options.template(formatted, match);
  }
  return formatted;
}

/** 替换节点 id 占位符 */
export function replacePageReferences(
  text: string,
  index: PageIndex,
  options: PageReferenceOptions = {},
): string {
  return text.replace(
    new RegExp(PAGE_REFERENCE_PATTERN.source, 'g'),
    (raw: string, id: string, offset: number) => {
      const nodeId = id.trim();
      const match: PageReferenceMatch = {
        raw,
        nodeId,
        start: offset,
        end: offset + raw.length,
      };
      return formatMatch(match, lookupPage(index, nodeId), options);
    },
  );
}

/** 替换标签占位符（需要登记表 + 页码索引） */
export function replaceLabelReferences(
  text: string,
  registry: CrossReferenceRegistry,
  index: PageIndex,
  options: PageReferenceOptions = {},
): string {
  return text.replace(
    new RegExp(LABEL_REFERENCE_PATTERN.source, 'g'),
    (raw: string, label: string, offset: number) => {
      const key = label.trim();
      const match: PageReferenceMatch = { raw, nodeId: key, start: offset, end: offset + raw.length };
      return formatMatch(match, registry.resolvePage(key, index), options);
    },
  );
}

/** 一次性替换两种占位（先标签后节点，顺序无关） */
export function resolveReferences(
  text: string,
  index: PageIndex,
  registry?: CrossReferenceRegistry,
  options: PageReferenceOptions = {},
): string {
  const withLabels = registry ? replaceLabelReferences(text, registry, index, options) : text;
  return replacePageReferences(withLabels, index, options);
}

/** 文本是否含任意引用占位（不持有全局正则状态） */
export function hasReferences(text: string): boolean {
  return (
    new RegExp(PAGE_REFERENCE_PATTERN.source).test(text) ||
    new RegExp(LABEL_REFERENCE_PATTERN.source).test(text)
  );
}
