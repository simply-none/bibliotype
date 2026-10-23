/**
 * 书籍元数据编辑草稿
 *
 * 承载书籍信息弹窗编辑态：草稿状态（`draft`）、编辑开关（`editing`）与
 * 「元数据 ⇄ 草稿」映射。`toDraft` / `norm` / `buildPatch` 为纯函数，
 * 不依赖组件实例，便于脱离 UI 单测；保存经注入的 `onSave` 上抛补丁。
 */
import { computed, reactive, ref } from 'vue';
import {
  CLASSICAL_DIVISIONS,
  type BookMetadata,
  type ClassicalDivision,
  type Contributor,
  type EditionInfo,
  type EditionType,
  type Identifier,
  type PublicationInfo,
} from '@bibliotype/core';

/**
 * 可编辑草稿（数值 / 可选字段以字符串承载，保存时归一化）
 */
export interface Draft {
  title: string;
  subtitle: string;
  language: string;
  classification: string;
  volumeCount: string;
  editionName: string;
  editionEra: string;
  editionPublisher: string;
  editionKind: '' | 'base' | 'variant';
  /** 版本类型（K7）：刻本 / 抄本 / 活字 / 稿本 */
  editionType: '' | EditionType;
  /** 四部（K7） */
  division: '' | ClassicalDivision;
  /** 四部二级类 */
  subdivision: string;
  /** 藏地 / 收藏机构 */
  repository: string;
  /** 索书号 */
  callNumber: string;
  pubPublisher: string;
  pubYear: string;
  pubPlace: string;
  contributors: Contributor[];
  identifiers: Identifier[];
  extra: { key: string; value: string }[];
}

/** 归一化：空串 → undefined（顶层补丁显式给出即清空） */
export function norm(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** 元数据 → 草稿（深拷贝，编辑不影响源对象） */
export function toDraft(m: BookMetadata): Draft {
  return {
    title: m.title ?? '',
    subtitle: m.subtitle ?? '',
    language: m.language ?? '',
    classification: m.classification ?? '',
    volumeCount: m.volumeCount === undefined ? '' : String(m.volumeCount),
    editionName: m.edition?.name ?? '',
    editionEra: m.edition?.era ?? '',
    editionPublisher: m.edition?.publisher ?? '',
    editionKind: m.edition?.kind ?? '',
    editionType: m.editionType ?? '',
    division: m.classicalCategory?.division ?? '',
    subdivision: m.classicalCategory?.subdivision ?? '',
    repository: m.repository ?? '',
    callNumber: m.callNumber ?? '',
    pubPublisher: m.publication?.publisher ?? '',
    pubYear: m.publication?.year ?? '',
    pubPlace: m.publication?.place ?? '',
    contributors: (m.contributors ?? []).map((c) => ({ ...c })),
    identifiers: (m.identifiers ?? []).map((i) => ({ ...i })),
    extra: Object.entries(m.extra ?? {}).map(([key, value]) => ({ key, value: String(value) })),
  };
}

/** 草稿 → 顶层字段补丁 */
export function buildPatch(draft: Draft): Partial<BookMetadata> {
  const edition: EditionInfo = {
    name: norm(draft.editionName),
    era: norm(draft.editionEra),
    publisher: norm(draft.editionPublisher),
    kind: draft.editionKind === '' ? undefined : draft.editionKind,
  };
  const hasEdition =
    edition.name !== undefined ||
    edition.era !== undefined ||
    edition.publisher !== undefined ||
    edition.kind !== undefined;

  const publication: PublicationInfo = {
    publisher: norm(draft.pubPublisher),
    year: norm(draft.pubYear),
    place: norm(draft.pubPlace),
  };
  const hasPublication = Object.values(publication).some((v) => v !== undefined);

  const extra: Record<string, unknown> = {};
  for (const entry of draft.extra) {
    const key = norm(entry.key);
    if (key !== undefined) {
      extra[key] = norm(entry.value) ?? '';
    }
  }

  const volumeNum = Number(draft.volumeCount);
  return {
    title: norm(draft.title),
    subtitle: norm(draft.subtitle),
    language: norm(draft.language),
    classification: norm(draft.classification),
    volumeCount:
      norm(draft.volumeCount) !== undefined && Number.isFinite(volumeNum)
        ? Math.trunc(volumeNum)
        : undefined,
    edition: hasEdition ? edition : undefined,
    publication: hasPublication ? publication : undefined,
    /* 古籍著录（K7）：空值显式透传为 undefined，便于「清空」生效 */
    editionType: draft.editionType === '' ? undefined : draft.editionType,
    classicalCategory:
      draft.division === ''
        ? undefined
        : {
            division: draft.division,
            ...(norm(draft.subdivision) === undefined
              ? {}
              : { subdivision: norm(draft.subdivision) }),
          },
    repository: norm(draft.repository),
    callNumber: norm(draft.callNumber),
    contributors: draft.contributors
      .map((c) => ({
        name: norm(c.name),
        dynasty: norm(c.dynasty ?? ''),
        role: norm(c.role ?? ''),
      }))
      .filter((c) => c.name !== undefined) as Contributor[],
    identifiers: draft.identifiers
      .map((i) => ({ scheme: i.scheme, value: norm(i.value) }))
      .filter((i) => i.value !== undefined) as Identifier[],
    extra: Object.keys(extra).length > 0 ? extra : undefined,
  };
}

export interface MetadataDraftDeps {
  /** 当前源元数据（弹窗打开期间的实时值） */
  metadata: () => BookMetadata;
  /** 保存上抛：把顶层字段补丁交回父级 */
  onSave: (patch: Partial<BookMetadata>) => void;
}

/** 编辑草稿状态与操作 */
export function useMetadataDraft(deps: MetadataDraftDeps) {
  const editing = ref(false);

  const draft = reactive<Draft>(toDraft(deps.metadata()));

  /** 当前四部下的二级类候选（仍允许手填自定义值） */
  const subdivisionOptions = computed(() => {
    const division = draft.division;
    if (division === '') return [];
    return CLASSICAL_DIVISIONS.find((item) => item.value === division)?.subdivisions ?? [];
  });

  /** 用当前源元数据重置草稿 */
  function resetDraft(): void {
    Object.assign(draft, toDraft(deps.metadata()));
  }

  function startEdit(): void {
    resetDraft();
    editing.value = true;
  }

  function cancelEdit(): void {
    editing.value = false;
  }

  function save(): void {
    deps.onSave(buildPatch(draft));
    editing.value = false;
  }

  return { editing, draft, subdivisionOptions, resetDraft, startEdit, cancelEdit, save };
}
