<script setup lang="ts">
/**
 * 书库抽屉（demo 宿主容器）
 *
 * 五个页签：书架（H3）/ 备份（H4）/ 加密（H5）/ 修订（C5）/ 版本（C7）。
 * 本容器只负责外壳（遮罩 / 面板 / 头部 / 页签 / 滚动锁）与 `useDemoLibrary`
 * 单实例下传；各页签业务与局部状态下沉到 `library/` 下五个子组件，按 `tab`
 * 互斥渲染（v-if 每次挂载即触发子组件 onMounted 的首屏刷新）。
 */
import { useScrollLock } from '@bibliotype/vue';
import type { BookDocument } from '@bibliotype/core';
import type { BookEditor } from '@bibliotype/editor';
import { onBeforeUnmount, ref, watch } from 'vue';
import { useDemoLibrary } from '../composables/use-demo-library.js';
import LibraryBackup from './library/LibraryBackup.vue';
import LibraryCrypt from './library/LibraryCrypt.vue';
import LibraryRevisions from './library/LibraryRevisions.vue';
import LibraryShelf from './library/LibraryShelf.vue';
import LibraryVersions from './library/LibraryVersions.vue';

const props = defineProps<{
  /** 是否展开 */
  open: boolean;
  /** 当前文档（加入书架 / 快照用） */
  document: BookDocument;
  /** 编辑器实例（修订 / 版本回滚用；阅读态为 null） */
  editor?: BookEditor | null;
}>();

const emit = defineEmits<{
  (event: 'update:open', open: boolean): void;
  (event: 'open-book', document: BookDocument): void;
  (event: 'notify', message: string): void;
}>();

/** 页签 */
const TABS = [
  { id: 'shelf', label: '书架' },
  { id: 'backup', label: '备份' },
  { id: 'crypt', label: '加密' },
  { id: 'revision', label: '修订' },
  { id: 'version', label: '版本' },
] as const;

type TabId = (typeof TABS)[number]['id'];

const tab = ref<TabId>('shelf');
/** 书库 API 单实例（下传子组件，避免多份 useDemoLibrary） */
const api = useDemoLibrary();

/* ---------- 滚动锁（D5） ---------- */

/** 抽屉打开时锁住背景滚动，关闭后还原滚动位置（与 BtDrawer 同一套实现） */
const scrollLock = useScrollLock();

watch(
  () => props.open,
  (open) => {
    if (open) scrollLock.lock();
    else scrollLock.unlock();
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  scrollLock.unlock();
});
</script>

<template>
  <div v-if="props.open" class="drawer" data-open="true" data-side="end">
    <button type="button" class="drawer__mask" aria-label="关闭书库" @click="emit('update:open', false)" />
    <section class="drawer__panel" role="dialog" aria-label="书库">
      <header class="drawer__head">
        <nav class="drawer__tabs" aria-label="书库页签">
          <button
            v-for="item in TABS"
            :key="item.id"
            type="button"
            class="drawer__tab"
            :class="{ 'drawer__tab--active': tab === item.id }"
            @click="tab = item.id"
          >
            {{ item.label }}
          </button>
        </nav>
        <button type="button" class="drawer__close" aria-label="关闭" @click="emit('update:open', false)">×</button>
      </header>

      <div class="drawer__body">
        <LibraryShelf
          v-if="tab === 'shelf'"
          :api="api"
          :document="document"
          @open-book="emit('open-book', $event)"
          @update:open="emit('update:open', $event)"
          @notify="emit('notify', $event)"
        />
        <LibraryBackup
          v-else-if="tab === 'backup'"
          :api="api"
          @notify="emit('notify', $event)"
        />
        <LibraryCrypt
          v-else-if="tab === 'crypt'"
          :api="api"
          :document="document"
          @open-book="emit('open-book', $event)"
          @notify="emit('notify', $event)"
        />
        <LibraryRevisions
          v-else-if="tab === 'revision'"
          :document="document"
          :editor="editor"
          @notify="emit('notify', $event)"
        />
        <LibraryVersions
          v-else
          :api="api"
          :document="document"
          :editor="editor"
          @open-book="emit('open-book', $event)"
          @notify="emit('notify', $event)"
        />
      </div>
    </section>
  </div>
</template>

<style scoped>
/*
 * 视觉全部走 `--ui-*` 令牌（美化 P2）：以前写死 #fffdf8 / #8c2f1f 之类的纸色，
 * 皮肤切到墨色 / 素白时抽屉会跳回旧配色，现在跟着 <html data-skin> 走。
 * 外壳样式留容器，页签内行/按钮样式随模板迁入各子组件（互斥渲染，scoped 隔离）。
 */
.drawer {
  position: fixed;
  inset: 0;
  z-index: calc(var(--ui-z-sheet, 40) + 10);
  display: flex;
  justify-content: flex-end;
}
.drawer__mask {
  position: absolute;
  inset: 0;
  border: 0;
  background: var(--bt-drawer-mask, rgb(18 16 12 / 44%));
  cursor: default;
}
.drawer__panel {
  position: relative;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: min(760px, 100%);
  height: 100%;
  /* 安全区（D3）：右侧与底部避开刘海 / Home 指示条 */
  padding-inline-end: env(safe-area-inset-right, 0px);
  padding-block-end: env(safe-area-inset-bottom, 0px);
  color: var(--ui-text, #3c3a34);
  background: var(--ui-surface-raised, #faf8f4);
  border-inline-start: var(--ui-border-width, 1px) solid var(--ui-border, #e2ddd2);
  box-shadow: var(--bt-drawer-shadow, var(--ui-shadow-3, 0 14px 40px rgb(0 0 0 / 20%)));
  animation: drawer-in var(--ui-dur-base, 200ms) var(--ui-ease, cubic-bezier(0.2, 0.8, 0.2, 1));
}
@keyframes drawer-in {
  from {
    transform: translateX(24px);
    opacity: 0;
  }
  to {
    transform: none;
    opacity: 1;
  }
}
.drawer__head {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: var(--ui-space-2, 6px);
  min-height: var(--ui-bar-h, 48px);
  padding: var(--ui-space-2, 6px) var(--ui-space-4, 12px);
  border-block-end: 1px solid var(--ui-divider, #d8d2c4);
  background: var(--ui-surface, #f4f0e8);
}
.drawer__tabs {
  display: flex;
  gap: var(--ui-space-1, 4px);
}
.drawer__tab {
  min-height: 34px;
  padding: 6px 14px;
  border: var(--ui-border-width, 1px) solid transparent;
  border-radius: var(--ui-radius-pill, 999px);
  background: transparent;
  color: var(--ui-text-muted, #7f7a6d);
  cursor: pointer;
  font: inherit;
  transition:
    background var(--ui-dur-fast, 120ms) var(--ui-ease, ease),
    color var(--ui-dur-fast, 120ms) var(--ui-ease, ease),
    border-color var(--ui-dur-fast, 120ms) var(--ui-ease, ease);
}
.drawer__tab:hover {
  color: var(--ui-accent, #8c5a2b);
  background: var(--ui-accent-weak, rgb(140 90 43 / 12%));
}
.drawer__tab--active {
  border-color: var(--ui-accent, #8c5a2b);
  color: var(--ui-accent, #8c5a2b);
  background: var(--ui-accent-weak, rgb(140 90 43 / 12%));
  font-weight: 600;
}
.drawer__close {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: var(--ui-radius-sm, 8px);
  background: transparent;
  color: var(--ui-text-muted, #7f7a6d);
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  transition:
    background var(--ui-dur-fast, 120ms) var(--ui-ease, ease),
    color var(--ui-dur-fast, 120ms) var(--ui-ease, ease);
}
.drawer__close:hover {
  color: var(--ui-accent, #8c5a2b);
  background: var(--ui-surface-sunken, #e8e1d3);
}
.drawer__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
@media (max-width: 767px) {
  .drawer__panel {
    width: 100%;
    border-inline-start: none;
  }
  /* 标题栏计入刘海安全区，页签拥挤时整行横滑 */
  .drawer__head {
    min-height: 56px;
    padding-block-start: calc(var(--ui-space-2, 6px) + var(--bt-safe-top, 0px));
  }
  .drawer__close {
    width: var(--bt-touch-target, 44px);
    height: var(--bt-touch-target, 44px);
  }
  .drawer__tabs {
    overflow-x: auto;
    overscroll-behavior-x: contain;
  }
  .drawer__tab {
    min-height: var(--bt-touch-target, 44px);
    white-space: nowrap;
  }
}
@media (prefers-reduced-motion: reduce) {
  .drawer__panel {
    animation: none;
  }
}
</style>
