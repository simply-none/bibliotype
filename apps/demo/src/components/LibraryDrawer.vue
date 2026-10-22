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
  useScrollLock,
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

onBeforeUnmount(() => {
  scrollLock.unlock();
  unsubscribeEditor?.();
});

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
/*
 * 视觉全部走 `--ui-*` 令牌（美化 P2）：以前写死 #fffdf8 / #8c2f1f 之类的纸色，
 * 皮肤切到墨色 / 素白时抽屉会跳回旧配色，现在跟着 <html data-skin> 走。
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
.drawer__ghost {
  min-height: 36px;
  padding: 7px 16px;
  border: var(--ui-border-width, 1px) solid var(--ui-border, #e2ddd2);
  border-radius: var(--ui-radius-pill, 999px);
  background: var(--ui-surface-raised, #faf8f4);
  color: var(--ui-text, #3c3a34);
  cursor: pointer;
  font: inherit;
  transition:
    color var(--ui-dur-fast, 120ms) var(--ui-ease, ease),
    border-color var(--ui-dur-fast, 120ms) var(--ui-ease, ease);
}
.drawer__ghost:hover:not(:disabled) {
  color: var(--ui-accent, #8c5a2b);
  border-color: var(--ui-accent, #8c5a2b);
}
.drawer__ghost:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
.drawer__error {
  margin: 0;
  color: var(--ui-danger, #c0392b);
  font-size: var(--ui-font-sm, 12px);
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
  .drawer__primary,
  .drawer__ghost {
    min-height: 44px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .drawer__panel {
    animation: none;
  }
}
</style>
