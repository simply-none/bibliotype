<script setup lang="ts">
/**
 * 版本页签（C7）：快照记录 / 版本列表 / 对比 / 回滚
 *
 * 由 `LibraryDrawer` 容器按页签挂载；只持有版本相关状态（列表 / 选中 / 对比模式 /
 * diff 行 / 提示），回滚结果经 `open-book` 事件上抛，挂载时若列表为空则拉取一次。
 */
import {
  BtVersionHistory,
  buildDiffRows,
  buildVersionHistoryModel,
  diffSummaryText,
  type DiffRow,
} from '@bibliotype/vue';
import {
  restoreSnapshot,
  type BookDocument,
  type DocumentDiff,
  type DocumentSnapshotMeta,
} from '@bibliotype/core';
import { computed, onMounted, ref, shallowRef } from 'vue';
import { DEMO_VALIDATE_OPTIONS } from '../../ir-types.js';
import type { DemoLibraryApi } from '../../composables/use-demo-library.js';
import type { BookEditor } from '@bibliotype/editor';

const props = defineProps<{
  /** 书库 API（容器单实例下传） */
  api: DemoLibraryApi;
  /** 当前文档（快照 / 对比基准） */
  document: BookDocument;
  /** 编辑器实例（编辑态取其实时文档做快照 / 对比；阅读态为 null） */
  editor?: BookEditor | null;
}>();

const emit = defineEmits<{
  (event: 'open-book', document: BookDocument): void;
  (event: 'notify', message: string): void;
}>();

const busy = ref(false);
const versions = shallowRef<DocumentSnapshotMeta[]>([]);
const activeVersion = ref(0);
const compareMode = ref<'split' | 'inline'>('split');
const diffRows = ref<DiffRow[]>([]);
const summaryText = ref('');
const versionError = ref('');

const versionModel = computed(() =>
  buildVersionHistoryModel(versions.value, {
    now: Date.now(),
    activeVersion: activeVersion.value,
  }),
);

async function refreshVersions(): Promise<void> {
  versions.value = await props.api.listVersions('demo-draft');
}

async function createVersion(label: string): Promise<void> {
  await props.api.snapshot('demo-draft', props.editor?.getDocument() ?? props.document, label);
  await refreshVersions();
  emit('notify', '已记录一个版本');
}

async function selectVersion(version: number): Promise<void> {
  activeVersion.value = version;
  versionError.value = '';
  try {
    const snapshot = await props.api.loadVersion('demo-draft', version);
    if (snapshot === undefined) {
      return;
    }
    const diff: DocumentDiff | null = await props.api.compareVersions(
      'demo-draft',
      version,
      props.editor?.getDocument() ?? props.document,
    );
    if (diff === null) {
      return;
    }
    diffRows.value = buildDiffRows(diff);
    summaryText.value = diffSummaryText(diff);
  } catch (cause) {
    versionError.value = cause instanceof Error ? cause.message : String(cause);
  }
}

async function restoreVersion(version: number): Promise<void> {
  versionError.value = '';
  const snapshot = await props.api.loadVersion('demo-draft', version);
  if (snapshot === undefined) {
    return;
  }
  const restored = restoreSnapshot(snapshot, { validateOptions: DEMO_VALIDATE_OPTIONS });
  if (!restored.ok) {
    versionError.value = restored.message;
    return;
  }
  emit('open-book', restored.document);
  emit('notify', `已回滚到版本 ${version}`);
}

onMounted(() => {
  if (versions.value.length === 0) {
    void refreshVersions();
  }
});
</script>

<template>
  <BtVersionHistory
    :model="versionModel"
    :diff-rows="diffRows"
    :summary-text="summaryText"
    :compare-mode="compareMode"
    :active-version="activeVersion"
    :busy="busy"
    :error="versionError"
    @compare="selectVersion"
    @restore="restoreVersion"
    @create="createVersion"
    @update:compare-mode="compareMode = $event"
  />
</template>
