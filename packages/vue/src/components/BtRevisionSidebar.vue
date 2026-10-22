<script setup lang="ts">
/**
 * 修订侧栏（C5）
 *
 * 三段视图切换（标记 / 终稿 / 原稿）+ 类型色条 + 单条 / 全部接受拒绝。
 * 条目点击发 `locate`，由宿主滚动定位到正文对应位置。
 */
import type { RevisionView } from '@bibliotype/core';
import { revisionCountsText, type RevisionSidebarModel } from '../revision-model.js';

const props = withDefaults(
  defineProps<{
    /** 侧栏模型（由 `buildRevisionModel` 生成） */
    model: RevisionSidebarModel;
    /** 当前视图 */
    view?: RevisionView;
    /** 修订模式是否开启 */
    enabled?: boolean;
    /** 当前操作者 */
    author?: string;
  }>(),
  {
    view: 'marked',
    enabled: false,
    author: '',
  },
);

const emit = defineEmits<{
  (event: 'set-mode', enabled: boolean): void;
  (event: 'set-view', view: RevisionView): void;
  (event: 'accept', changeId: string): void;
  (event: 'reject', changeId: string): void;
  (event: 'accept-all'): void;
  (event: 'reject-all'): void;
  (event: 'locate', path: string): void;
}>();

/** 视图选项 */
const VIEW_OPTIONS: { value: RevisionView; label: string }[] = [
  { value: 'marked', label: '标记' },
  { value: 'final', label: '终稿' },
  { value: 'original', label: '原稿' },
];


</script>

<template>
  <aside class="rev">
    <header class="rev__head">
      <label class="rev__switch">
        <input
          type="checkbox"
          :checked="props.enabled"
          @change="emit('set-mode', ($event.target as HTMLInputElement).checked)"
        />
        <span>修订模式</span>
      </label>
      <div class="rev__views" role="group" aria-label="修订视图">
        <button
          v-for="option in VIEW_OPTIONS"
          :key="option.value"
          type="button"
          class="rev__view"
          :class="{ 'rev__view--active': props.view === option.value }"
          @click="emit('set-view', option.value)"
        >
          {{ option.label }}
        </button>
      </div>
    </header>

    <p class="rev__counts">{{ revisionCountsText(props.model.counts) }}</p>

    <p v-if="props.model.empty" class="rev__empty">暂无修订记录。开启修订模式后，改稿会在这里逐条留痕。</p>

    <ul v-else class="rev__list">
      <li v-for="item in props.model.items" :key="`${item.changeId}-${item.path}`" class="rev__item">
        <button type="button" class="rev__entry" @click="emit('locate', item.path)">
          <span class="rev__bar" :class="`rev__bar--${item.type}`" aria-hidden="true" />
          <span class="rev__body">
            <span class="rev__top">
              <span class="rev__type">{{ item.typeLabel }}</span>
              <span class="rev__who">{{ item.authorText }} · {{ item.timeText }}</span>
            </span>
            <span class="rev__excerpt">{{ item.excerpt }}</span>
          </span>
        </button>
        <span class="rev__actions">
          <button type="button" class="rev__action rev__action--ok" @click="emit('accept', item.changeId)">接受</button>
          <button type="button" class="rev__action" @click="emit('reject', item.changeId)">拒绝</button>
        </span>
      </li>
    </ul>

    <footer class="rev__footer">
      <button type="button" class="rev__all rev__all--ok" :disabled="props.model.empty" @click="emit('accept-all')">
        全部接受
      </button>
      <button type="button" class="rev__all" :disabled="props.model.empty" @click="emit('reject-all')">
        全部拒绝
      </button>
    </footer>
  </aside>
</template>

<style scoped>
.rev {
  --paper: #fffdf8;
  --ink: #1f1b16;
  --ink-soft: #5c5348;
  --ink-muted: #8a8073;
  --line: #e4dbc9;
  --accent: #8c2f1f;
  display: flex;
  flex-direction: column;
  width: 320px;
  max-width: 100%;
  height: 100%;
  background: var(--paper);
  color: var(--ink);
  font-size: 13px;
}
.rev__head {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--line);
}
.rev__switch {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  color: var(--ink-soft);
  cursor: pointer;
}
.rev__views {
  display: inline-flex;
  border: 1px solid var(--line);
  border-radius: 6px;
  overflow: hidden;
}
.rev__view {
  padding: 4px 9px;
  border: 0;
  background: transparent;
  color: var(--ink-soft);
  cursor: pointer;
  font: inherit;
}
.rev__view--active {
  background: rgba(140, 47, 31, 0.08);
  color: var(--accent);
}
.rev__counts {
  margin: 0;
  padding: 8px 12px 0;
  color: var(--ink-muted);
  font-size: 12px;
}
.rev__empty {
  margin: 16px 12px;
  color: var(--ink-muted);
  line-height: 1.7;
}
.rev__list {
  flex: 1;
  margin: 0;
  padding: 8px 8px 12px;
  overflow-y: auto;
  list-style: none;
}
.rev__item {
  display: flex;
  gap: 6px;
  align-items: flex-start;
  padding: 6px 4px;
  border-bottom: 1px dashed var(--line);
}
.rev__entry {
  display: flex;
  flex: 1;
  gap: 8px;
  padding: 4px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  text-align: left;
}
.rev__entry:hover,
.rev__entry:focus-visible {
  background: rgba(140, 47, 31, 0.05);
  outline: none;
}
.rev__bar {
  flex: 0 0 3px;
  align-self: stretch;
  border-radius: 2px;
}
.rev__bar--insertion {
  background: #2f6b4f;
}
.rev__bar--deletion {
  background: #a33a2a;
}
.rev__bar--format-change {
  background: #b07a21;
}
.rev__body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.rev__top {
  display: flex;
  gap: 8px;
  align-items: baseline;
}
.rev__type {
  font-weight: 600;
}
.rev__who {
  color: var(--ink-muted);
  font-size: 11px;
}
.rev__excerpt {
  overflow: hidden;
  color: var(--ink-soft);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rev__actions {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.rev__action {
  padding: 2px 8px;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: transparent;
  color: var(--ink-soft);
  cursor: pointer;
  font-size: 11px;
}
.rev__action--ok {
  border-color: rgba(47, 107, 79, 0.4);
  color: #2f6b4f;
}
.rev__footer {
  display: flex;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid var(--line);
}
.rev__all {
  flex: 1;
  padding: 7px 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: transparent;
  color: var(--ink-soft);
  cursor: pointer;
  font: inherit;
}
.rev__all--ok {
  border-color: var(--accent);
  color: var(--accent);
}
.rev__all:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
@media (max-width: 767px) {
  .rev {
    width: 100%;
  }
}

/* H5（C1）：抽屉内铺满高度 + 触控目标 ≥44px */
@media (pointer: coarse) {
  .rev button,
  .rev__view,
  .rev__switch {
    min-height: var(--bt-touch-target, 44px);
  }
}
</style>
