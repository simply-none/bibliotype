<script setup lang="ts">
/**
 * 书架页签（H3）：当前文档加入书架、打开 / 导出 / 导入
 *
 * 由 `LibraryDrawer` 容器按页签挂载；`api` 由容器单实例下传，
 * 本组件只持有书架局部状态（导入错误 / 局部忙态），事件经容器向上转发。
 */
import { BtBookShelf } from '@bibliotype/vue';
import {
  normalizeGlyphImages,
  summarizeGlyphImageReport,
  type BookDocument,
} from '@bibliotype/core';
import { onMounted, ref } from 'vue';
import { downloadBytes, type DemoLibraryApi } from '../../composables/use-demo-library.js';

const props = defineProps<{
  /** 书库 API（容器单实例下传） */
  api: DemoLibraryApi;
  /** 当前文档（加入书架用） */
  document: BookDocument;
}>();

const emit = defineEmits<{
  (event: 'update:open', open: boolean): void;
  (event: 'open-book', document: BookDocument): void;
  (event: 'notify', message: string): void;
}>();

const busy = ref(false);
const shelfImportError = ref('');

async function addCurrentToShelf(): Promise<void> {
  busy.value = true;
  try {
    await props.api.saveBook(props.document, 'demo-draft');
    emit('notify', `已加入书架：《${props.document.metadata.title}》`);
  } finally {
    busy.value = false;
  }
}

async function openFromShelf(id: string): Promise<void> {
  const loaded = await props.api.readBook(id);
  if (loaded === undefined) {
    emit('notify', '这本书已不在书库中，请刷新。');
    return;
  }
  /* 字图归一化（K6 补口）：旧版导入的存量书可能仍把缺字图存成块级插图，
   * 打开时自动归并——发现可归并的字图即回写书库，一次修复永久生效 */
  const { document, report } = normalizeGlyphImages(loaded);
  if (report.merged.length > 0) {
    await props.api.saveBook(document, id);
    emit('notify', `《${document.metadata.title}》${summarizeGlyphImageReport(report)}`);
  }
  await props.api.library.openBook(id);
  emit('open-book', document);
  emit('update:open', false);
}

async function exportFromShelf(id: string): Promise<void> {
  const result = await props.api.library.exportBook(id);
  const write = downloadBytes(result.bytes, result.fileName);
  /* 桌面宿主落盘失败 / 带路径：如实反馈（Web 侧恒成功且无路径） */
  if (!write.ok) {
    emit('notify', `《${result.title}》导出失败：${write.error ?? '未知原因'}`);
    return;
  }
  emit(
    'notify',
    write.path === undefined ? `已导出《${result.title}》` : `已导出《${result.title}》：${write.path}`,
  );
}

async function importToShelf(bytes: Uint8Array): Promise<void> {
  try {
    shelfImportError.value = '';
    const result = await props.api.library.importBook(bytes);
    emit('notify', `已导入《${result.title}》`);
  } catch (cause) {
    shelfImportError.value = cause instanceof Error ? cause.message : String(cause);
  }
}

onMounted(() => {
  void props.api.library.refresh();
});
</script>

<template>
  <div class="drawer__row">
    <button type="button" class="drawer__primary" :disabled="busy" @click="addCurrentToShelf">
      将当前文档加入书架
    </button>
    <p v-if="shelfImportError" class="drawer__error">{{ shelfImportError }}</p>
  </div>
  <BtBookShelf
    :cards="api.library.cards.value"
    :total="api.library.total.value"
    :facets="api.library.facets.value"
    :active-tags="api.library.activeTags.value"
    :search="api.library.search.value"
    :view-mode="api.library.viewMode.value"
    :sort-by="api.library.sortBy.value"
    :loading="api.library.loading.value"
    :error="api.library.error.value"
    :empty-hint="api.library.emptyHint.value"
    @search="api.library.setSearch"
    @toggle-tag="api.library.toggleTag"
    @update:view="api.library.setView"
    @sort="api.library.setSort"
    @open="openFromShelf"
    @export="exportFromShelf"
    @import="importToShelf"
  />
</template>

<style scoped>
.drawer__row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ui-space-2, 6px);
  align-items: center;
  padding: var(--ui-space-4, 12px) var(--ui-space-5, 20px);
}
.drawer__primary {
  min-height: 36px;
  padding: 8px 18px;
  border: var(--ui-border-width, 1px) solid var(--ui-accent, #8c5a2b);
  border-radius: var(--ui-radius-pill, 999px);
  background: var(--ui-accent, #8c5a2b);
  color: var(--ui-on-accent, #fff);
  cursor: pointer;
  font: inherit;
  transition:
    background var(--ui-dur-fast, 120ms) var(--ui-ease, ease),
    transform var(--ui-dur-fast, 120ms) var(--ui-ease, ease);
}
.drawer__primary:active:not(:disabled) {
  transform: scale(0.97);
}
.drawer__primary:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
.drawer__error {
  margin: 0;
  color: var(--ui-danger, #c0392b);
  font-size: var(--ui-font-sm, 12px);
}
@media (max-width: 767px) {
  .drawer__primary {
    min-height: 44px;
  }
}
</style>
