<script setup lang="ts">
/**
 * 备份 / 迁移面板（H4）
 *
 * 三段式冲突策略 + 常驻后果说明 + 逐书进度 + 失败清单（可折叠）。
 * 解压与写盘由宿主完成，本组件只发 `export` / `import` 事件。
 */
import { computed, ref } from 'vue';
import type { BackupConflictStrategy, LibraryRestoreResult } from '@bibliotype/core';

const props = withDefaults(
  defineProps<{
    /** 是否正在执行 */
    busy?: boolean;
    /** 进度（恢复时逐书回调） */
    progress?: { current: number; total: number; title?: string } | null;
    /** 最近一次恢复结果 */
    result?: LibraryRestoreResult | null;
    /** 当前冲突策略 */
    strategy?: BackupConflictStrategy;
  }>(),
  {
    busy: false,
    progress: null,
    result: null,
    strategy: 'merge',
  },
);

const emit = defineEmits<{
  (event: 'export'): void;
  (event: 'import', payload: { bytes: Uint8Array; strategy: BackupConflictStrategy }): void;
  (event: 'update:strategy', strategy: BackupConflictStrategy): void;
}>();

/** 策略选项与后果说明 */
const STRATEGIES: { value: BackupConflictStrategy; label: string; hint: string }[] = [
  { value: 'merge', label: '合并', hint: '同 id 时保留更新时间较新的一份，旧的那份不动。' },
  { value: 'overwrite', label: '覆盖', hint: '同 id 时以备份内容为准，本地较新的改动会被替换。' },
  { value: 'keep-both', label: '保留双份', hint: '同 id 时导入件另存为「副本」，两份都留下。' },
];

const fileInput = ref<HTMLInputElement | null>(null);
const showFailures = ref(false);

const activeHint = computed(
  () => STRATEGIES.find((item) => item.value === props.strategy)?.hint ?? '',
);
const percent = computed(() => {
  const progress = props.progress;
  if (progress === null || progress.total <= 0) {
    return 0;
  }
  return Math.round((progress.current / progress.total) * 100);
});
const hasFailures = computed(() => (props.result?.failures.length ?? 0) > 0);

function pickFile(): void {
  fileInput.value?.click();
}

async function onFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file !== undefined) {
    emit('import', { bytes: new Uint8Array(await file.arrayBuffer()), strategy: props.strategy });
  }
  input.value = '';
}
</script>

<template>
  <section class="backup">
    <header class="backup__head">
      <h3 class="backup__title">整库备份</h3>
      <p class="backup__sub">导出书目、正文、样式与设置；恢复时逐本校验，坏包跳过并列出原因。</p>
    </header>

    <div class="backup__actions">
      <button type="button" class="backup__primary" :disabled="props.busy" @click="emit('export')">
        导出整库
      </button>
      <button type="button" class="backup__ghost" :disabled="props.busy" @click="pickFile">
        从备份恢复
      </button>
      <input ref="fileInput" class="backup__file" type="file" accept=".zip,.btlibrary" @change="onFileChange" />
    </div>

    <fieldset class="backup__strategies">
      <legend class="backup__legend">冲突处理</legend>
      <label
        v-for="item in STRATEGIES"
        :key="item.value"
        class="backup__option"
        :class="{ 'backup__option--active': props.strategy === item.value }"
      >
        <input
          type="radio"
          name="backup-strategy"
          :value="item.value"
          :checked="props.strategy === item.value"
          @change="emit('update:strategy', item.value)"
        />
        <span>{{ item.label }}</span>
      </label>
    </fieldset>
    <p class="backup__hint">{{ activeHint }}</p>

    <div v-if="props.busy" class="backup__progress">
      <p class="backup__status">
        当前 {{ props.progress?.current ?? 0 }}/{{ props.progress?.total ?? 0 }}
        <template v-if="props.progress?.title"> · 正在处理《{{ props.progress.title }}》</template>
      </p>
      <span class="backup__bar"><span class="backup__bar-fill" :style="{ width: `${percent}%` }" /></span>
    </div>

    <div v-if="props.result" class="backup__result">
      <p class="backup__summary">
        成功 {{ props.result.restored.length }} 本 · 跳过 {{ props.result.skipped.length }} 本 ·
        失败 {{ props.result.failures.length }} 本
        <template v-if="props.result.copies.length > 0">
          · 副本 {{ props.result.copies.length }} 本
        </template>
      </p>
      <button
        v-if="hasFailures"
        type="button"
        class="backup__toggle"
        :aria-expanded="showFailures"
        @click="showFailures = !showFailures"
      >
        {{ showFailures ? '收起失败清单' : '展开失败清单' }}
      </button>
      <ul v-if="hasFailures && showFailures" class="backup__failures">
        <li v-for="failure in props.result.failures" :key="failure.id">
          <span class="backup__failure-title">{{ failure.title ?? failure.id }}</span>
          <span class="backup__failure-code">{{ failure.code }}</span>
          <span class="backup__failure-msg">{{ failure.message }}</span>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.backup {
  --paper: #fffdf8;
  --ink: #1f1b16;
  --ink-soft: #5c5348;
  --ink-muted: #8a8073;
  --line: #e4dbc9;
  --accent: #8c2f1f;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  background: var(--paper);
  color: var(--ink);
  font-size: 13px;
}
.backup__title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.backup__sub {
  margin: 6px 0 0;
  color: var(--ink-muted);
  line-height: 1.6;
}
.backup__actions {
  display: flex;
  gap: 8px;
}
.backup__primary {
  padding: 8px 16px;
  border: 1px solid var(--accent);
  border-radius: 6px;
  background: var(--accent);
  color: #fffdf8;
  cursor: pointer;
  font: inherit;
}
.backup__primary:hover {
  background: #a8442f;
}
.backup__ghost {
  padding: 8px 16px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: transparent;
  color: var(--ink-soft);
  cursor: pointer;
  font: inherit;
}
.backup__primary:disabled,
.backup__ghost:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.backup__file {
  display: none;
}
.backup__strategies {
  display: flex;
  gap: 8px;
  margin: 0;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
}
.backup__legend {
  padding: 0 6px;
  color: var(--ink-muted);
  font-size: 12px;
}
.backup__option {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  padding: 4px 10px;
  border: 1px solid transparent;
  border-radius: 999px;
  color: var(--ink-soft);
  cursor: pointer;
}
.backup__option--active {
  border-color: var(--accent);
  color: var(--accent);
}
.backup__hint {
  margin: 0;
  color: var(--ink-muted);
  line-height: 1.6;
}
.backup__progress {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.backup__status {
  margin: 0;
  color: var(--ink-soft);
}
.backup__bar {
  display: block;
  height: 4px;
  border-radius: 999px;
  background: #ede6d8;
  overflow: hidden;
}
.backup__bar-fill {
  display: block;
  height: 100%;
  background: var(--accent);
  transition: width 200ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.backup__result {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 8px;
  border-top: 1px dashed var(--line);
}
.backup__summary {
  margin: 0;
  color: var(--ink-soft);
}
.backup__toggle {
  align-self: flex-start;
  padding: 2px 8px;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: transparent;
  color: var(--ink-soft);
  cursor: pointer;
  font-size: 12px;
}
.backup__failures {
  margin: 0;
  padding: 0;
  list-style: none;
}
.backup__failures li {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 4px 0;
  border-bottom: 1px dashed var(--line);
}
.backup__failure-title {
  font-weight: 600;
}
.backup__failure-code {
  padding: 0 6px;
  border-radius: 3px;
  background: rgba(163, 58, 42, 0.08);
  color: #a33a2a;
  font-size: 11px;
}
.backup__failure-msg {
  color: var(--ink-muted);
  font-size: 12px;
}
@media (prefers-reduced-motion: reduce) {
  .backup__bar-fill {
    transition: none;
  }
}

/* H5（C2）：全屏模态内控件触控目标 ≥44px */
@media (pointer: coarse) {
  .backup button,
  .backup input,
  .backup select {
    min-height: var(--bt-touch-target, 44px);
  }
}
</style>
