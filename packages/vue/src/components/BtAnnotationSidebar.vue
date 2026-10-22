<script setup lang="ts">
/**
 * 标注侧栏（书签 / 高亮 / 笔记 / 评论）
 *
 * 纯展示 + 事件转发：数据来自 `useAnnotations` 的 `model`（按章分组），
 * 所有写操作（定位 / 删除 / 解决 / 回复）均通过 emit 上抛，由宿主决定如何落地。
 * 正文内高亮装饰不在本组件范围（D9）。
 */
import { computed, ref } from 'vue';
import type { Anchor } from '@bibliotype/core';
import type { SidebarChapter } from '../annotation-model.js';

const props = defineProps<{
  /** 按章节分组的标注模型（来自 useAnnotations().model） */
  model: readonly SidebarChapter[];
  /** 只读（隐藏删除 / 回复 / 解决） */
  readonly?: boolean;
}>();

const emit = defineEmits<{
  (event: 'locate', anchor: Anchor): void;
  (event: 'remove', id: string): void;
  (event: 'resolve', payload: { id: string; resolved: boolean }): void;
  (event: 'reply', payload: { id: string; body: string }): void;
}>();

type Filter = 'all' | 'bookmark' | 'highlight' | 'note' | 'comment';
const filters: { key: Filter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'bookmark', label: '书签' },
  { key: 'highlight', label: '高亮' },
  { key: 'note', label: '笔记' },
  { key: 'comment', label: '评论' },
];
const active = ref<Filter>('all');

const chapters = computed(() =>
  props.model.map((chapter) => ({
    ...chapter,
    items: chapter.items.filter((item) => active.value === 'all' || item.kind === active.value),
  })),
);

function onLocate(anchor: Anchor): void {
  emit('locate', anchor);
}
function onRemove(id: string): void {
  emit('remove', id);
}
function onResolve(id: string, resolved: boolean): void {
  emit('resolve', { id, resolved: !resolved });
}
function onReply(id: string, body: string): void {
  const trimmed = body.trim();
  if (trimmed === '') return;
  emit('reply', { id, body: trimmed });
}
</script>

<template>
  <aside class="bt-annotation-sidebar">
    <div class="bt-annotation-sidebar__tabs">
      <button
        v-for="tab in filters"
        :key="tab.key"
        type="button"
        class="bt-annotation-sidebar__tab"
        :class="{ 'bt-annotation-sidebar__tab--active': active === tab.key }"
        @click="active = tab.key"
      >
        {{ tab.label }}
      </button>
    </div>

    <div class="bt-annotation-sidebar__body">
      <p v-if="chapters.length === 0" class="bt-annotation-sidebar__empty">暂无标注</p>
      <section
        v-for="chapter in chapters"
        :key="chapter.id"
        class="bt-annotation-sidebar__chapter"
      >
        <h4 class="bt-annotation-sidebar__chapter-title">{{ chapter.title }}</h4>
        <ul class="bt-annotation-sidebar__list">
          <li v-for="item in chapter.items" :key="item.id" class="bt-annotation-sidebar__item">
            <div class="bt-annotation-sidebar__item-head">
              <button type="button" class="bt-annotation-sidebar__locate" @click="onLocate(item.anchor)">
                {{ item.label || '（空标注）' }}
              </button>
              <span class="bt-annotation-sidebar__kind" :data-kind="item.kind">{{
                item.kind
              }}</span>
            </div>

            <div v-if="item.kind === 'comment' && item.comments?.length" class="bt-annotation-sidebar__thread">
              <p v-for="c in item.comments" :key="c.id" class="bt-annotation-sidebar__comment">
                <strong>{{ c.author?.name ?? c.author?.id ?? '匿名' }}</strong
                >：{{ c.body }}
              </p>
              <label v-if="!readonly" class="bt-annotation-sidebar__reply">
                <input
                  type="text"
                  placeholder="回复…"
                  @keyup.enter="onReply(item.id, ($event.target as HTMLInputElement).value); ($event.target as HTMLInputElement).value = ''"
                />
              </label>
              <button
                v-if="!readonly"
                type="button"
                class="bt-annotation-sidebar__resolve"
                @click="onResolve(item.id, item.resolved ?? false)"
              >
                {{ item.resolved ? '取消解决' : '标记解决' }}
              </button>
            </div>

            <button
              v-if="!readonly"
              type="button"
              class="bt-annotation-sidebar__remove"
              @click="onRemove(item.id)"
            >
              删除
            </button>
          </li>
        </ul>
      </section>
    </div>
  </aside>
</template>

<style scoped>
.bt-annotation-sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  font-size: 14px;
}
.bt-annotation-sidebar__tabs {
  display: flex;
  gap: 4px;
  padding: 4px;
  border-bottom: 1px solid #e0e0e0;
}
.bt-annotation-sidebar__tab {
  border: none;
  background: transparent;
  padding: 4px 8px;
  cursor: pointer;
  border-radius: 4px;
}
.bt-annotation-sidebar__tab--active {
  background: #eef3ff;
}
.bt-annotation-sidebar__body {
  flex: 1;
  overflow: auto;
  padding: 8px;
}
.bt-annotation-sidebar__chapter-title {
  font-size: 13px;
  opacity: 0.7;
  margin: 8px 0 4px;
}
.bt-annotation-sidebar__list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.bt-annotation-sidebar__item {
  border: 1px solid #eee;
  border-radius: 6px;
  padding: 6px;
  margin-bottom: 6px;
}
.bt-annotation-sidebar__locate {
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  padding: 0;
  flex: 1;
}
.bt-annotation-sidebar__kind {
  font-size: 11px;
  opacity: 0.5;
}
.bt-annotation-sidebar__thread {
  margin-top: 4px;
}
.bt-annotation-sidebar__comment {
  margin: 2px 0;
}
.bt-annotation-sidebar__reply input {
  width: 100%;
  box-sizing: border-box;
}

/* H5（C1）：抽屉内铺满宽度 + 触控目标 ≥44px */
@media (max-width: 767px) {
  .bt-annotation-sidebar {
    width: 100%;
  }
}

@media (pointer: coarse) {
  .bt-annotation-sidebar__tab,
  .bt-annotation-sidebar__locate,
  .bt-annotation-sidebar button {
    min-height: var(--bt-touch-target, 44px);
  }
  .bt-annotation-sidebar__reply input {
    min-height: var(--bt-touch-target, 44px);
  }
}
</style>
