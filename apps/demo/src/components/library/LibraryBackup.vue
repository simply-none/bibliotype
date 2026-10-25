<script setup lang="ts">
/**
 * 备份页签（H4）：整库导出 / 恢复（含冲突策略）
 *
 * 由 `LibraryDrawer` 容器按页签挂载；只持有备份局部状态（忙态 / 冲突策略），
 * 恢复结果经 `api.lastRestore` 回显，提示事件由容器向上转发。
 */
import { BtBackupPanel } from '@bibliotype/vue';
import type { BackupConflictStrategy } from '@bibliotype/core';
import { ref } from 'vue';
import type { DemoLibraryApi } from '../../composables/use-demo-library.js';

const props = defineProps<{
  /** 书库 API（容器单实例下传） */
  api: DemoLibraryApi;
}>();

const emit = defineEmits<{
  (event: 'notify', message: string): void;
}>();

const busy = ref(false);
const strategy = ref<BackupConflictStrategy>('merge');

async function exportLibrary(): Promise<void> {
  busy.value = true;
  try {
    const result = await props.api.exportLibrary();
    /* 桌面宿主会回传绝对路径；失败时把原因透出，不再无条件报「已导出」 */
    if (!result.ok) {
      emit('notify', `整库备份导出失败：${result.error ?? '未知原因'}`);
      return;
    }
    emit('notify', result.path === undefined ? '整库备份已导出' : `整库备份已导出：${result.path}`);
  } finally {
    busy.value = false;
  }
}

async function restoreLibrary(bytes: Uint8Array, next: BackupConflictStrategy): Promise<void> {
  busy.value = true;
  try {
    await props.api.importLibrary(bytes, next);
    const result = props.api.lastRestore.value;
    emit('notify', `恢复完成：成功 ${result?.restored.length ?? 0} 本`);
  } catch (cause) {
    emit('notify', cause instanceof Error ? cause.message : String(cause));
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <BtBackupPanel
    :busy="busy"
    :progress="api.progress.value"
    :result="api.lastRestore.value"
    :strategy="strategy"
    @export="exportLibrary"
    @import="({ bytes, strategy: next }) => restoreLibrary(bytes, next)"
    @update:strategy="strategy = $event"
  />
</template>
