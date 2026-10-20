/**
 * 文档统计组合式
 *
 * 以「文档引用变化 / revision 变化」触发统计，并做 300ms 防抖 —— 避免编辑器每次
 * 键入都全量遍历 IR。`countDocumentStats` 是纯函数，无需 DOM，SSR 亦可用。
 */
import { onScopeDispose, ref, watch, type Ref } from 'vue';
import { countDocumentStats, type BookDocument, type DocumentStats, type DocumentStatsOptions } from '@bibliotype/core';

/** useDocumentStats 入参 */
export interface UseDocumentStatsOptions {
  /** 文档（响应式引用；引用变化即重算） */
  document: Ref<BookDocument>;
  /** 版本号（编辑器事务后自增；同引用内变更靠它触发） */
  revision?: Ref<number>;
  /** 防抖时长（毫秒，缺省 300） */
  debounceMs?: number;
  /** 统计选项（注释口径 / 阅读速度 / 是否计标点） */
  options?: DocumentStatsOptions;
}

/** useDocumentStats 返回值 */
export interface UseDocumentStats {
  /** 最近一次统计结果 */
  stats: Ref<DocumentStats>;
  /** 立即重算（跳过防抖） */
  recompute: () => void;
}

/**
 * 创建文档统计组合式
 *
 * @param params 见 {@link UseDocumentStatsOptions}
 */
export function useDocumentStats(params: UseDocumentStatsOptions): UseDocumentStats {
  const { document, revision, debounceMs = 300, options } = params;
  const stats = ref<DocumentStats>(countDocumentStats(document.value, options));
  let timer: ReturnType<typeof setTimeout> | undefined;

  const recompute = (): void => {
    stats.value = countDocumentStats(document.value, options);
  };

  const schedule = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      recompute();
    }, debounceMs);
  };

  watch(
    [() => document.value, () => (revision === undefined ? 0 : revision.value)],
    schedule,
    { flush: 'post' },
  );

  onScopeDispose(() => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  });

  return { stats, recompute };
}
