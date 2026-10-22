<script setup lang="ts">
/**
 * 书籍信息弹窗（Demo 组件，查看 / 编辑双态）
 *
 * 展示书目元数据（BookMetadata）全量字段：
 * 基本信息 / 责任者 / 版本 / 古籍著录（四部、版本类型、藏地、索书号）/ 出版 / 标识符 /
 * 扩展键值（extra，仅查看）/ 记录时间。
 * editable 为 true 时可切换到编辑态：改基本字段、增删责任者 / 标识符 / 扩展键值，
 * 保存时向父级 emit('save', patch)（顶层字段补丁，留空即清空；title 空则不改）。
 * 查看态可直接导出 DC JSON / CNMARC 文本（K7），文件由浏览器下载，库内不写文件。
 * 遮罩点击 / 关闭按钮 / Esc 关闭；编辑态下点遮罩不关闭（防误丢改动）。
 */
import { computed, reactive, ref } from 'vue';
import {
  CLASSICAL_DIVISIONS,
  EDITION_TYPES,
  serializeDublinCore,
  toCnmarc,
  toDublinCore,
  type BookMetadata,
  type ClassicalDivision,
  type Contributor,
  type EditionInfo,
  type EditionType,
  type Identifier,
  type PublicationInfo,
} from '@bibliotype/core';
import { BT_BREAKPOINTS, useBreakpoint } from '@bibliotype/vue';
import AppIcon from './AppIcon.vue';

const props = defineProps<{ metadata: BookMetadata; editable?: boolean }>();
const emit = defineEmits<{
  close: [];
  save: [patch: Partial<BookMetadata>];
}>();

/**
 * H5 断点（C2）：窄屏模态转全屏页
 *
 * 与样式表的 `@media (max-width: 767px)` 同口径，另保留可断言的类名 / data 钩子
 * ——happy-dom 不执行媒体查询，测试靠钩子判断布局分支。
 */
const breakpoint = useBreakpoint();
const mobileLayout = computed(() => breakpoint.width.value < BT_BREAKPOINTS.md);

/** extra 古籍著录键 → 中文标签（未映射键原样展示） */
const EXTRA_LABELS: Readonly<Record<string, string>> = {
  versionType: '版本类型',
  editionAreas: '版本著录',
  binding: '装帧',
  linesPerHalfLeaf: '行款',
  borderFrame: '版框',
  pageCenter: '版心',
  collection: '收藏',
  shelfMark: '索书号',
  revision: '修订',
};

/** 标识符 scheme → 展示名 */
const SCHEME_LABELS: Readonly<Record<string, string>> = {
  isbn: 'ISBN',
  issn: 'ISSN',
  doi: 'DOI',
  cnmarc: 'CNMARC',
  other: '标识符',
};

const IDENTIFIER_SCHEMES: readonly Identifier['scheme'][] = [
  'isbn',
  'issn',
  'doi',
  'cnmarc',
  'other',
];

/* ---------------- 查看态派生数据 ---------------- */

const contributors = computed<readonly Contributor[]>(() => props.metadata.contributors ?? []);
const identifiers = computed(() => props.metadata.identifiers ?? []);
const extraEntries = computed(() =>
  Object.entries(props.metadata.extra ?? {}).map(([key, value]) => ({
    label: EXTRA_LABELS[key] ?? key,
    key,
    value: String(value),
  })),
);

const editionKindText = computed(() => {
  const kind = props.metadata.edition?.kind;
  if (kind === 'base') return '底本';
  if (kind === 'variant') return '校本';
  return '';
});

/** 四部标签（经部 / 史部 …） */
const divisionText = computed(() => {
  const division = props.metadata.classicalCategory?.division;
  if (division === undefined) return '';
  return CLASSICAL_DIVISIONS.find((item) => item.value === division)?.label ?? '';
});

/** 版本类型标签（刻本 / 抄本 …） */
const editionTypeText = computed(() => {
  const type = props.metadata.editionType;
  if (type === undefined) return '';
  return EDITION_TYPES.find((item) => item.value === type)?.label ?? '';
});

/* ---------------- 编目导出（DC JSON / CNMARC 文本） ---------------- */

/** 文件名去非法字符 */
function safeFilename(title: string): string {
  return (title.trim() === '' ? 'bibliotype' : title.trim()).replace(/[\\/:*?"<>|]+/g, '_');
}

/** 触发文本下载（纯宿主行为，库内不写文件） */
function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** 导出都柏林核心 JSON */
function exportDublinCore(): void {
  downloadText(
    `${safeFilename(props.metadata.title)}-dc.json`,
    serializeDublinCore(toDublinCore(props.metadata)),
    'application/json',
  );
}

/** 导出 CNMARC 字段行文本 */
function exportCnmarc(): void {
  downloadText(
    `${safeFilename(props.metadata.title)}-cnmarc.txt`,
    toCnmarc(props.metadata),
    'text/plain',
  );
}

function contributorText(contributor: Contributor): string {
  return [contributor.dynasty, contributor.name, contributor.role]
    .filter((part) => part !== undefined && part !== '')
    .join('　');
}

function schemeText(scheme: string): string {
  return SCHEME_LABELS[scheme] ?? scheme.toUpperCase();
}

function formatTimestamp(value: unknown): string {
  if (typeof value === 'number') return new Date(value).toLocaleString();
  return String(value);
}

const createdAt = computed(() => props.metadata.createdAt);
const updatedAt = computed(() => props.metadata.updatedAt);

/* ---------------- 编辑态 ---------------- */

/** 可编辑草稿（数值 / 可选字段以字符串承载，保存时归一化） */
interface Draft {
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

const editing = ref(false);

const draft = reactive<Draft>({
  title: '',
  subtitle: '',
  language: '',
  classification: '',
  volumeCount: '',
  editionName: '',
  editionEra: '',
  editionPublisher: '',
  editionKind: '',
  editionType: '',
  division: '',
  subdivision: '',
  repository: '',
  callNumber: '',
  pubPublisher: '',
  pubYear: '',
  pubPlace: '',
  contributors: [],
  identifiers: [],
  extra: [],
});

/** 当前四部下的二级类候选（仍允许手填自定义值） */
const subdivisionOptions = computed(() => {
  const division = draft.division;
  if (division === '') return [];
  return CLASSICAL_DIVISIONS.find((item) => item.value === division)?.subdivisions ?? [];
});

/** 元数据 → 草稿（深拷贝，编辑不影响源对象） */
function toDraft(m: BookMetadata): Draft {
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

/** 用当前源元数据重置草稿 */
function resetDraft(): void {
  Object.assign(draft, toDraft(props.metadata));
}

function startEdit(): void {
  resetDraft();
  editing.value = true;
}

function cancelEdit(): void {
  editing.value = false;
}

/** 归一化：空串 → undefined（顶层补丁显式给出即清空） */
function norm(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** 草稿 → 顶层字段补丁 */
function buildPatch(): Partial<BookMetadata> {
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
    volumeCount: norm(draft.volumeCount) !== undefined && Number.isFinite(volumeNum)
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
      .map((c) => ({ name: norm(c.name), dynasty: norm(c.dynasty ?? ''), role: norm(c.role ?? '') }))
      .filter((c) => c.name !== undefined) as Contributor[],
    identifiers: draft.identifiers
      .map((i) => ({ scheme: i.scheme, value: norm(i.value) }))
      .filter((i) => i.value !== undefined) as Identifier[],
    extra: Object.keys(extra).length > 0 ? extra : undefined,
  };
}

function save(): void {
  emit('save', buildPatch());
  editing.value = false;
}

/* ---------------- 增删行 ---------------- */

function addContributor(): void {
  draft.contributors.push({ name: '', dynasty: '', role: '' });
}
function removeContributor(index: number): void {
  draft.contributors.splice(index, 1);
}
function addIdentifier(): void {
  draft.identifiers.push({ scheme: 'other', value: '' });
}
function removeIdentifier(index: number): void {
  draft.identifiers.splice(index, 1);
}
function addExtra(): void {
  draft.extra.push({ key: '', value: '' });
}
function removeExtra(index: number): void {
  draft.extra.splice(index, 1);
}
</script>

<template>
  <div
    class="dialog"
    :class="{ 'dialog--mobile': mobileLayout }"
    role="dialog"
    aria-modal="true"
    :data-mobile="mobileLayout ? 'true' : 'false'"
    @click.self="editing ? undefined : emit('close')"
  >
    <div class="dialog__panel">
      <header class="dialog__header">
        <!-- 关闭：桌面在末尾（右上 ×），H5 换到左侧改返回箭头；可访问名不变 -->
        <button type="button" class="dialog__close" aria-label="关闭" @click="emit('close')">
          <AppIcon class="dialog__close-back" name="arrow-left" :size="20" />
          <span class="dialog__close-cross" aria-hidden="true">×</span>
        </button>
        <h2 class="dialog__title">书籍信息</h2>
        <div class="dialog__header-actions">
          <template v-if="!editing">
            <button type="button" class="dialog__action" @click="exportDublinCore">
              导出 DC
            </button>
            <button type="button" class="dialog__action" @click="exportCnmarc">
              导出 MARC
            </button>
          </template>
          <button
            v-if="editable && !editing"
            type="button"
            class="dialog__action"
            @click="startEdit"
          >
            编辑
          </button>
          <template v-if="editing">
            <button type="button" class="dialog__action" @click="cancelEdit">取消</button>
            <button type="button" class="dialog__action dialog__action--primary" @click="save">
              保存
            </button>
          </template>
        </div>
      </header>

      <!-- 查看态 -->
      <div v-if="!editing" class="dialog__body">
        <section class="dialog__section">
          <h3 class="dialog__section-title">基本信息</h3>
          <div class="dialog__row">
            <span class="dialog__label">题名</span>
            <span class="dialog__value">{{ metadata.title }}</span>
          </div>
          <div v-if="metadata.subtitle" class="dialog__row">
            <span class="dialog__label">副题</span>
            <span class="dialog__value">{{ metadata.subtitle }}</span>
          </div>
          <div v-if="metadata.language" class="dialog__row">
            <span class="dialog__label">语言</span>
            <span class="dialog__value">{{ metadata.language }}</span>
          </div>
          <div v-if="metadata.volumeCount !== undefined" class="dialog__row">
            <span class="dialog__label">卷数</span>
            <span class="dialog__value">{{ metadata.volumeCount }} 卷</span>
          </div>
          <div v-if="metadata.classification" class="dialog__row">
            <span class="dialog__label">分类</span>
            <span class="dialog__value">{{ metadata.classification }}</span>
          </div>
        </section>

        <section v-if="contributors.length > 0" class="dialog__section">
          <h3 class="dialog__section-title">责任者</h3>
          <div v-for="(contributor, index) in contributors" :key="index" class="dialog__row">
            <span class="dialog__label">第 {{ index + 1 }} 位</span>
            <span class="dialog__value">{{ contributorText(contributor) }}</span>
          </div>
        </section>

        <section v-if="metadata.edition" class="dialog__section">
          <h3 class="dialog__section-title">版本</h3>
          <div v-if="metadata.edition.name" class="dialog__row">
            <span class="dialog__label">版本名称</span>
            <span class="dialog__value">{{ metadata.edition.name }}</span>
          </div>
          <div v-if="metadata.edition.era" class="dialog__row">
            <span class="dialog__label">刊刻年代</span>
            <span class="dialog__value">{{ metadata.edition.era }}</span>
          </div>
          <div v-if="metadata.edition.publisher" class="dialog__row">
            <span class="dialog__label">刊刻者</span>
            <span class="dialog__value">{{ metadata.edition.publisher }}</span>
          </div>
          <div v-if="editionKindText" class="dialog__row">
            <span class="dialog__label">版本性质</span>
            <span class="dialog__value">{{ editionKindText }}</span>
          </div>
        </section>

        <section
          v-if="editionTypeText || divisionText || metadata.repository || metadata.callNumber"
          class="dialog__section"
        >
          <h3 class="dialog__section-title">古籍著录</h3>
          <div v-if="editionTypeText" class="dialog__row">
            <span class="dialog__label">版本类型</span>
            <span class="dialog__value">{{ editionTypeText }}</span>
          </div>
          <div v-if="divisionText" class="dialog__row">
            <span class="dialog__label">四部</span>
            <span class="dialog__value">
              {{ divisionText
              }}<template v-if="metadata.classicalCategory?.subdivision"
                >·{{ metadata.classicalCategory.subdivision }}</template
              >
            </span>
          </div>
          <div v-if="metadata.repository" class="dialog__row">
            <span class="dialog__label">藏地</span>
            <span class="dialog__value">{{ metadata.repository }}</span>
          </div>
          <div v-if="metadata.callNumber" class="dialog__row">
            <span class="dialog__label">索书号</span>
            <span class="dialog__value">{{ metadata.callNumber }}</span>
          </div>
        </section>

        <section v-if="metadata.publication" class="dialog__section">
          <h3 class="dialog__section-title">出版</h3>
          <div v-if="metadata.publication.publisher" class="dialog__row">
            <span class="dialog__label">出版社</span>
            <span class="dialog__value">{{ metadata.publication.publisher }}</span>
          </div>
          <div v-if="metadata.publication.year" class="dialog__row">
            <span class="dialog__label">出版年</span>
            <span class="dialog__value">{{ metadata.publication.year }}</span>
          </div>
          <div v-if="metadata.publication.place" class="dialog__row">
            <span class="dialog__label">出版地</span>
            <span class="dialog__value">{{ metadata.publication.place }}</span>
          </div>
        </section>

        <section v-if="identifiers.length > 0" class="dialog__section">
          <h3 class="dialog__section-title">标识符</h3>
          <div v-for="(identifier, index) in identifiers" :key="index" class="dialog__row">
            <span class="dialog__label">{{ schemeText(identifier.scheme) }}</span>
            <span class="dialog__value">{{ identifier.value }}</span>
          </div>
        </section>

        <section v-if="extraEntries.length > 0" class="dialog__section">
          <h3 class="dialog__section-title">古籍著录</h3>
          <div v-for="entry in extraEntries" :key="entry.key" class="dialog__row">
            <span class="dialog__label">{{ entry.label }}</span>
            <span class="dialog__value">{{ entry.value }}</span>
          </div>
        </section>

        <section v-if="createdAt !== undefined || updatedAt !== undefined" class="dialog__section">
          <h3 class="dialog__section-title">记录</h3>
          <div v-if="createdAt !== undefined" class="dialog__row">
            <span class="dialog__label">创建时间</span>
            <span class="dialog__value">{{ formatTimestamp(createdAt) }}</span>
          </div>
          <div v-if="updatedAt !== undefined" class="dialog__row">
            <span class="dialog__label">修改时间</span>
            <span class="dialog__value">{{ formatTimestamp(updatedAt) }}</span>
          </div>
        </section>
      </div>

      <!-- 编辑态 -->
      <div v-else class="dialog__body">
        <section class="dialog__section">
          <h3 class="dialog__section-title">基本信息</h3>
          <label class="field">
            <span class="field__label">题名 *</span>
            <input v-model="draft.title" class="field__input" type="text" placeholder="书名" />
          </label>
          <label class="field">
            <span class="field__label">副题</span>
            <input v-model="draft.subtitle" class="field__input" type="text" placeholder="副题 / 并列题名" />
          </label>
          <div class="field__grid">
            <label class="field">
              <span class="field__label">语言</span>
              <input v-model="draft.language" class="field__input" type="text" placeholder="zh-Hans" />
            </label>
            <label class="field">
              <span class="field__label">卷数</span>
              <input v-model="draft.volumeCount" class="field__input" type="number" min="0" step="1" />
            </label>
          </div>
          <label class="field">
            <span class="field__label">分类</span>
            <input v-model="draft.classification" class="field__input" type="text" placeholder="如：经部·论语" />
          </label>
        </section>

        <section class="dialog__section">
          <h3 class="dialog__section-title">
            责任者
            <button type="button" class="dialog__add" @click="addContributor">＋ 添加</button>
          </h3>
          <div v-for="(contributor, index) in draft.contributors" :key="index" class="rows__item">
            <input v-model="contributor.name" class="field__input" type="text" placeholder="姓名" />
            <input v-model="contributor.dynasty" class="field__input" type="text" placeholder="朝代" />
            <input v-model="contributor.role" class="field__input" type="text" placeholder="角色" />
            <button type="button" class="dialog__remove" aria-label="删除" @click="removeContributor(index)">
              ×
            </button>
          </div>
          <p v-if="draft.contributors.length === 0" class="dialog__empty">暂无责任者</p>
        </section>

        <section class="dialog__section">
          <h3 class="dialog__section-title">版本</h3>
          <label class="field">
            <span class="field__label">版本名称</span>
            <input v-model="draft.editionName" class="field__input" type="text" placeholder="如：庚辰本" />
          </label>
          <div class="field__grid">
            <label class="field">
              <span class="field__label">刊刻年代</span>
              <input v-model="draft.editionEra" class="field__input" type="text" />
            </label>
            <label class="field">
              <span class="field__label">版本性质</span>
              <select v-model="draft.editionKind" class="field__input">
                <option value="">未定</option>
                <option value="base">底本</option>
                <option value="variant">校本</option>
              </select>
            </label>
          </div>
          <label class="field">
            <span class="field__label">刊刻者 / 藏机构</span>
            <input v-model="draft.editionPublisher" class="field__input" type="text" />
          </label>
          <div class="field__grid">
            <label class="field">
              <span class="field__label">版本类型</span>
              <select v-model="draft.editionType" class="field__input">
                <option value="">未定</option>
                <option v-for="item in EDITION_TYPES" :key="item.value" :value="item.value">
                  {{ item.label }}
                </option>
              </select>
            </label>
            <label class="field">
              <span class="field__label">藏地</span>
              <input
                v-model="draft.repository"
                class="field__input"
                type="text"
                placeholder="如：中国国家图书馆"
              />
            </label>
          </div>
        </section>

        <section class="dialog__section">
          <h3 class="dialog__section-title">古籍著录（K7）</h3>
          <div class="field__grid">
            <label class="field">
              <span class="field__label">四部</span>
              <select v-model="draft.division" class="field__input">
                <option value="">未分类</option>
                <option
                  v-for="item in CLASSICAL_DIVISIONS"
                  :key="item.value"
                  :value="item.value"
                >
                  {{ item.label }}
                </option>
              </select>
            </label>
            <label class="field">
              <span class="field__label">二级类</span>
              <input
                v-model="draft.subdivision"
                class="field__input"
                type="text"
                list="bt-subdivisions"
                placeholder="如：四书类"
              />
              <datalist id="bt-subdivisions">
                <option v-for="item in subdivisionOptions" :key="item" :value="item" />
              </datalist>
            </label>
          </div>
          <label class="field">
            <span class="field__label">索书号</span>
            <input
              v-model="draft.callNumber"
              class="field__input"
              type="text"
              placeholder="如：善本 12345"
            />
          </label>
        </section>

        <section class="dialog__section">
          <h3 class="dialog__section-title">出版</h3>
          <label class="field">
            <span class="field__label">出版社</span>
            <input v-model="draft.pubPublisher" class="field__input" type="text" />
          </label>
          <div class="field__grid">
            <label class="field">
              <span class="field__label">出版年</span>
              <input v-model="draft.pubYear" class="field__input" type="text" />
            </label>
            <label class="field">
              <span class="field__label">出版地</span>
              <input v-model="draft.pubPlace" class="field__input" type="text" />
            </label>
          </div>
        </section>

        <section class="dialog__section">
          <h3 class="dialog__section-title">
            标识符
            <button type="button" class="dialog__add" @click="addIdentifier">＋ 添加</button>
          </h3>
          <div v-for="(identifier, index) in draft.identifiers" :key="index" class="rows__item">
            <select v-model="identifier.scheme" class="field__input field__input--scheme">
              <option v-for="scheme in IDENTIFIER_SCHEMES" :key="scheme" :value="scheme">
                {{ schemeText(scheme) }}
              </option>
            </select>
            <input v-model="identifier.value" class="field__input" type="text" placeholder="标识符值" />
            <button type="button" class="dialog__remove" aria-label="删除" @click="removeIdentifier(index)">
              ×
            </button>
          </div>
          <p v-if="draft.identifiers.length === 0" class="dialog__empty">暂无标识符</p>
        </section>

        <section class="dialog__section">
          <h3 class="dialog__section-title">
            古籍著录（扩展键值）
            <button type="button" class="dialog__add" @click="addExtra">＋ 添加</button>
          </h3>
          <div v-for="(entry, index) in draft.extra" :key="index" class="rows__item">
            <input v-model="entry.key" class="field__input" type="text" placeholder="键（如 binding）" />
            <input v-model="entry.value" class="field__input" type="text" placeholder="值" />
            <button type="button" class="dialog__remove" aria-label="删除" @click="removeExtra(index)">
              ×
            </button>
          </div>
          <p v-if="draft.extra.length === 0" class="dialog__empty">暂无扩展字段</p>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 遮罩：与 sheet / 抽屉同层级与同遮罩色，保证浮层之间不打架 */
.dialog {
  position: fixed;
  inset: 0;
  z-index: var(--ui-z-sheet, 40);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--ui-space-6, 20px);
  background: rgb(18 16 12 / 44%);
  backdrop-filter: blur(3px);
}

.dialog__panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 560px;
  max-height: 80vh;
  overflow: hidden;
  color: var(--ui-text, #3c3a34);
  background: var(--ui-surface-raised, #faf8f4);
  border: var(--ui-border-width, 1px) solid var(--ui-border, #e2ddd2);
  border-radius: var(--ui-radius-lg, 16px);
  box-shadow: var(--ui-shadow-3, 0 14px 40px rgb(0 0 0 / 20%));
}

.dialog__header {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--ui-space-2, 6px);
  padding: var(--ui-space-3, 8px) var(--ui-space-4, 12px);
  border-block-end: 1px solid var(--ui-divider, #d8d2c4);
  background: var(--ui-surface, #f4f0e8);
}

.dialog__title {
  flex: 1;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  font-size: var(--ui-font-lg, 15px);
  font-weight: 600;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.dialog__header-actions {
  display: flex;
  align-items: center;
  gap: var(--ui-space-1, 4px);
}

.dialog__action {
  padding: 5px 12px;
  min-height: 32px;
  font-size: var(--ui-font-md, 13px);
  color: var(--ui-text, #3c3a34);
  background: var(--ui-surface-raised, #faf8f4);
  border: var(--ui-border-width, 1px) solid var(--ui-border, #e2ddd2);
  border-radius: var(--ui-radius-pill, 999px);
  cursor: pointer;
  transition:
    background var(--ui-dur-fast, 120ms) var(--ui-ease, ease),
    color var(--ui-dur-fast, 120ms) var(--ui-ease, ease),
    border-color var(--ui-dur-fast, 120ms) var(--ui-ease, ease);
}

.dialog__action:hover {
  border-color: var(--ui-accent, #8c5a2b);
  color: var(--ui-accent, #8c5a2b);
}

.dialog__action--primary {
  color: var(--ui-on-accent, #fff);
  background: var(--ui-accent, #8c5a2b);
  border-color: var(--ui-accent, #8c5a2b);
}

.dialog__action--primary:hover {
  color: var(--ui-on-accent, #fff);
  background: var(--ui-accent-strong, #734721);
}

/* 关闭：桌面排在末尾（右上角 ×），H5 靠到左侧 */
.dialog__close {
  order: 3;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  font-size: 18px;
  line-height: 1;
  color: var(--ui-text-muted, #7f7a6d);
  background: none;
  border: 0;
  border-radius: var(--ui-radius-sm, 8px);
  cursor: pointer;
  transition:
    background var(--ui-dur-fast, 120ms) var(--ui-ease, ease),
    color var(--ui-dur-fast, 120ms) var(--ui-ease, ease);
}

.dialog__close:hover {
  color: var(--ui-accent, #8c5a2b);
  background: var(--ui-surface-sunken, #e8e1d3);
}

/* 返回箭头只在 H5 出现 */
.dialog__close-back {
  display: none;
}

.dialog__body {
  flex: 1;
  min-height: 0;
  padding: var(--ui-space-3, 8px) var(--ui-space-5, 20px) var(--ui-space-5, 20px);
  overflow-y: auto;
}

.dialog__section {
  margin-block-start: var(--ui-space-4, 12px);
  padding: var(--ui-space-3, 8px) var(--ui-space-4, 12px);
  background: var(--ui-surface-sunken, #e8e1d3);
  border-radius: var(--ui-radius-md, 12px);
}

.dialog__section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 0 0 var(--ui-space-2, 6px);
  font-size: var(--ui-font-xs, 11px);
  font-weight: 600;
  letter-spacing: 0.18em;
  color: var(--ui-accent, #8c5a2b);
}

.dialog__row {
  display: flex;
  gap: var(--ui-space-4, 12px);
  padding: 3px 0;
  font-size: var(--ui-font-md, 13px);
  line-height: 1.6;
}

.dialog__label {
  flex: none;
  width: 72px;
  color: var(--ui-text-muted, #7f7a6d);
}

.dialog__value {
  flex: 1;
  min-width: 0;
  overflow-wrap: break-word;
}

.dialog__add {
  padding: 1px 8px;
  font-size: var(--ui-font-xs, 11px);
  letter-spacing: 0;
  color: var(--ui-accent, #8c5a2b);
  background: none;
  border: 1px solid var(--ui-border, #e2ddd2);
  border-radius: var(--ui-radius-pill, 999px);
  cursor: pointer;
}

.dialog__add:hover {
  background: var(--ui-accent-weak, rgb(140 90 43 / 12%));
}

.dialog__empty {
  margin: 4px 0;
  font-size: var(--ui-font-sm, 12px);
  color: var(--ui-text-muted, #7f7a6d);
}

/* 表单控件 */
.field {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-block: var(--ui-space-2, 6px);
}

.field__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 var(--ui-space-4, 12px);
}

.field__label {
  font-size: var(--ui-font-sm, 12px);
  color: var(--ui-text-muted, #7f7a6d);
}

.field__input {
  min-height: 34px;
  padding: 5px var(--ui-space-2, 6px);
  font-size: var(--ui-font-md, 13px);
  color: var(--ui-text, #3c3a34);
  background: var(--ui-surface-raised, #faf8f4);
  border: var(--ui-border-width, 1px) solid var(--ui-border, #e2ddd2);
  border-radius: var(--ui-radius-sm, 8px);
  transition: border-color var(--ui-dur-fast, 120ms) var(--ui-ease, ease);
}

.field__input:hover {
  border-color: var(--ui-accent, #8c5a2b);
}

.field__input:focus {
  border-color: var(--ui-accent, #8c5a2b);
  outline: none;
}

.field__input--scheme {
  flex: none;
  width: 96px;
}

.rows__item {
  display: flex;
  gap: var(--ui-space-2, 6px);
  align-items: center;
  margin-block: 4px;
}

.rows__item .field__input {
  flex: 1;
  min-width: 0;
}

.dialog__remove {
  flex: none;
  width: 28px;
  height: 28px;
  font-size: 15px;
  line-height: 1;
  color: var(--ui-text-muted, #7f7a6d);
  background: none;
  border: 1px solid var(--ui-border, #e2ddd2);
  border-radius: var(--ui-radius-sm, 8px);
  cursor: pointer;
}

.dialog__remove:hover {
  color: var(--ui-danger, #c0392b);
  border-color: var(--ui-danger, #c0392b);
  background: var(--ui-danger-weak, rgb(192 57 43 / 12%));
}

/*
 * H5（C2 + 美化 P2）：窄屏模态转全屏页
 *
 * 遮罩去内边距、面板撑满视口并去圆角；标题栏走三列网格（左 44px 返回、
 * 中标题真居中、右 44px 占位），动作组整行换到第二行横向滑动，
 * 避免 375px 下四个胶囊按钮挤成一堆；表单双列收成单列，底部避开 Home 指示条。
 */
@media (max-width: 767px) {
  .dialog {
    align-items: stretch;
    padding: 0;
  }

  .dialog__panel {
    max-width: none;
    max-height: none;
    height: 100%;
    border: none;
    border-radius: 0;
    box-shadow: none;
    padding-block-end: env(safe-area-inset-bottom, 0px);
  }

  .dialog__header {
    display: grid;
    grid-template-columns: var(--bt-touch-target, 44px) 1fr var(--bt-touch-target, 44px);
    align-items: center;
    gap: var(--ui-space-1, 4px) var(--ui-space-2, 6px);
    min-height: 56px;
    padding: var(--ui-space-2, 6px) var(--ui-space-3, 8px);
    padding-block-start: calc(var(--ui-space-2, 6px) + var(--bt-safe-top, 0px));
  }

  .dialog__close {
    grid-column: 1;
    grid-row: 1;
    order: 0;
    width: var(--bt-touch-target, 44px);
    height: var(--bt-touch-target, 44px);
  }

  .dialog__close-back {
    display: block;
  }

  .dialog__close-cross {
    display: none;
  }

  .dialog__title {
    grid-column: 2;
    grid-row: 1;
    flex: none;
    text-align: center;
  }

  .dialog__header-actions {
    grid-column: 1 / -1;
    grid-row: 2;
    justify-content: flex-end;
    padding-block-start: var(--ui-space-1, 4px);
    overflow-x: auto;
    overscroll-behavior-x: contain;
  }

  .dialog__action {
    min-height: 36px;
    white-space: nowrap;
  }

  .dialog__body {
    padding: var(--ui-space-3, 8px) var(--ui-space-4, 12px) var(--ui-space-5, 20px);
  }

  .field__grid {
    grid-template-columns: 1fr;
  }

  .field__input {
    min-height: 40px;
    font-size: 14px;
  }
}
</style>
