<script setup lang="ts">
/**
 * 书籍信息查看态
 *
 * 展示书目元数据（BookMetadata）全量字段：基本信息 / 责任者 / 版本 / 古籍著录
 * （四部、版本类型、藏地、索书号）/ 出版 / 标识符 / 扩展键值（extra）/ 记录时间。
 * 派生数据在本组件内计算，格式化经 `catalog-export` 纯函数，不含编辑逻辑。
 */
import { computed } from 'vue';
import {
  CLASSICAL_DIVISIONS,
  EDITION_TYPES,
  type BookMetadata,
  type Contributor,
} from '@bibliotype/core';
import { contributorText, formatTimestamp, schemeText } from '../catalog-export.js';

const props = defineProps<{ metadata: BookMetadata }>();

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

const createdAt = computed(() => props.metadata.createdAt);
const updatedAt = computed(() => props.metadata.updatedAt);
</script>

<template>
  <div class="dialog__body">
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
</template>

<style scoped>
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

@media (max-width: 767px) {
  .dialog__body {
    padding: var(--ui-space-3, 8px) var(--ui-space-4, 12px) var(--ui-space-5, 20px);
  }
}
</style>
