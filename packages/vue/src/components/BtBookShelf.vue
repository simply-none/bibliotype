<script setup lang="ts">
/**
 * 书架（H3）
 *
 * 纯展示组件：网格 / 列表双视图、封面占位、进度条、标签筛选、检索框。
 * 数据与查询由 `useBookLibrary` 负责，本组件只发事件。
 */
import { ref } from 'vue';
import type { DocumentSortKey } from '@bibliotype/core';
import { SHELF_VIEW_MODES, type ShelfViewMode } from '../use-book-library.js';
import type { ShelfCard, TagFacet } from '../book-shelf-model.js';

const props = withDefaults(
  defineProps<{
    /** 当前页卡片 */
    cards: ShelfCard[];
    /** 命中总数 */
    total?: number;
    /** 标签筛选胶囊 */
    facets?: TagFacet[];
    /** 已选标签 */
    activeTags?: string[];
    /** 检索词 */
    search?: string;
    /** 视图模式 */
    viewMode?: ShelfViewMode;
    /** 当前排序键 */
    sortBy?: DocumentSortKey;
    /** 是否加载中 */
    loading?: boolean;
    /** 错误信息 */
    error?: string;
    /** 空库提示 */
    emptyHint?: string;
  }>(),
  {
    total: 0,
    facets: () => [],
    activeTags: () => [],
    search: '',
    viewMode: SHELF_VIEW_MODES.GRID,
    sortBy: 'recentRead',
    loading: false,
    error: '',
    emptyHint: '书架还是空的，导入第一本书开始整理。',
  },
);

const emit = defineEmits<{
  (event: 'search', text: string): void;
  (event: 'toggle-tag', tag: string): void;
  (event: 'update:view', mode: ShelfViewMode): void;
  (event: 'sort', sortBy: DocumentSortKey): void;
  (event: 'open', id: string): void;
  (event: 'import', bytes: Uint8Array): void;
  (event: 'export', id: string): void;
}>();

/** 排序选项 */
const SORT_OPTIONS: { value: DocumentSortKey; label: string }[] = [
  { value: 'recentRead', label: '最近阅读' },
  { value: 'updated', label: '更新时间' },
  { value: 'title', label: '书名' },
  { value: 'wordCount', label: '字数' },
];

const fileInput = ref<HTMLInputElement | null>(null);

function onSearchInput(event: Event): void {
  emit('search', (event.target as HTMLInputElement).value);
}

function onSortChange(event: Event): void {
  emit('sort', (event.target as HTMLSelectElement).value as DocumentSortKey);
}

async function onFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file === undefined) {
    return;
  }
  emit('import', new Uint8Array(await file.arrayBuffer()));
  input.value = '';
}

function pickFile(): void {
  fileInput.value?.click();
}
</script>

<template>
  <section class="shelf">
    <header class="shelf__toolbar">
      <div class="shelf__search">
        <input
          class="shelf__input"
          type="search"
          :value="props.search"
          placeholder="搜索书名、作者、ISBN、标签"
          aria-label="搜索书架"
          @input="onSearchInput"
        />
      </div>
      <div class="shelf__controls">
        <select class="shelf__select" :value="props.sortBy" aria-label="排序方式" @change="onSortChange">
          <option v-for="option in SORT_OPTIONS" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
        <div class="shelf__views" role="group" aria-label="视图切换">
          <button
            type="button"
            class="shelf__view"
            :class="{ 'shelf__view--active': props.viewMode === 'grid' }"
            aria-label="网格视图"
            @click="emit('update:view', 'grid')"
          >
            网格
          </button>
          <button
            type="button"
            class="shelf__view"
            :class="{ 'shelf__view--active': props.viewMode === 'list' }"
            aria-label="列表视图"
            @click="emit('update:view', 'list')"
          >
            列表
          </button>
        </div>
        <button type="button" class="shelf__primary" @click="pickFile">导入书档</button>
        <input ref="fileInput" class="shelf__file" type="file" accept=".btbook" @change="onFileChange" />
      </div>
    </header>

    <div v-if="props.facets.length > 0" class="shelf__tags">
      <button
        v-for="facet in props.facets"
        :key="facet.tag"
        type="button"
        class="shelf__tag"
        :class="{ 'shelf__tag--active': props.activeTags.includes(facet.tag) }"
        @click="emit('toggle-tag', facet.tag)"
      >
        {{ facet.tag }}<span class="shelf__tag-count">{{ facet.count }}</span>
      </button>
    </div>

    <p v-if="props.error" class="shelf__error">{{ props.error }}</p>

    <div v-if="props.loading" class="shelf__skeleton" aria-hidden="true">
      <span v-for="index in 6" :key="index" class="shelf__bone" />
    </div>

    <p v-else-if="props.cards.length === 0" class="shelf__empty">
      <span class="shelf__empty-mark">书</span>
      {{ props.emptyHint }}
    </p>

    <ul v-else class="shelf__list" :class="`shelf__list--${props.viewMode}`">
      <li v-for="card in props.cards" :key="card.id" class="shelf__item">
        <button type="button" class="card" @click="emit('open', card.id)">
          <span class="card__cover" :class="`card__cover--${props.viewMode}`">
            <img v-if="card.coverThumbnail" :src="card.coverThumbnail" :alt="`${card.title} 封面`" />
            <span v-else class="card__glyph">{{ card.glyph }}</span>
          </span>
          <span class="card__body">
            <span class="card__title">{{ card.title }}</span>
            <span class="card__meta">{{ card.metaText }}</span>
            <span class="card__tags">
              <span v-for="tag in card.tags" :key="tag" class="card__tag">{{ tag }}</span>
            </span>
            <span class="card__progress">
              <span class="card__bar"><span class="card__bar-fill" :style="{ width: card.progressText }" /></span>
              <span class="card__progress-text">{{ card.progressText }} · {{ card.recentText }}</span>
            </span>
          </span>
        </button>
        <button type="button" class="card__export" @click="emit('export', card.id)">导出</button>
      </li>
    </ul>

    <footer class="shelf__footer">
      <span>共 {{ props.total }} 本</span>
      <span v-if="props.activeTags.length > 0">已筛选：{{ props.activeTags.join('、') }}</span>
    </footer>
  </section>
</template>

<style scoped>
.shelf {
  --paper: #f7f3ea;
  --paper-raised: #fffdf8;
  --ink: #1f1b16;
  --ink-soft: #5c5348;
  --ink-muted: #8a8073;
  --line: #e4dbc9;
  --accent: #8c2f1f;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  background: var(--paper);
  color: var(--ink);
  font-size: 13px;
}
.shelf__toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
}
.shelf__search {
  flex: 1 1 260px;
  min-width: 200px;
}
.shelf__input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--paper-raised);
  color: var(--ink);
  font: inherit;
  outline: none;
}
.shelf__input:focus-visible {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(140, 47, 31, 0.14);
}
.shelf__controls {
  display: flex;
  gap: 8px;
  align-items: center;
}
.shelf__select {
  padding: 7px 8px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--paper-raised);
  color: var(--ink);
  font: inherit;
}
.shelf__views {
  display: inline-flex;
  border: 1px solid var(--line);
  border-radius: 6px;
  overflow: hidden;
}
.shelf__view {
  padding: 7px 10px;
  border: 0;
  background: transparent;
  color: var(--ink-soft);
  cursor: pointer;
  font: inherit;
}
.shelf__view--active {
  background: rgba(140, 47, 31, 0.08);
  color: var(--accent);
}
.shelf__primary {
  padding: 7px 14px;
  border: 1px solid var(--accent);
  border-radius: 6px;
  background: var(--accent);
  color: #fffdf8;
  cursor: pointer;
  font: inherit;
}
.shelf__primary:hover {
  background: #a8442f;
}
.shelf__file {
  display: none;
}
.shelf__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.shelf__tag {
  padding: 4px 10px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: transparent;
  color: var(--ink-soft);
  cursor: pointer;
  font: inherit;
}
.shelf__tag--active {
  border-color: var(--accent);
  color: var(--accent);
}
.shelf__tag-count {
  margin-left: 6px;
  color: var(--ink-muted);
  font-size: 11px;
}
.shelf__error {
  margin: 0;
  padding: 8px 10px;
  border-left: 3px solid #a33a2a;
  background: rgba(163, 58, 42, 0.06);
  color: #a33a2a;
}
.shelf__skeleton {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
  gap: 12px;
}
.shelf__bone {
  height: 196px;
  border-radius: 8px;
  background: linear-gradient(90deg, #ede6d8, #f7f3ea, #ede6d8);
  background-size: 200% 100%;
  animation: shelf-shimmer 1.4s ease-in-out infinite;
}
@keyframes shelf-shimmer {
  from {
    background-position: 0% 0;
  }
  to {
    background-position: -200% 0;
  }
}
.shelf__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  margin: 40px 0;
  color: var(--ink-muted);
}
.shelf__empty-mark {
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  border: 1px dashed var(--line);
  border-radius: 50%;
  color: var(--accent);
  font-size: 22px;
}
.shelf__list {
  display: grid;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.shelf__list--grid {
  grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
}
.shelf__list--list {
  grid-template-columns: 1fr;
}
.shelf__item {
  position: relative;
}
.card {
  display: flex;
  gap: 12px;
  width: 100%;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--paper-raised);
  color: inherit;
  cursor: pointer;
  font: inherit;
  text-align: left;
  transition: transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 180ms ease;
}
.card:hover,
.card:focus-visible {
  transform: translateY(-2px);
  box-shadow: 0 6px 18px rgba(31, 27, 22, 0.08);
  outline: none;
}
.shelf__list--grid .card {
  flex-direction: column;
}
.card__cover {
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 6px;
  background: linear-gradient(160deg, #ede6d8, #e0d5bf);
  color: var(--accent);
}
.card__cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.card__cover--grid {
  aspect-ratio: 3 / 4;
  width: 100%;
}
.card__cover--list {
  width: 48px;
  height: 64px;
  flex: 0 0 48px;
}
.card__glyph {
  font-size: 26px;
  font-weight: 600;
  letter-spacing: 0.1em;
}
.card__body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  flex: 1;
}
.card__title {
  overflow: hidden;
  color: var(--ink);
  font-size: 14px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card__meta {
  color: var(--ink-soft);
  font-size: 12px;
}
.card__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.card__tag {
  padding: 1px 6px;
  border-radius: 3px;
  background: rgba(140, 47, 31, 0.07);
  color: var(--accent);
  font-size: 11px;
}
.card__progress {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: auto;
}
.card__bar {
  display: block;
  height: 3px;
  border-radius: 999px;
  background: #ede6d8;
  overflow: hidden;
}
.card__bar-fill {
  display: block;
  height: 100%;
  background: var(--accent);
  transition: width 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.card__progress-text {
  color: var(--ink-muted);
  font-size: 11px;
}
.card__export {
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 2px 8px;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: rgba(255, 253, 248, 0.92);
  color: var(--ink-soft);
  cursor: pointer;
  font-size: 11px;
  opacity: 0;
  transition: opacity 160ms ease;
}
.shelf__item:hover .card__export,
.card__export:focus-visible {
  opacity: 1;
}
.shelf__footer {
  display: flex;
  gap: 12px;
  justify-content: space-between;
  color: var(--ink-muted);
  font-size: 12px;
}
@media (max-width: 767px) {
  .shelf__list--grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .card__export {
    opacity: 1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .card,
  .card__bar-fill,
  .shelf__bone {
    transition: none;
    animation: none;
  }
}
</style>
