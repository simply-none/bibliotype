/**
 * 术语一致性比对
 *
 * 稿件里同一个概念常被写成几种样子（「本纪 / 本记」「笺注 / 笺註」），
 * 逐条人工核对不可行。本模块在 `checkWordList` 之上做**分组统计**：
 * 给定「规范写法 + 可接受异写」，一次扫全文，输出
 *
 * - 每处异写命中的位置（带文本锚点，可直接跳转改稿）；
 * - 每个术语的规范写法用量与各异写用量；
 * - 是否已统一 / 是否全文未出现（冗余术语）。
 *
 * 全程纯函数，不依赖编辑器与 DOM；术语表由调用方提供（可与样式表 / 项目配置同源）。
 */
import type { BookDocument } from './document.js';
import {
  checkWordList,
  type WordListCheckOptions,
  type WordListMatch,
} from './document-stats.js';

/** 术语条目 */
export interface GlossaryTerm {
  /** 规范写法（建议全稿统一使用） */
  preferred: string;
  /** 可接受的异写（命中即提示改为规范写法） */
  variants?: readonly string[];
  /** 备注（原样回传，便于 UI 展示编辑说明） */
  note?: string;
}

/** 单个异写的用量 */
export interface GlossaryVariantUsage {
  /** 异写文本 */
  term: string;
  /** 出现次数 */
  count: number;
  /** 首次命中（含锚点，便于一键跳转） */
  first?: WordListMatch;
}

/** 单个术语的用量与一致性 */
export interface GlossaryTermUsage {
  /** 规范写法 */
  preferred: string;
  /** 备注 */
  note?: string;
  /** 规范写法出现次数 */
  preferredCount: number;
  /** 实际出现的异写（按出现顺序，未出现的异写不列） */
  variants: GlossaryVariantUsage[];
  /** 全文未出现（规范写法与异写都没有） */
  unused: boolean;
  /** 已统一（没有任何异写命中） */
  consistent: boolean;
}

/** 术语检查选项 */
export interface GlossaryCheckOptions extends WordListCheckOptions {
  /** 是否在结果里保留未出现的术语（缺省 true；false 时从 `terms` 中剔除） */
  includeUnused?: boolean;
}

/** 术语检查报告 */
export interface GlossaryReport {
  /** 全部异写命中（文档先序；`suggestion` 为规范写法） */
  issues: WordListMatch[];
  /** 逐术语用量（按传入顺序，除非剔除未使用项） */
  terms: GlossaryTermUsage[];
  /** 存在异写的术语数 */
  inconsistentCount: number;
  /** 全文未出现的术语数 */
  unusedCount: number;
}

/** 术语检查用的词表条目类别 */
const GLOSSARY_KIND = 'glossary';

/**
 * 校验术语表本身（规范写法非空、不与自身异写重复）
 *
 * 返回问题描述数组，空数组表示没有问题。不抛错：术语表多来自用户配置，
 * 一条写错不应让整次检查失败。
 */
export function validateGlossary(glossary: readonly GlossaryTerm[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  glossary.forEach((term, index) => {
    if (term.preferred.trim() === '') {
      problems.push(`术语 #${index + 1} 的规范写法为空`);
      return;
    }
    if (seen.has(term.preferred)) {
      problems.push(`术语「${term.preferred}」重复定义`);
    }
    seen.add(term.preferred);
    for (const variant of term.variants ?? []) {
      if (variant.trim() === '') {
        problems.push(`术语「${term.preferred}」含空的异写`);
      } else if (variant === term.preferred) {
        problems.push(`术语「${term.preferred}」的异写与其规范写法相同`);
      }
    }
  });
  return problems;
}

/**
 * 检查术语一致性
 *
 * - 只在文本块内做字面匹配（与 `checkWordList` 同口径），默认含注释；
 * - 规范写法与异写分别统计，因此「只用了异写」的术语也能看出用量；
 * - 同一条异写若被多个术语声明，按各自条目分别计数（调用方应避免这种表）。
 */
export function checkGlossary(
  document: BookDocument,
  glossary: readonly GlossaryTerm[],
  options: GlossaryCheckOptions = {},
): GlossaryReport {
  const usable = glossary.filter((term) => term.preferred.trim() !== '');
  if (usable.length === 0) {
    return { issues: [], terms: [], inconsistentCount: 0, unusedCount: 0 };
  }

  /* 异写词表：每条带 suggestion = 规范写法，checkWordList 命中即为待改处 */
  const variantEntries = usable.flatMap((term) =>
    (term.variants ?? [])
      .filter((variant) => variant.trim() !== '' && variant !== term.preferred)
      .map((variant) => ({
        term: variant,
        suggestion: term.preferred,
        kind: GLOSSARY_KIND,
      })),
  );
  const issues = variantEntries.length === 0
    ? []
    : checkWordList(document, variantEntries, options);

  /* 规范写法用量：单独扫一遍，避免与异写词条混在一起 */
  const preferredMatches = checkWordList(
    document,
    usable.map((term) => ({ term: term.preferred, kind: GLOSSARY_KIND })),
    options,
  );

  const terms: GlossaryTermUsage[] = usable.map((term) => {
    const preferredCount = preferredMatches.filter((match) => match.term === term.preferred).length;

    const variants: GlossaryVariantUsage[] = [];
    for (const variant of term.variants ?? []) {
      if (variant.trim() === '' || variant === term.preferred) continue;
      const hits = issues.filter(
        (match) => match.term === variant && match.suggestion === term.preferred,
      );
      if (hits.length === 0) continue;
      const entry: GlossaryVariantUsage = { term: variant, count: hits.length };
      const first = hits[0];
      if (first !== undefined) entry.first = first;
      variants.push(entry);
    }

    const used = preferredCount > 0 || variants.length > 0;
    return {
      preferred: term.preferred,
      ...(term.note === undefined ? {} : { note: term.note }),
      preferredCount,
      variants,
      unused: !used,
      consistent: variants.length === 0,
    };
  });

  const filtered =
    options.includeUnused === false ? terms.filter((term) => !term.unused) : terms;

  return {
    issues,
    terms: filtered,
    inconsistentCount: filtered.filter((term) => !term.consistent).length,
    unusedCount: terms.filter((term) => term.unused).length,
  };
}
