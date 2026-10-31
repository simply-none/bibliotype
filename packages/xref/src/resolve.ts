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
  ResolveConvergedInput,
  ResolveConvergedResult,
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

/** 页码索引等值（entries 逐键比较 + 总页数；「页码稳定」的判定口径） */
function samePageIndex(left: PageIndex, right: PageIndex): boolean {
  if (left.totalPages !== right.totalPages) return false;
  const leftKeys = Object.keys(left.entries);
  const rightKeys = Object.keys(right.entries);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    if (left.entries[key] !== right.entries[key]) return false;
  }
  return true;
}

/**
 * 两遍收敛解析：替换 → 重建索引 → 页码稳定即止
 *
 * 引用占位替换会改变文本长度，进而可能使页码过期（页数虚变），单次
 * 替换不保证「印出来的页码」正确。本函数循环「替换 → 重建索引 → 与
 * 上一轮比较」至多 `maxRounds`（缺省 3）轮：索引稳定即提前退出。
 *
 * **每轮都从输入文档出发替换**（`replace(original, index_i)`，回调应为
 * 纯函数）：替换会消耗占位符，若在上一轮产物上继续替换，后几轮就再也
 * 改不动已印出的页码；只有「原文档 + 最新索引」重跑，产物的页码才与
 * 产物自身的分页一致（收敛时 `index` 既是产物分页、也是产物页码的来源）。
 *
 * 依赖边界：xref 只依赖 core，「重排」由调用方经 `reindex` 注入
 * （结构投影 → 分页 → 索引），本函数只负责循环与比较——确定性由
 * 注入回调保证（不触时间 / 随机源）。
 *
 * 不收敛（轮数耗尽页码仍在漂移）时返回最后一次替换结果并附
 * `converged: false`，由调用方决定告警或继续。
 */
export function resolveReferencesConverged(
  input: ResolveConvergedInput,
): ResolveConvergedResult {
  const maxRounds = Math.max(1, input.maxRounds ?? 3);
  let index = input.reindex(input.document);
  let document = input.document;
  let rounds = 0;
  while (rounds < maxRounds) {
    rounds += 1;
    const replaced = input.replace(input.document, index);
    const nextIndex = input.reindex(replaced);
    const stable = samePageIndex(index, nextIndex);
    document = replaced;
    index = nextIndex;
    if (stable) {
      return { document, index, converged: true, rounds };
    }
  }
  return { document, index, converged: false, rounds };
}

/** 文本是否含任意引用占位（不持有全局正则状态） */
export function hasReferences(text: string): boolean {
  return (
    new RegExp(PAGE_REFERENCE_PATTERN.source).test(text) ||
    new RegExp(LABEL_REFERENCE_PATTERN.source).test(text)
  );
}
