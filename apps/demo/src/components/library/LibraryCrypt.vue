<script setup lang="ts">
/**
 * 加密页签（H5）：开关加密 / 会话解锁 / 封存与读取加密稿 / 脱敏选项
 *
 * 由 `LibraryDrawer` 容器按页签挂载；只持有加密局部忙态，加密状态本身来自
 * 容器单实例下传的 `api.crypt`（reactive），事件经容器向上转发。
 */
import { BtEncryptionPanel } from '@bibliotype/vue';
import type { BookDocument, RedactOptions } from '@bibliotype/core';
import { ref } from 'vue';
import type { DemoLibraryApi } from '../../composables/use-demo-library.js';

const props = defineProps<{
  /** 书库 API（容器单实例下传） */
  api: DemoLibraryApi;
  /** 当前文档（加密保存用） */
  document: BookDocument;
}>();

const emit = defineEmits<{
  (event: 'open-book', document: BookDocument): void;
  (event: 'notify', message: string): void;
}>();

const cryptBusy = ref(false);

async function enableEncryption(password: string): Promise<void> {
  cryptBusy.value = true;
  try {
    await props.api.enableEncryption(password);
    if (props.api.crypt.enabled) {
      emit('notify', '已开启加密，请记住口令（无法找回）');
    }
  } finally {
    cryptBusy.value = false;
  }
}

async function unlockEncryption(password: string): Promise<void> {
  cryptBusy.value = true;
  try {
    await props.api.unlockEncryption(password);
    if (props.api.crypt.unlocked) {
      emit('notify', '本次会话已解锁');
    }
  } finally {
    cryptBusy.value = false;
  }
}

function disableEncryption(): void {
  props.api.disableEncryption();
  emit('notify', '已关闭加密并清除本机密钥记录');
}

async function sealDraft(): Promise<void> {
  await props.api.sealDraft(props.document);
  emit('notify', '当前文档已加密保存到本机');
}

async function openSealed(): Promise<void> {
  const document = await props.api.openSealedDraft();
  if (document === undefined) {
    emit('notify', '没有找到加密稿');
    return;
  }
  emit('open-book', document);
}

function updateRedact(next: RedactOptions): void {
  Object.assign(props.api.redact, next);
}
</script>

<template>
  <BtEncryptionPanel
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
  <div class="drawer__row">
    <button type="button" class="drawer__ghost" :disabled="!api.crypt.unlocked" @click="sealDraft">
      加密保存当前文档
    </button>
    <button type="button" class="drawer__ghost" :disabled="!api.crypt.unlocked" @click="openSealed">
      读取加密稿
    </button>
  </div>
</template>

<style scoped>
.drawer__row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ui-space-2, 6px);
  align-items: center;
  padding: var(--ui-space-4, 12px) var(--ui-space-5, 20px);
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
@media (max-width: 767px) {
  .drawer__ghost {
    min-height: 44px;
  }
}
</style>
