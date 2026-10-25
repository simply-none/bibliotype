<script setup lang="ts">
/**
 * 标注面板（Demo 组件，左栏 tab 面板）
 *
 * 用 `BtAnnotationSidebar` 替换旧的页级书签面板：书签 / 高亮 / 笔记 / 评论
 * 四类标注按章分组，本地用 localStorage 持久化（仅 Demo 私有用，不进库）。
 * 书签以「当前页首个块」为锚点；笔记 / 评论以选区或当前页首块为锚点。
 */
import { computed, onMounted } from 'vue';
import { createBlockAnchor, type BookDocument, type Anchor } from '@bibliotype/core';
import {
  ANNOTATION_SCHEMA_VERSION,
  type AnnotationSet,
  type AnnotationStorage,
} from '@bibliotype/annotation';
import { BtAnnotationSidebar, useAnnotations, useReaderBinding } from '@bibliotype/vue';
import type { Reader } from '@bibliotype/reader';
import { host } from '../host/index.js';

const props = defineProps<{
  /** 阅读器实例 */
  reader: Reader;
  /** 当前文档（用于锚点解析与章节分组） */
  document: BookDocument;
  /** 图书标识（本地存储键） */
  bookId: string;
}>();

const emit = defineEmits<{ (event: 'close'): void }>();

/** Demo 用 localStorage 标注存储（实现 AnnotationStorage 端口；键经宿主包装防碰撞） */
const storageKey = computed(() => host.storageKey(`bt-demo:annotations:${props.bookId}`));
const storage: AnnotationStorage = {
  name: 'demo-localstorage',
  async loadAnnotations(bookId: string): Promise<AnnotationSet | undefined> {
    void bookId;
    const raw = localStorage.getItem(storageKey.value);
    if (raw === null) return undefined;
    try {
      return JSON.parse(raw) as AnnotationSet;
    } catch {
      return undefined;
    }
  },
  async saveAnnotations(bookId: string, set: AnnotationSet): Promise<void> {
    void bookId;
    localStorage.setItem(storageKey.value, JSON.stringify(set));
  },
  async clearAnnotations(bookId: string): Promise<void> {
    void bookId;
    localStorage.removeItem(storageKey.value);
  },
};

const { currentPage } = useReaderBinding(props.reader);

function anchorOfCurrentPage(): Anchor | null {
  const nodes = props.reader.getPageNodes(currentPage.value);
  const first = nodes[0];
  return first?.id !== undefined ? createBlockAnchor(first.id) : null;
}

const annotations = useAnnotations({
  bookId: props.bookId,
  document: computed(() => props.document),
  store: storage,
  getSelectionAnchor: anchorOfCurrentPage,
  locate: (anchor) => {
    props.reader.goToNode(anchor.nodeId);
  },
});

onMounted(() => {
  void annotations.load();
});

async function addBookmark(): Promise<void> {
  await annotations.create('bookmark', `第 ${currentPage.value + 1} 页`);
}

async function addNote(): Promise<void> {
  const body = window.prompt('笔记内容（取消则不添加）');
  if (body !== null && body.trim() !== '') {
    await annotations.create('note', body);
  }
}

async function addComment(): Promise<void> {
  const body = window.prompt('评论内容（取消则不添加）');
  if (body !== null && body.trim() !== '') {
    await annotations.create('comment', body);
  }
}
</script>

<template>
  <div class="panel">
    <div class="panel__head">
      <h3 class="panel__title">标注</h3>
      <button type="button" class="panel__close" aria-label="关闭" @click="emit('close')">×</button>
    </div>

    <div class="panel__actions">
      <button type="button" @click="addBookmark">＋ 书签</button>
      <button type="button" @click="addNote">＋ 笔记</button>
      <button type="button" @click="addComment">＋ 评论</button>
    </div>

    <BtAnnotationSidebar
      :model="annotations.model.value"
      @locate="annotations.locate"
      @remove="annotations.remove"
      @resolve="(payload) => annotations.resolveComment(payload.id, payload.resolved)"
      @reply="(payload) => annotations.reply(payload.id, payload.body)"
    />
  </div>
</template>

<style scoped>
/* 侧栏面板统一制式（美化 P3）：分组标题 11px 字距 0.18em，动作按钮胶囊化 */
.panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  color: var(--ui-text, #3c3a34);
}
.panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--ui-space-3, 8px) var(--ui-space-4, 12px);
  border-block-end: 1px solid var(--ui-divider, #d8d2c4);
}
.panel__title {
  margin: 0;
  font-size: var(--ui-font-xs, 11px);
  font-weight: 600;
  letter-spacing: 0.18em;
  color: var(--ui-text-muted, #7f7a6d);
}
.panel__close {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--ui-radius-sm, 8px);
  background: transparent;
  color: var(--ui-text-muted, #7f7a6d);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  transition:
    background var(--ui-dur-fast, 120ms) var(--ui-ease, ease),
    color var(--ui-dur-fast, 120ms) var(--ui-ease, ease);
}
.panel__close:hover {
  color: var(--ui-accent, #8c5a2b);
  background: var(--ui-surface-sunken, rgba(127, 127, 127, 0.15));
}
.panel__actions {
  display: flex;
  gap: var(--ui-space-1, 4px);
  padding: var(--ui-space-3, 8px) var(--ui-space-4, 12px);
}
.panel__actions button {
  min-height: 32px;
  padding: 4px 12px;
  font-size: var(--ui-font-sm, 12px);
  color: var(--ui-accent, #8c5a2b);
  background: var(--ui-accent-weak, rgba(140, 90, 43, 0.12));
  border: var(--ui-border-width, 1px) solid transparent;
  border-radius: var(--ui-radius-pill, 999px);
  cursor: pointer;
  transition:
    background var(--ui-dur-fast, 120ms) var(--ui-ease, ease),
    border-color var(--ui-dur-fast, 120ms) var(--ui-ease, ease);
}
.panel__actions button:hover {
  border-color: var(--ui-accent, #8c5a2b);
}
@media (pointer: coarse) {
  .panel__actions button {
    min-height: 40px;
  }
}
</style>
