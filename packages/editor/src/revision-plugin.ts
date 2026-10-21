/**
 * 修订追踪插件（C5）
 *
 * 记录方式：沿用既有 `appendTransaction` 范式（见 `input-rules.ts`），
 * 在事务落定后追加一个**打标事务**：
 * - 删除：把被删文本按 `deletion` 标记重新插回（内容保留，拒绝时可无损还原）；
 * - 插入：给新增区间加 `insertion` 标记；
 * - 格式变更：给 `addMark` / `removeMark` 区间加 `format-change` 标记，
 *   `previous` 记录变更前的标记快照（拒绝时还原）。
 *
 * 设计约束：
 * - 只在修订模式开启时记录；撤销 / 重做事务不记录；
 * - 打标事务自带 `internal` 元数据，避免递归打标；
 * - 时间由调用方注入（缺省 `Date.now`，测试注入固定值），标识由
 *   `buildChangeId(作者, 时间, 序号)` 确定性生成。
 */
import { MARK_TYPES, buildChangeId, serializeMarks } from '@bibliotype/core';
import type { BookMark, RevisionView } from '@bibliotype/core';
import { REVISION_VIEWS } from '@bibliotype/core';
import type { Mark, MarkType } from 'prosemirror-model';
import type { EditorState, Transaction } from 'prosemirror-state';
import { Plugin, PluginKey } from 'prosemirror-state';

/** 插件状态 */
export interface RevisionPluginState {
  /** 是否处于修订模式 */
  enabled: boolean;
  /** 当前视图 */
  view: RevisionView;
  /** 当前操作者 */
  author?: string;
  /** 修订序号（保证同一毫秒内 changeId 唯一） */
  counter: number;
}

/** 通过事务元数据更新插件状态 */
export interface RevisionPluginMeta {
  /** 开关修订模式 */
  enabled?: boolean;
  /** 切换视图 */
  view?: RevisionView;
  /** 设置操作者 */
  author?: string;
  /** 修订序号（内部使用） */
  counter?: number;
  /** 内部打标事务标记（阻止递归） */
  internal?: boolean;
}

/** 插件键（命令与 UI 读取状态用） */
export const REVISION_PLUGIN_KEY = new PluginKey<RevisionPluginState>('bibliotype-revision');

/** 修订插件选项 */
export interface RevisionTrackingOptions {
  /** 初始操作者 */
  author?: string;
  /** 初始视图（默认 `marked`） */
  view?: RevisionView;
  /** 是否初始开启（默认 false，需显式开启修订模式） */
  enabled?: boolean;
  /** 时间来源（缺省 `Date.now`；测试注入固定值） */
  timestamp?: () => number;
}

/** 读取插件状态（未安装插件时返回关闭态） */
export function revisionStateOf(state: EditorState): RevisionPluginState {
  return (
    REVISION_PLUGIN_KEY.getState(state) ?? {
      enabled: false,
      view: REVISION_VIEWS.MARKED,
      counter: 0,
    }
  );
}

/** 取已注册的修订标记类型（未注册返回 undefined） */
function revisionMarkType(state: EditorState, type: string): MarkType | undefined {
  return state.schema.marks[type];
}

/** 步骤的 jsonID（replace / addMark / removeMark / attr） */
function stepKind(step: unknown): string | undefined {
  const candidate = step as { jsonID?: string };
  return candidate.jsonID;
}

/** 待打标的区间 */
interface PendingMark {
  from: number;
  to: number;
  markType: MarkType;
  attrs: Record<string, unknown>;
}

/** 创建修订追踪插件 */
export function createRevisionTrackingPlugin(
  options: RevisionTrackingOptions = {},
): Plugin<RevisionPluginState> {
  return new Plugin<RevisionPluginState>({
    key: REVISION_PLUGIN_KEY,

    state: {
      init: (): RevisionPluginState => {
        const initial: RevisionPluginState = {
          enabled: options.enabled === true,
          view: options.view ?? REVISION_VIEWS.MARKED,
          counter: 0,
        };
        if (options.author !== undefined) {
          initial.author = options.author;
        }
        return initial;
      },
      apply: (tr, previous): RevisionPluginState => {
        const meta = tr.getMeta(REVISION_PLUGIN_KEY) as RevisionPluginMeta | undefined;
        if (meta === undefined) {
          return previous;
        }
        const next: RevisionPluginState = { ...previous };
        if (meta.enabled !== undefined) {
          next.enabled = meta.enabled;
        }
        if (meta.view !== undefined) {
          next.view = meta.view;
        }
        if (meta.author !== undefined) {
          next.author = meta.author;
        }
        if (meta.counter !== undefined) {
          next.counter = meta.counter;
        }
        return next;
      },
    },

    appendTransaction: (transactions, oldState, newState) => {
      const state = REVISION_PLUGIN_KEY.getState(newState);
      if (state === undefined || !state.enabled) {
        return null;
      }
      // 内部打标事务不再触发记录
      const hasInternal = transactions.some(
        (tr) => (tr.getMeta(REVISION_PLUGIN_KEY) as RevisionPluginMeta | undefined)?.internal === true,
      );
      if (hasInternal) {
        return null;
      }
      const relevant = transactions.filter(
        (tr) => tr.docChanged && tr.getMeta('addToHistory') !== false,
      );
      if (relevant.length === 0) {
        return null;
      }

      const insertionType = revisionMarkType(newState, MARK_TYPES.INSERTION);
      const deletionType = revisionMarkType(newState, MARK_TYPES.DELETION);
      const formatType = revisionMarkType(newState, MARK_TYPES.FORMAT_CHANGE);
      if (insertionType === undefined && deletionType === undefined && formatType === undefined) {
        return null;
      }

      const timestamp = options.timestamp?.() ?? Date.now();
      const author = state.author;
      let seq = state.counter;
      const pending: PendingMark[] = [];
      const deletions: { pos: number; text: string; attrs: Record<string, unknown> }[] = [];

      const nextAttrs = (): Record<string, unknown> => {
        seq += 1;
        const attrs: Record<string, unknown> = {
          changeId: buildChangeId({ author, timestamp, index: seq }),
          timestamp,
        };
        if (author !== undefined) {
          attrs.author = author;
        }
        return attrs;
      };

      for (const tr of relevant) {
        tr.steps.forEach((step, index) => {
          const kind = stepKind(step);
          const mapping = tr.mapping.slice(index);
          if (kind === 'replace') {
            step.getMap().forEach((oldStart, oldEnd, newStart, newEnd) => {
              const removed = oldEnd - oldStart;
              if (removed > 0 && newEnd === newStart && deletionType !== undefined) {
                const text = oldState.doc.textBetween(oldStart, oldEnd, '\n', '\n');
                if (text !== '') {
                  deletions.push({
                    pos: mapping.map(oldStart, -1),
                    text,
                    attrs: nextAttrs(),
                  });
                }
              }
              if (newEnd > newStart && oldStart === oldEnd && insertionType !== undefined) {
                // 新增区间：起点取插入左侧、终点取插入右侧，避免边界塌缩成空区间
                const from = mapping.map(newStart, -1);
                const to = mapping.map(newEnd, 1);
                if (to > from) {
                  pending.push({ from, to, markType: insertionType, attrs: nextAttrs() });
                }
              }
            });
            return;
          }
          if (kind === 'addMark' || kind === 'removeMark') {
            if (formatType === undefined) {
              return;
            }
            const from = (step as unknown as { from: number }).from;
            const to = (step as unknown as { to: number }).to;
            const before = marksAt(oldState, from);
            pending.push({
              from: mapping.map(from),
              to: mapping.map(to),
              markType: formatType,
              attrs: { ...nextAttrs(), previous: serializeMarks(before) },
            });
          }
        });
      }

      if (pending.length === 0 && deletions.length === 0) {
        return null;
      }

      const tr: Transaction = newState.tr;
      for (const item of pending) {
        if (item.to <= item.from) {
          continue;
        }
        tr.addMark(item.from, item.to, item.markType.create(item.attrs));
      }
      // 从后往前插回被删文本，避免前面的插入改变后面位置
      deletions
        .sort((left, right) => right.pos - left.pos)
        .forEach((item) => {
          if (deletionType === undefined) {
            return;
          }
          const mark: Mark = deletionType.create(item.attrs);
          tr.insert(item.pos, newState.schema.text(item.text, [mark]));
        });

      if (tr.steps.length === 0) {
        return null;
      }
      tr.setMeta(REVISION_PLUGIN_KEY, { internal: true, counter: seq });
      return tr;
    },
  });
}

/** 取某位置的标记（非文本位置返回空数组；null 属性丢弃） */
function marksAt(state: EditorState, pos: number): BookMark[] {
  const node = state.doc.nodeAt(pos);
  if (node === null) {
    return [];
  }
  return node.marks.map((mark): BookMark => {
    const attrs: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(mark.attrs)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        attrs[key] = value;
      }
    }
    return Object.keys(attrs).length === 0
      ? { type: mark.type.name }
      : { type: mark.type.name, attrs };
  });
}
