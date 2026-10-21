/**
 * 缺字审计（K6）
 *
 * 把 `core` 的缺字采集包成响应式状态：文档 / 字体链 / 修订号任一变化即可重算，
 * 面板只负责展示。探测默认使用 `document.fonts.check`，环境不支持时降级为
 * 「全部命中」（宁漏报不误报）。
 */
import {
  collectGlyphIssues,
  summarizeGlyphIssues,
  type BookDocument,
  type GlyphIssue,
  type GlyphProbe,
} from '@bibliotype/core';
import { computed, ref, toValue, type ComputedRef, type MaybeRefOrGetter } from 'vue';
import { createFontCheckProbe } from './font-probe.js';

/** 组合式选项 */
export interface UseGlyphAuditOptions {
  /** 待检查文档（响应式 getter） */
  document: MaybeRefOrGetter<BookDocument | undefined>;
  /** 字体回退链（缺省空数组：只用探测判断） */
  families?: MaybeRefOrGetter<readonly string[]>;
  /** 文档修订号：变化时重算（`getDocument()` 每次返回新对象，靠它触发） */
  revision?: MaybeRefOrGetter<number>;
  /** 自定义探测端口（缺省 `document.fonts.check`） */
  probe?: GlyphProbe;
  /** 字符 → IDS 描述 */
  idsFor?: (char: string) => string | undefined;
  /** 上下文长度（缺省 6） */
  contextLength?: number;
  /** 是否按字符去重（缺省 true） */
  unique?: boolean;
  /** 是否跟随修订号自动重算（缺省 true） */
  autoRefresh?: boolean;
}

/** 组合式返回值 */
export interface UseGlyphAudit {
  /** 缺字条目（文档顺序） */
  issues: ComputedRef<readonly GlyphIssue[]>;
  /** 中文摘要（一行） */
  summary: ComputedRef<string>;
  /** 缺字数 */
  missingCount: ComputedRef<number>;
  /** 可由 IDS 合成的数量 */
  idsCount: ComputedRef<number>;
  /** 手动重算 */
  refresh: () => void;
}

/**
 * 创建缺字审计状态
 *
 * @param options 见 {@link UseGlyphAuditOptions}
 */
export function useGlyphAudit(options: UseGlyphAuditOptions): UseGlyphAudit {
  const tick = ref(0);
  const { autoRefresh = true, idsFor, contextLength, unique } = options;

  /** 探测端口：显式传入优先，否则按环境创建一次 */
  const probe = options.probe ?? createFontCheckProbe();

  const issues = computed<readonly GlyphIssue[]>(() => {
    void tick.value;
    if (autoRefresh && options.revision !== undefined) void toValue(options.revision);
    const document = toValue(options.document);
    if (document === undefined) return [];
    const families = options.families === undefined ? [] : toValue(options.families);
    return collectGlyphIssues(document, {
      families,
      probe,
      ...(idsFor === undefined ? {} : { idsFor }),
      ...(contextLength === undefined ? {} : { contextLength }),
      ...(unique === undefined ? {} : { unique }),
    });
  });

  const summary = computed(() => summarizeGlyphIssues(issues.value));
  const missingCount = computed(
    () => issues.value.filter((issue) => issue.stage === 'tofu').length,
  );
  const idsCount = computed(
    () => issues.value.filter((issue) => issue.stage === 'ids').length,
  );

  return {
    issues,
    summary,
    missingCount,
    idsCount,
    refresh: () => {
      tick.value += 1;
    },
  };
}
