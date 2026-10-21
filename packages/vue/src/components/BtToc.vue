<script setup lang="ts">
/**
 * 目录（BtToc）
 *
 * 阅读器目录面板：当前章高亮（随翻页滚动定位）、节点折叠（可受控记忆）、
 * 目录内搜索（过滤 + 命中高亮 + 自动展开父级）、可选缩略图。
 *
 * 状态边界：折叠集合与搜索词可受控（`expandedKeys` + `update:expandedKeys`），
 * 持久化交给宿主——库内不写 localStorage，保持 SSR 与可测性。
 */
import { computed, ref } from 'vue';
import type { OutlineItem, Reader } from '@bibliotype/reader';
import { useTocView } from '../use-toc-view.js';
import BtTocItem from './BtTocItem.vue';

const props = withDefaults(
  defineProps<{
    /** 阅读器实例 */
    reader: Reader;
    /** 已展开键集合（受控；配合 `update:expandedKeys` 做记忆） */
    expandedKeys?: readonly string[];
    /** 缩略图映射：目录键 → 图片地址 / dataURL */
    thumbnails?: Readonly<Record<string, string>>;
    /** 是否显示缩略图列 */
    showThumbnails?: boolean;
    /** 搜索框占位文案；传空串隐藏搜索框 */
    searchPlaceholder?: string;
    /** 无目录文案 */
    emptyText?: string;
    /** 是否显示「全部展开 / 全部收起」工具条 */
    showExpandControls?: boolean;
  }>(),
  {
    showThumbnails: false,
    searchPlaceholder: '搜索目录',
    emptyText: '暂无目录',
    showExpandControls: true,
  },
);

const emit = defineEmits<{
  (event: 'select', item: OutlineItem): void;
  (event: 'update:expandedKeys', keys: string[]): void;
}>();

const query = ref('');
/** 未受控时的内部折叠集合（父组件未绑定 expandedKeys 时生效） */
const innerExpanded = ref<readonly string[] | undefined>(props.expandedKeys);
const expandedModel = computed(() => props.expandedKeys ?? innerExpanded.value);

const toc = useTocView({
  reader: props.reader,
  expandedKeys: () => expandedModel.value,
  onExpandedKeysChange: (keys) => {
    innerExpanded.value = keys;
    emit('update:expandedKeys', keys);
  },
  query: () => query.value,
});

const rows = toc.rows;
const isEmpty = toc.isEmpty;

/** 滚动容器交给组合式做活动项定位（不逐行注册 ref） */
function setScrollHost(element: unknown): void {
  toc.attachContainer(element instanceof Element ? element : null);
}

/** 点击目录项：跳页并上报（无 nodeId 的项仅上报） */
function handleSelect(item: OutlineItem): void {
  if (item.nodeId !== undefined) {
    props.reader.goToNode(item.nodeId);
  }
  emit('select', item);
}
</script>

<template>
  <nav class="bt-toc" aria-label="目录">
    <div v-if="searchPlaceholder" class="bt-toc__search">
      <input
        v-model="query"
        type="search"
        class="bt-toc__search-input"
        :placeholder="searchPlaceholder"
        :aria-label="searchPlaceholder"
        @keydown.esc="query = ''"
      />
    </div>

    <div v-if="showExpandControls && !isEmpty" class="bt-toc__tools">
      <button type="button" class="bt-toc__tool" @click="toc.expandAll()">全部展开</button>
      <button type="button" class="bt-toc__tool" @click="toc.collapseAll()">全部收起</button>
    </div>

    <div :ref="setScrollHost" class="bt-toc__scroll">
      <p v-if="isEmpty" class="bt-toc__empty" role="status">
        {{ query.trim() === '' ? emptyText : '无匹配目录项' }}
      </p>
      <ul v-else class="bt-toc__list">
        <BtTocItem
          v-for="row in rows"
          :key="row.key"
          mode="row"
          :item="row.item"
          :row-key="row.key"
          :depth="row.depth"
          :has-children="row.hasChildren"
          :expanded="row.expanded"
          :active="row.active"
          :matched="row.matched"
          :query="query"
          :thumbnail="thumbnails?.[row.key]"
          :show-thumbnail="showThumbnails"
          @select="handleSelect"
          @toggle="toc.toggle(row.key)"
        />
      </ul>
    </div>
  </nav>
</template>

<style>
/* 目录样式为跨组件共享（BtToc / BtTocItem 同一套 bt-toc 命名空间），
   以 bt- 前缀避免全局冲突 */
.bt-toc {
  display: flex;
  flex-direction: column;
  min-height: 0;
  font-size: 14px;
}

.bt-toc__search {
  padding: 6px 10px 8px;
}

.bt-toc__search-input {
  box-sizing: border-box;
  width: 100%;
  padding: 5px 9px;
  border: 1px solid rgba(127, 127, 127, 0.28);
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  outline: none;
}

.bt-toc__search-input:focus-visible {
  border-color: var(--bt-color-accent, #8c5a2b);
  box-shadow: 0 0 0 2px rgba(140, 90, 43, 0.18);
}

.bt-toc__tools {
  display: flex;
  gap: 10px;
  padding: 0 10px 6px;
}

.bt-toc__tool {
  padding: 0;
  border: 0;
  background: none;
  color: var(--bt-color-note-text, #6b6b6b);
  font-size: 12px;
  cursor: pointer;
}

.bt-toc__tool:hover {
  color: var(--bt-color-accent, #8c5a2b);
}

.bt-toc__scroll {
  min-height: 0;
  max-height: inherit;
  overflow-y: auto;
}

.bt-toc__empty {
  margin: 8px 10px;
  color: var(--bt-color-note-text, #6b6b6b);
  font-size: 13px;
}

.bt-toc__list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.bt-toc__row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-inline-end: 8px;
}

.bt-toc__item--active > .bt-toc__row {
  box-shadow: inset 3px 0 0 var(--bt-color-accent, #8c5a2b);
  background: rgba(140, 90, 43, 0.08);
}

.bt-toc__toggle {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 22px;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  cursor: pointer;
  opacity: 0.65;
}

.bt-toc__toggle:hover {
  opacity: 1;
}

.bt-toc__toggle--ghost {
  cursor: default;
  opacity: 0;
}

.bt-toc__arrow {
  width: 0;
  height: 0;
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  border-inline-start: 5px solid currentColor;
  transition: transform 160ms ease;
}

.bt-toc__toggle--open .bt-toc__arrow {
  transform: rotate(90deg);
}

.bt-toc__thumb-wrap {
  flex: none;
  display: inline-flex;
  width: 40px;
  height: 56px;
  margin-inline-end: 4px;
  overflow: hidden;
  border-radius: 4px;
}

.bt-toc__thumb {
  width: 40px;
  height: 56px;
  object-fit: cover;
  border-radius: 4px;
}

.bt-toc__thumb--placeholder {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background:
    linear-gradient(180deg, rgba(127, 127, 127, 0.14), rgba(127, 127, 127, 0.06)),
    repeating-linear-gradient(
      180deg,
      transparent 0 10px,
      rgba(127, 127, 127, 0.16) 10px 11px
    );
  color: var(--bt-color-note-text, #6b6b6b);
  font-size: 13px;
}

.bt-toc__link {
  display: block;
  flex: 1 1 auto;
  min-width: 0;
  padding: 6px 4px;
  border: 0;
  border-radius: 4px;
  background: none;
  color: inherit;
  font: inherit;
  text-align: start;
  cursor: pointer;
  overflow-wrap: anywhere;
}

.bt-toc__link:hover {
  background: rgba(127, 127, 127, 0.12);
}

.bt-toc__item--active > .bt-toc__row .bt-toc__link {
  font-weight: 600;
}

.bt-toc__hit {
  border-radius: 2px;
  background: rgba(201, 162, 39, 0.32);
}

@media (prefers-reduced-motion: reduce) {
  .bt-toc__arrow {
    transition: none;
  }
}
</style>
