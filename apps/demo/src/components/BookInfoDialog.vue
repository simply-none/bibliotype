<script setup lang="ts">
/**
 * 书籍信息弹窗（Demo 组件）
 *
 * 展示书目元数据（BookMetadata）全量字段：
 * 基本信息 / 责任者 / 版本 / 出版 / 标识符 / 古籍著录（extra 中文标签映射）/
 * 记录时间；遮罩点击、关闭按钮或 Esc 关闭。
 */
import { computed } from 'vue';
import type { BookMetadata, Contributor } from '@bibliotype/core';

const props = defineProps<{ metadata: BookMetadata }>();
const emit = defineEmits<{ close: [] }>();

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

const contributors = computed<readonly Contributor[]>(() => props.metadata.contributors ?? []);
const identifiers = computed(() => props.metadata.identifiers ?? []);
const extraEntries = computed(() =>
  Object.entries(props.metadata.extra ?? {}).map(([key, value]) => ({
    label: EXTRA_LABELS[key] ?? key,
    value: String(value),
  })),
);

/** 版本性质展示文案 */
const editionKindText = computed(() => {
  const kind = props.metadata.edition?.kind;
  if (kind === 'base') return '底本';
  if (kind === 'variant') return '校本';
  return '';
});

/** 责任者行文："魏　何晏　集解"（缺项自动省略） */
function contributorText(contributor: Contributor): string {
  return [contributor.dynasty, contributor.name, contributor.role]
    .filter((part) => part !== undefined && part !== '')
    .join('　');
}

/** 标识符 scheme 展示名 */
function schemeText(scheme: string): string {
  return SCHEME_LABELS[scheme] ?? scheme.toUpperCase();
}

/** 时间戳展示（字符串直出 / 数字按本地时间） */
function formatTimestamp(value: unknown): string {
  if (typeof value === 'number') return new Date(value).toLocaleString();
  return String(value);
}

const createdAt = computed(() => props.metadata.createdAt);
const updatedAt = computed(() => props.metadata.updatedAt);
</script>

<template>
  <div class="dialog" role="dialog" aria-modal="true" @click.self="emit('close')">
    <div class="dialog__panel">
      <header class="dialog__header">
        <h2 class="dialog__title">书籍信息</h2>
        <button type="button" class="dialog__close" aria-label="关闭" @click="emit('close')">
          ×
        </button>
      </header>

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
          <div v-for="entry in extraEntries" :key="entry.label" class="dialog__row">
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
    </div>
  </div>
</template>

<style scoped>
.dialog {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(24, 21, 16, 0.45);
}

.dialog__panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 560px;
  max-height: 80vh;
  overflow: hidden;
  color: var(--demo-text, #3c3a34);
  background: var(--demo-panel, #f4f0e8);
  border: 1px solid var(--demo-border, #e2ddd2);
  border-radius: 8px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
}

.dialog__header {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-block-end: 1px solid var(--demo-border, #e2ddd2);
}

.dialog__title {
  margin: 0;
  font-size: 15px;
  letter-spacing: 0.15em;
}

.dialog__close {
  width: 28px;
  height: 28px;
  font-size: 18px;
  line-height: 1;
  color: inherit;
  background: none;
  border: 0;
  border-radius: 4px;
  cursor: pointer;
}

.dialog__close:hover {
  background: rgba(127, 127, 127, 0.15);
}

.dialog__body {
  flex: 1;
  min-height: 0;
  padding: 8px 16px 16px;
  overflow-y: auto;
}

.dialog__section {
  margin-block-start: 14px;
}

.dialog__section-title {
  margin: 0 0 6px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.2em;
  color: var(--demo-accent, #8c5a2b);
}

.dialog__row {
  display: flex;
  gap: 12px;
  padding: 3px 0;
  font-size: 13px;
  line-height: 1.6;
}

.dialog__label {
  flex: none;
  width: 72px;
  color: var(--demo-muted, #8a8578);
}

.dialog__value {
  flex: 1;
  min-width: 0;
  overflow-wrap: break-word;
}
</style>
