/**
 * 修订标记（C5）：类型、属性、采集与视图投影
 *
 * 设计取舍：**删除不丢内容**——被删文本仍留在 IR 中，只是带上 `deletion` 标记。
 * 这样「拒绝修订」可以无损还原；代价是修订态文档体积略增，导出前统一按
 * `final` 视图投影（见 `accept-reject.ts`）。
 *
 * 三类修订统一用标记表达：
 * - `insertion`：新增文本；
 * - `deletion`：删除文本（内容保留）；
 * - `format-change`：格式变化，`previous` 存变更前的标记快照 JSON。
 */
import { MARK_TYPES } from '../ir/node-types.js';
import type { BookDocument } from '../ir/document.js';
import type { BookMark, BookNode } from '../ir/nodes.js';
import { isTextNode } from '../ir/nodes.js';
import { hashAssetBytes } from '../storage/asset.js';

/** 修订标记类型常量 */
export const REVISION_MARK_TYPES = {
  INSERTION: MARK_TYPES.INSERTION,
  DELETION: MARK_TYPES.DELETION,
  FORMAT_CHANGE: MARK_TYPES.FORMAT_CHANGE,
} as const;

/** 修订标记类型联合 */
export type RevisionMarkType = (typeof REVISION_MARK_TYPES)[keyof typeof REVISION_MARK_TYPES];

/** 修订视图常量 */
export const REVISION_VIEWS = {
  /** 显示标记（插入下划线、删除删除线、格式变更虚线） */
  MARKED: 'marked',
  /** 呈现终稿（接受全部修订） */
  FINAL: 'final',
  /** 呈现原稿（拒绝全部修订） */
  ORIGINAL: 'original',
} as const;

/** 修订视图联合 */
export type RevisionView = (typeof REVISION_VIEWS)[keyof typeof REVISION_VIEWS];

/** 修订标记属性约定 */
export interface RevisionAttrs {
  /** 同一笔修订的标识（接受 / 拒绝按它定位） */
  changeId?: string;
  /** 操作者（显示名或用户 id） */
  author?: string;
  /** 操作时间（epoch ms；由调用方注入，保证可测） */
  timestamp?: number;
  /** `format-change` 专用：变更前的标记快照（JSON） */
  previous?: string;
}

/** 修订条目（侧栏列表 / 定位用） */
export interface RevisionEntry {
  /** 修订标识 */
  changeId: string;
  /** 修订类型 */
  type: RevisionMarkType;
  /** 操作者 */
  author?: string;
  /** 操作时间 */
  timestamp?: number;
  /** 受影响的文本 */
  text: string;
  /** 所在节点 id（若有） */
  nodeId?: string;
  /** 结构路径，如 `root.children[0].children[2]` */
  path: string;
}

/** 修订标记集合（快速判定） */
const REVISION_TYPES: ReadonlySet<string> = new Set(Object.values(REVISION_MARK_TYPES));

/** 是否为修订标记 */
export function isRevisionMark(mark: BookMark): boolean {
  return REVISION_TYPES.has(mark.type);
}

/** 取修订标记类型（非修订标记返回 undefined） */
export function revisionTypeOf(mark: BookMark): RevisionMarkType | undefined {
  return REVISION_TYPES.has(mark.type) ? (mark.type as RevisionMarkType) : undefined;
}

/**
 * 生成修订标识（确定性：同一作者 / 时间 / 序号 → 同一 id）
 *
 * 不取随机数与当前时间；时间与序号由调用方（插件或命令）注入。
 */
export function buildChangeId(input: {
  author?: string;
  timestamp: number;
  index: number;
}): string {
  const author = input.author ?? '';
  const digest = hashAssetBytes(new TextEncoder().encode(author));
  return `rv-${input.timestamp.toString(36)}-${digest}-${input.index}`;
}

/** 解析 `format-change.previous` 的标记快照（非法 JSON 返回空数组） */
export function parsePreviousMarks(mark: BookMark): BookMark[] {
  const previous = mark.attrs?.['previous'];
  if (typeof previous !== 'string' || previous === '') {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(previous);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const marks: BookMark[] = [];
  for (const item of parsed) {
    if (
      typeof item === 'object' &&
      item !== null &&
      typeof (item as BookMark).type === 'string' &&
      !isRevisionMark(item as BookMark)
    ) {
      marks.push(item as BookMark);
    }
  }
  return marks;
}

/** 序列化标记快照（用于 `format-change.previous`） */
export function serializeMarks(marks: readonly BookMark[]): string {
  return JSON.stringify(marks.filter((mark) => !isRevisionMark(mark)));
}

/** 投影结果：`hidden` 表示该文本在目标视图中应整段隐去 */
export interface ResolvedRevisionMarks {
  /** 是否隐去该文本 */
  hidden: boolean;
  /** 目标视图下应保留的标记 */
  marks: BookMark[];
}

/**
 * 按视图解析文本节点的标记
 *
 * - `marked`：原样返回（序列化层负责输出修订样式）；
 * - `final`：隐藏删除；插入 / 格式变更去掉修订痕迹，其余标记保留；
 * - `original`：隐藏插入；删除去掉标记（文字复原）；格式变更还原 `previous`。
 */
export function resolveMarksForView(
  marks: readonly BookMark[] | undefined,
  view: RevisionView,
): ResolvedRevisionMarks {
  if (marks === undefined || marks.length === 0 || view === REVISION_VIEWS.MARKED) {
    return { hidden: false, marks: marks === undefined ? [] : [...marks] };
  }
  const revision = marks.find((mark) => isRevisionMark(mark));
  if (revision === undefined) {
    return { hidden: false, marks: [...marks] };
  }
  const type = revisionTypeOf(revision);
  if (view === REVISION_VIEWS.FINAL) {
    if (type === REVISION_MARK_TYPES.DELETION) {
      return { hidden: true, marks: [] };
    }
    return { hidden: false, marks: marks.filter((mark) => !isRevisionMark(mark)) };
  }
  // original
  if (type === REVISION_MARK_TYPES.INSERTION) {
    return { hidden: true, marks: [] };
  }
  if (type === REVISION_MARK_TYPES.DELETION) {
    return { hidden: false, marks: marks.filter((mark) => !isRevisionMark(mark)) };
  }
  // 格式变更：还原变更前的完整标记快照（当前标记已被这次变更改写）
  return { hidden: false, marks: parsePreviousMarks(revision) };
}

/** 采集文档中的修订（按遍历顺序；同一 changeId 的多段文本各成一条） */
export function collectRevisions(document: BookDocument): RevisionEntry[] {
  const entries: RevisionEntry[] = [];
  walk(document.root, 'root', entries);
  return entries;
}

/** 递归采集 */
function walk(node: BookNode, path: string, entries: RevisionEntry[]): void {
  if (isTextNode(node)) {
    for (const mark of node.marks ?? []) {
      const type = revisionTypeOf(mark);
      if (type === undefined) {
        continue;
      }
      const entry: RevisionEntry = {
        changeId: typeof mark.attrs?.['changeId'] === 'string' ? mark.attrs['changeId'] : '',
        type,
        text: node.text ?? '',
        path,
      };
      if (node.id !== undefined) {
        entry.nodeId = node.id;
      }
      const author = mark.attrs?.['author'];
      if (typeof author === 'string') {
        entry.author = author;
      }
      const timestamp = mark.attrs?.['timestamp'];
      if (typeof timestamp === 'number') {
        entry.timestamp = timestamp;
      }
      entries.push(entry);
    }
    return;
  }
  const children = node.children ?? [];
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child !== undefined) {
      walk(child, `${path}.children[${index}]`, entries);
    }
  }
}

/** 修订类型的中文名（侧栏与导出共用） */
export function revisionTypeLabel(type: RevisionMarkType): string {
  switch (type) {
    case REVISION_MARK_TYPES.INSERTION:
      return '插入';
    case REVISION_MARK_TYPES.DELETION:
      return '删除';
    case REVISION_MARK_TYPES.FORMAT_CHANGE:
    default:
      return '格式变更';
  }
}

