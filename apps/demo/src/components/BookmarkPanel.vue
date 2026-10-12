<script setup lang="ts">
/**
 * 书签面板（Demo 组件）
 *
 * 页级书签：localStorage（键 bt-demo:bookmarks:lunyu）持久化；
 * 「添加当前页」记录当前页（重复忽略）；书签项点击跳转（重排后页码越界
 * 收敛到末页），可删除。
 */
import { computed, ref, watch } from 'vue';
import { useReaderBinding } from '@bibliotype/vue';
import type { Reader } from '@bibliotype/reader';

/** 书签条目（page 自 0 起） */
interface BookmarkEntry {
  /** 页码（自 0 起） */
  page: number;
  /** 添加时间（毫秒时间戳） */
  at: number;
}

const STORAGE_KEY = 'bt-demo:bookmarks:lunyu';

/** 读取本地书签（损坏或缺项数据自动修复） */
function loadBookmarks(): BookmarkEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is BookmarkEntry =>
          typeof item === 'object' && item !== null && typeof (item as BookmarkEntry).page === 'number',
      )
      .map((item) => ({
        page: Math.max(0, Math.floor(item.page)),
        at: typeof item.at === 'number' ? item.at : 0,
      }));
  } catch {
    return [];
  }
}

const props = defineProps<{ reader: Reader }>();
const emit = defineEmits<{ close: [] }>();

const { currentPage, totalPages } = useReaderBinding(props.reader);
const bookmarks = ref<BookmarkEntry[]>(loadBookmarks());

watch(
  bookmarks,
  (value) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch {
      /* 隐私模式等存储不可用时忽略 */
    }
  },
  { deep: true },
);

/** 当前页是否已有书签 */
const currentBookmarked = computed(() =>
  bookmarks.value.some((entry) => entry.page === currentPage.value),
);

/** 添加当前页书签（重复忽略，按页码排序） */
function addCurrent(): void {
  if (currentBookmarked.value) return;
  const next = [...bookmarks.value, { page: currentPage.value, at: Date.now() }];
  next.sort((a, b) => a.page - b.page);
  bookmarks.value = next;
}

/** 删除书签 */
function remove(entry: BookmarkEntry): void {
  bookmarks.value = bookmarks.value.filter((item) => item !== entry);
}

/** 跳转到书签所在页（页码按当前总页数收敛） */
function jump(entry: BookmarkEntry): void {
  const target = Math.min(entry.page, Math.max(0, totalPages.value - 1));
  props.reader.goToPage(target);
}

/** 添加时间展示（月-日 时:分） */
function formatAt(at: number): string {
  if (at === 0) return '';
  const date = new Date(at);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
</script>

<template>
  <section class="panel">
    <header class="panel__header">
      <h2 class="panel__title">书签</h2>
      <button type="button" class="panel__close" aria-label="关闭" @click="emit('close')">
        ×
      </button>
    </header>

    <button
      type="button"
      class="panel__add"
      :disabled="currentBookmarked"
      @click="addCurrent"
    >
      {{ currentBookmarked ? '当前页已添加' : `＋ 添加第 ${currentPage + 1} 页` }}
    </button>

    <p v-if="bookmarks.length === 0" class="panel__empty">暂无书签</p>
    <ul v-else class="panel__list">
      <li
        v-for="entry in bookmarks"
        :key="`${entry.page}-${entry.at}`"
        class="panel__item"
      >
        <button type="button" class="panel__jump" @click="jump(entry)">
          <span class="panel__page">第 {{ entry.page + 1 }} 页</span>
          <span class="panel__time">{{ formatAt(entry.at) }}</span>
        </button>
        <button
          type="button"
          class="panel__remove"
          aria-label="删除书签"
          @click="remove(entry)"
        >
          ×
        </button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.panel {
  padding: 10px 12px 14px;
  border-block-end: 1px solid var(--demo-border, #e2ddd2);
}

.panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-block-end: 8px;
}

.panel__title {
  margin: 0;
  font-size: 13px;
  letter-spacing: 0.2em;
  color: var(--demo-text, #3c3a34);
}

.panel__close {
  width: 22px;
  height: 22px;
  font-size: 15px;
  line-height: 1;
  color: var(--demo-muted, #8a8578);
  background: none;
  border: 0;
  border-radius: 4px;
  cursor: pointer;
}

.panel__close:hover {
  background: rgba(127, 127, 127, 0.15);
}

.panel__add {
  width: 100%;
  padding: 6px 0;
  font-size: 13px;
  color: var(--demo-accent, #8c5a2b);
  background: none;
  border: 1px dashed var(--demo-accent, #8c5a2b);
  border-radius: 4px;
  cursor: pointer;
}

.panel__add:disabled {
  color: var(--demo-muted, #8a8578);
  border-color: var(--demo-control-border, #d8d2c4);
  cursor: default;
}

.panel__empty {
  margin: 10px 0 0;
  font-size: 12px;
  text-align: center;
  color: var(--demo-muted, #8a8578);
}

.panel__list {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
}

.panel__item {
  display: flex;
  align-items: center;
}

.panel__item + .panel__item {
  margin-block-start: 2px;
}

.panel__jump {
  display: flex;
  flex: 1;
  min-width: 0;
  align-items: baseline;
  gap: 8px;
  padding: 5px 8px;
  font: inherit;
  color: inherit;
  text-align: start;
  background: none;
  border: 0;
  border-radius: 4px;
  cursor: pointer;
}

.panel__jump:hover {
  background: rgba(127, 127, 127, 0.12);
}

.panel__page {
  font-size: 13px;
}

.panel__time {
  font-size: 11px;
  color: var(--demo-muted, #8a8578);
}

.panel__remove {
  flex: none;
  width: 22px;
  height: 22px;
  font-size: 14px;
  line-height: 1;
  color: var(--demo-muted, #8a8578);
  background: none;
  border: 0;
  border-radius: 4px;
  cursor: pointer;
}

.panel__remove:hover {
  color: #b4552d;
  background: rgba(127, 127, 127, 0.15);
}
</style>
