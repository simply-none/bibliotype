/**
 * 句读 / 专名建议审阅（K3）
 *
 * 组合式的职责只有一件：把 `@bibliotype/classical` 的纯函数建议**编排成
 * 可审阅的状态机**（待处理 / 已接受 / 已拒绝 / 已落地），并把「接受」「拒绝」
 * 「采纳为标点」委托给宿主注入的命令执行器。
 *
 * 为什么命令由宿主注入：
 * - 接受建议本质是编辑器命令，`@bibliotype/vue` 不直接依赖 `classical/editor`
 *   （避免把 ProseMirror 命令层带进只读阅读场景）；
 * - 测试可注入假执行器，验证状态流转而不需要真实编辑器。
 */
import {
  buildAnnotationSuggestions,
  collectSuggestionBlocks,
  countSuggestions,
  type AnnotationSuggestion,
  type JudouSymbol,
  type ProperNameDetector,
  type ProperNameKind,
  type ProperNameTerm,
  type SuggestionKind,
} from '@bibliotype/classical';
import type {
  CommitJudouOptions,
  JudouSuggestionInput,
  ProperNameSuggestionInput,
  RemoveSuggestionMarksOptions,
} from '@bibliotype/classical/editor';
import type { BookDocument } from '@bibliotype/core';
import {
  computed,
  getCurrentScope,
  onScopeDispose,
  ref,
  toValue,
  type ComputedRef,
  type MaybeRefOrGetter,
  type Ref,
} from 'vue';

/** 建议的处置结果 */
export type SuggestionDecision = 'accepted' | 'rejected' | 'committed';

/** 宿主命令执行器（通常由 demo 用 classical/editor 的命令包装 BookEditor 得到） */
export interface SuggestionApplyHandlers {
  /** 接受句读建议（落 judou 标记） */
  judou: (items: readonly JudouSuggestionInput[]) => boolean;
  /** 接受专名建议（落 proper-name 标记） */
  properName: (items: readonly ProperNameSuggestionInput[]) => boolean;
  /** 采纳为标点（把已接受的句读标记落成真实字符） */
  commitJudou: (options?: CommitJudouOptions) => boolean;
  /** 拒绝 / 反悔：移除自动标记 */
  remove: (options?: RemoveSuggestionMarksOptions) => boolean;
}

/** 建议类别过滤（`all` 表示不过滤） */
export type SuggestionFilter = 'all' | SuggestionKind;

/** 单条建议的字段覆盖（改类 / 改标点） */
export interface SuggestionOverride {
  /** 句读：替换候选标点 */
  symbol?: JudouSymbol;
  /** 专名：替换类别 */
  nameKind?: ProperNameKind;
}

/** 组合式选项 */
export interface UseAnnotationSuggestionsOptions {
  /** 当前文档（响应式引用 / getter；为空时不生成建议） */
  document: MaybeRefOrGetter<BookDocument | undefined>;
  /** 宿主命令执行器 */
  apply: SuggestionApplyHandlers;
  /** 文档修订号：变化时重算（`getDocument()` 每次返回新对象，靠它触发） */
  revision?: MaybeRefOrGetter<number>;
  /** 自定义专名字典 */
  terms?: MaybeRefOrGetter<readonly ProperNameTerm[] | undefined>;
  /** 专名模型端口 */
  detector?: ProperNameDetector;
  /** 是否在修订号变化后自动重算（缺省 true） */
  autoRefresh?: boolean;
}

/** 组合式返回值 */
export interface UseAnnotationSuggestions {
  /** 全量建议（按文档顺序） */
  all: ComputedRef<readonly AnnotationSuggestion[]>;
  /** 尚未处置的建议 */
  pending: ComputedRef<readonly AnnotationSuggestion[]>;
  /** 当前过滤条件下、尚未处置的建议 */
  visible: ComputedRef<readonly AnnotationSuggestion[]>;
  /** 分类计数（未处置） */
  counts: ComputedRef<Record<SuggestionKind, number>>;
  /** 处置记录（id → 结果） */
  decisions: Ref<Readonly<Record<string, SuggestionDecision>>>;
  /** 类别过滤 */
  filter: Ref<SuggestionFilter>;
  /** 手动重算 */
  refresh: () => void;
  /** 接受（缺省全部可见项） */
  accept: (ids?: readonly string[]) => number;
  /** 拒绝（缺省全部可见项） */
  reject: (ids?: readonly string[]) => number;
  /** 采纳为标点（缺省全部已接受的句读） */
  commitJudou: (ids?: readonly string[]) => number;
  /** 改类 / 改标点 */
  setOverride: (id: string, patch: SuggestionOverride) => void;
  /** 清空处置与覆盖（重新开始审阅） */
  reset: () => void;
}

/**
 * 创建建议审阅状态
 *
 * @param options 见 {@link UseAnnotationSuggestionsOptions}
 */
export function useAnnotationSuggestions(
  options: UseAnnotationSuggestionsOptions,
): UseAnnotationSuggestions {
  const { apply, detector, autoRefresh = true } = options;
  /** 手动刷新计数（文档非响应式时由宿主调用 `refresh`） */
  const revisionTick = ref(0);
  const filter = ref<SuggestionFilter>('all');
  const decisions = ref<Record<string, SuggestionDecision>>({});
  const overrides = ref<Record<string, SuggestionOverride>>({});

  const all = computed<readonly AnnotationSuggestion[]>(() => {
    // 手动刷新触发依赖
    void revisionTick.value;
    // 自动跟随修订号（关掉时只有 refresh 能重算）
    if (autoRefresh && options.revision !== undefined) void toValue(options.revision);
    const document = toValue(options.document);
    if (document === undefined) return [];
    const terms = options.terms === undefined ? undefined : toValue(options.terms);
    return buildAnnotationSuggestions(collectSuggestionBlocks(document), {
      ...(terms === undefined ? {} : { terms }),
      ...(detector === undefined ? {} : { detector }),
    });
  });

  const pending = computed<readonly AnnotationSuggestion[]>(() =>
    all.value.filter((item) => decisions.value[item.id] === undefined),
  );

  /** 套用覆盖后的建议（不改原对象，保持 computed 结果只读） */
  const effective = (
    items: readonly AnnotationSuggestion[],
  ): readonly AnnotationSuggestion[] =>
    items.map((item) => {
      const patch = overrides.value[item.id];
      return patch === undefined ? item : { ...item, ...patch };
    });

  const visible = computed<readonly AnnotationSuggestion[]>(() =>
    effective(
      filter.value === 'all'
        ? pending.value
        : pending.value.filter((item) => item.kind === filter.value),
    ),
  );

  const counts = computed<Record<SuggestionKind, number>>(() => countSuggestions(pending.value));

  const refresh = (): void => {
    revisionTick.value += 1;
  };

  const accept = (ids?: readonly string[]): number => {
    const targets = effective(
      ids === undefined ? visible.value : pending.value.filter((item) => ids.includes(item.id)),
    );
    if (targets.length === 0) return 0;

    const judou = targets.filter((item) => item.kind === 'judou');
    const proper = targets.filter((item) => item.kind === 'proper-name');
    let accepted = 0;

    if (judou.length > 0) {
      const ok = apply.judou(
        judou.map<JudouSuggestionInput>((item) => ({
          blockId: item.blockId,
          start: item.start,
          end: item.end,
          symbol: item.symbol ?? '，',
          suggestionId: item.id,
          ...(item.rule === undefined ? {} : { rule: item.rule }),
          confidence: item.confidence,
        })),
      );
      if (ok) {
        for (const item of judou) {
          decisions.value = { ...decisions.value, [item.id]: 'accepted' };
          accepted += 1;
        }
      }
    }

    if (proper.length > 0) {
      const ok = apply.properName(
        proper.map<ProperNameSuggestionInput>((item) => ({
          blockId: item.blockId,
          start: item.start,
          end: item.end,
          suggestionId: item.id,
          ...(item.nameKind === undefined ? {} : { nameKind: item.nameKind }),
          confidence: item.confidence,
        })),
      );
      if (ok) {
        for (const item of proper) {
          decisions.value = { ...decisions.value, [item.id]: 'accepted' };
          accepted += 1;
        }
      }
    }

    return accepted;
  };

  const reject = (ids?: readonly string[]): number => {
    const targets =
      ids === undefined ? visible.value : pending.value.filter((item) => ids.includes(item.id));
    if (targets.length === 0) return 0;

    const idsToReject = targets.map((item) => item.id);
    // 已接受又反悔的，先移除文档里的标记；未接受的本来就不在文档里
    apply.remove({ suggestionIds: idsToReject });
    const next = { ...decisions.value };
    for (const id of idsToReject) next[id] = 'rejected';
    decisions.value = next;
    return targets.length;
  };

  const commitJudou = (ids?: readonly string[]): number => {
    const accepted = Object.entries(decisions.value)
      .filter(([, decision]) => decision === 'accepted')
      .map(([id]) => id)
      .filter((id) => (ids === undefined ? true : ids.includes(id)));
    if (accepted.length === 0) return 0;
    if (!apply.commitJudou({ suggestionIds: accepted })) return 0;

    const next = { ...decisions.value };
    for (const id of accepted) next[id] = 'committed';
    decisions.value = next;
    return accepted.length;
  };

  const setOverride = (id: string, patch: SuggestionOverride): void => {
    overrides.value = { ...overrides.value, [id]: { ...overrides.value[id], ...patch } };
  };

  const reset = (): void => {
    decisions.value = {};
    overrides.value = {};
    refresh();
  };

  if (getCurrentScope() !== undefined) {
    onScopeDispose(() => {
      decisions.value = {};
      overrides.value = {};
    });
  }

  return {
    all,
    pending,
    visible,
    counts,
    decisions,
    filter,
    refresh,
    accept,
    reject,
    commitJudou,
    setOverride,
    reset,
  };
}
