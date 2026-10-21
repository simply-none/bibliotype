<script setup lang="ts">
/**
 * 书库抽屉（demo 宿主容器）
 *
 * 五个页签：书架（H3）/ 备份（H4）/ 加密（H5）/ 修订（C5）/ 版本（C7）。
 * 所有业务能力来自 `useDemoLibrary` 与 `@bibliotype/vue` 的组件，本组件只做编排。
 */
import {
  BtBackupPanel,
  BtBookShelf,
  BtEncryptionPanel,
  BtRevisionSidebar,
  BtVersionHistory,
  buildDiffRows,
  buildRevisionModel,
  buildVersionHistoryModel,
  diffSummaryText,
  type DiffRow,
} from '@bibliotype/vue';
import {
  collectRevisions,
  restoreSnapshot,
} from '@bibliotype/core';
import { DEMO_VALIDATE_OPTIONS } from '../ir-types.js';
import type {
  BackupConflictStrategy,
  BookDocument,
  DocumentDiff,
  DocumentSnapshotMeta,
  RedactOptions,
  RevisionView,
} from '@bibliotype/core';
import {
  acceptAllRevisions,
  acceptRevision,
  rejectAllRevisions,
  rejectRevision,
  setRevisionMode,
  type BookEditor,
} from '@bibliotype/editor';

import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { downloadBytes, useDemoLibrary } from '../composables/use-demo-library.js';

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
const api = useDemoLibrary();
const busy = ref(false);
const strategy = ref<BackupConflictStrategy>('merge');

/* ---------- 书架 ---------- */
const shelfImportError = ref('');

async function addCurrentToShelf(): Promise<void> {
  busy.value = true;
  try {
    await api.saveBook(props.document, 'demo-draft');
    emit('notify', `已加入书架：《${props.document.metadata.title}》`);
  } finally {
    busy.value = false;
  }
}

async function openFromShelf(id: string): Promise<void> {
  const document = await api.readBook(id);
  if (document === undefined) {
    emit('notify', '这本书已不在书库中，请刷新。');
    return;
  }
  await api.library.openBook(id);
  emit('open-book', document);
  emit('update:open', false);
}

async function exportFromShelf(id: string): Promise<void> {
  const result = await api.library.exportBook(id);
  downloadBytes(result.bytes, result.fileName);
  emit('notify', `已导出《${result.title}》`);
}

async function importToShelf(bytes: Uint8Array): Promise<void> {
  try {
    shelfImportError.value = '';
    const result = await api.library.importBook(bytes);
    emit('notify', `已导入《${result.title}》`);
  } catch (cause) {
    shelfImportError.value = cause instanceof Error ? cause.message : String(cause);
  }
}

/* ---------- 备份 ---------- */
async function exportLibrary(): Promise<void> {
  busy.value = true;
  try {
    await api.exportLibrary();
    emit('notify', '整库备份已导出');
  } finally {
    busy.value = false;
  }
}

async function restoreLibrary(bytes: Uint8Array, next: BackupConflictStrategy): Promise<void> {
  busy.value = true;
  try {
    await api.importLibrary(bytes, next);
    const result = api.lastRestore.value;
    emit('notify', `恢复完成：成功 ${result?.restored.length ?? 0} 本`);
  } catch (cause) {
    emit('notify', cause instanceof Error ? cause.message : String(cause));
  } finally {
    busy.value = false;
  }
}

/* ---------- 加密 ---------- */
const cryptBusy = ref(false);

async function enableEncryption(password: string): Promise<void> {
  cryptBusy.value = true;
  try {
    await api.enableEncryption(password);
    if (api.crypt.enabled) {
      emit('notify', '已开启加密，请记住口令（无法找回）');
    }
  } finally {
    cryptBusy.value = false;
  }
}

async function unlockEncryption(password: string): Promise<void> {
  cryptBusy.value = true;
  try {
    await api.unlockEncryption(password);
    if (api.crypt.unlocked) {
      emit('notify', '本次会话已解锁');
    }
  } finally {
    cryptBusy.value = false;
  }
}

function disableEncryption(): void {
  api.disableEncryption();
  emit('notify', '已关闭加密并清除本机密钥记录');
}

async function sealDraft(): Promise<void> {
  await api.sealDraft(props.document);
  emit('notify', '当前文档已加密保存到本机');
}

async function openSealed(): Promise<void> {
  const document = await api.openSealedDraft();
  if (document === undefined) {
    emit('notify', '没有找到加密稿');
    return;
  }
  emit('open-book', document);
}

function updateRedact(next: RedactOptions): void {
  Object.assign(api.redact, next);
}

/* ---------- 修订 ---------- */
const revisionEnabled = ref(false);
const revisionView = ref<RevisionView>('marked');
const revisionTick = ref(0);
let unsubscribeEditor: (() => void) | undefined;

watch(
  () => props.editor,
  (editor) => {
    unsubscribeEditor?.();
    if (editor != null) {
      unsubscribeEditor = editor.onChange(() => {
        revisionTick.value += 1;
      });
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => unsubscribeEditor?.());

const revisionModel = computed(() => {
  void revisionTick.value;
  const document = props.editor?.getDocument() ?? props.document;
  return buildRevisionModel(collectRevisions(document), { now: Date.now() });
});

function runEditorCommand(command: typeof acceptAllRevisions): void {
  const editor = props.editor;
  if (editor == null) {
    emit('notify', '请进入编辑模式后再处理修订');
    return;
  }
  command(editor.editorState, (tr) => editor.dispatch(tr));
  revisionTick.value += 1;
}

function toggleRevisionMode(enabled: boolean): void {
  revisionEnabled.value = enabled;
  runEditorCommand(setRevisionMode(enabled));
}

function setView(view: RevisionView): void {
  revisionView.value = view;
}

/* ---------- 版本 ---------- */
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
  versions.value = await api.listVersions('demo-draft');
}

async function createVersion(label: string): Promise<void> {
  await api.snapshot('demo-draft', props.editor?.getDocument() ?? props.document, label);
  await refreshVersions();
  emit('notify', '已记录一个版本');
}

async function selectVersion(version: number): Promise<void> {
  activeVersion.value = version;
  versionError.value = '';
  try {
    const snapshot = await api.loadVersion('demo-draft', version);
    if (snapshot === undefined) {
      return;
    }
    const diff: DocumentDiff | null = await api.compareVersions(
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
  const snapshot = await api.loadVersion('demo-draft', version);
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

async function ensureVersions(): Promise<void> {
  if (versions.value.length === 0) {
    await refreshVersions();
  }
}

watch(tab, (next) => {
  if (next === 'shelf') {
    void api.library.refresh();
  }
  if (next === 'version') {
    void ensureVersions();
  }
});

onMounted(() => {
  void api.library.refresh();
});
</script>

<template>
  <div v-if="props.open" class="drawer">
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
        <template v-if="tab === 'shelf'">
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

        <BtBackupPanel
          v-else-if="tab === 'backup'"
          :busy="busy"
          :progress="api.progress.value"
          :result="api.lastRestore.value"
          :strategy="strategy"
          @export="exportLibrary"
          @import="({ bytes, strategy: next }) => restoreLibrary(bytes, next)"
          @update:strategy="strategy = $event"
        />

        <BtEncryptionPanel
          v-else-if="tab === 'crypt'"
          :enabled="api.crypt.enabled"
          :unlocked="api.crypt.unlocked"
          :notes-locked="api.crypt.notesLocked"
          :busy="cryptBusy"
          :error="api.crypt.error"
          :redact="api.redact"
          @enable="enableEncryption"
          @unlock="unlockEncryption"
          @disable="disableEncryption"
          @toggle-notes="api.crypt.notesLocked = $event"
          @update:redact="updateRedact"
        />
        <div v-if="tab === 'crypt'" class="drawer__row">
          <button type="button" class="drawer__ghost" :disabled="!api.crypt.unlocked" @click="sealDraft">
            加密保存当前文档
          </button>
          <button type="button" class="drawer__ghost" :disabled="!api.crypt.unlocked" @click="openSealed">
            读取加密稿
          </button>
        </div>

        <BtRevisionSidebar
          v-else-if="tab === 'revision'"
          :model="revisionModel"
          :view="revisionView"
          :enabled="revisionEnabled"
          :author="'demo'"
          @set-mode="toggleRevisionMode"
          @set-view="setView"
          @accept="(changeId) => runEditorCommand(acceptRevision(changeId))"
          @reject="(changeId) => runEditorCommand(rejectRevision(changeId))"
          @accept-all="runEditorCommand(acceptAllRevisions)"
          @reject-all="runEditorCommand(rejectAllRevisions)"
          @locate="(path) => emit('notify', `修订位置：${path}`)"
        />

        <BtVersionHistory
          v-else
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
      </div>
    </section>
  </div>
</template>

<style scoped>
.drawer {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  justify-content: flex-end;
}
.drawer__mask {
  position: absolute;
  inset: 0;
  border: 0;
  background: rgba(31, 27, 22, 0.32);
  cursor: default;
}
.drawer__panel {
  position: relative;
  display: flex;
  flex-direction: column;
  width: min(760px, 100%);
  height: 100%;
  background: #fffdf8;
  box-shadow: -12px 0 32px rgba(31, 27, 22, 0.16);
  animation: drawer-in 200ms cubic-bezier(0.2, 0.8, 0.2, 1);
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
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid #e4dbc9;
}
.drawer__tabs {
  display: flex;
  gap: 4px;
}
.drawer__tab {
  padding: 6px 12px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  color: #5c5348;
  cursor: pointer;
  font: inherit;
}
.drawer__tab--active {
  border-color: #8c2f1f;
  color: #8c2f1f;
}
.drawer__close {
  width: 28px;
  height: 28px;
  border: 1px solid #e4dbc9;
  border-radius: 50%;
  background: transparent;
  color: #5c5348;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
}
.drawer__body {
  flex: 1;
  overflow-y: auto;
}
.drawer__row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  padding: 12px 16px;
}
.drawer__primary {
  padding: 8px 16px;
  border: 1px solid #8c2f1f;
  border-radius: 6px;
  background: #8c2f1f;
  color: #fffdf8;
  cursor: pointer;
  font: inherit;
}
.drawer__ghost {
  padding: 7px 14px;
  border: 1px solid #e4dbc9;
  border-radius: 6px;
  background: transparent;
  color: #5c5348;
  cursor: pointer;
  font: inherit;
}
.drawer__ghost:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
.drawer__error {
  margin: 0;
  color: #a33a2a;
  font-size: 12px;
}
@media (max-width: 767px) {
  .drawer__panel {
    width: 100%;
  }
  .drawer__tabs {
    overflow-x: auto;
  }
}
@media (prefers-reduced-motion: reduce) {
  .drawer__panel {
    animation: none;
  }
}
</style>
