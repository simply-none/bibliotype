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

const props = defineProps<{
  /** 阅读器实例 */
  reader: Reader;
  /** 当前文档（用于锚点解析与章节分组） */
  document: BookDocument;
  /** 图书标识（本地存储键） */
  bookId: string;
}>();

const emit = defineEmits<{ (event: 'close'): void }>();

/** Demo 用 localStorage 标注存储（实现 AnnotationStorage 端口） */
const storageKey = computed(() => `bt-demo:annotations:${props.bookId}`);
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
      <button type="button" class="panel__close" @click="emit('close')">×</button>
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
.panel {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px;
}
.panel__title {
  margin: 0;
  font-size: 14px;
}
.panel__close {
  border: none;
  background: transparent;
  font-size: 18px;
  cursor: pointer;
}
.panel__actions {
  display: flex;
  gap: 4px;
  padding: 0 8px 8px;
}
</style>
