<script setup lang="ts">
/**
 * 版本历史（C7）
 *
 * 左侧时间轴（今日 / 昨日 / 更早）+ 右侧对比（左右 / 行内）+ 一键回滚。
 * 回滚前的合法性校验由宿主执行，失败原因通过 `error` 就地显示（不弹窗）。
 */
import { computed, ref } from 'vue';
import type { DiffRow, VersionHistoryModel } from '../version-model.js';

const props = withDefaults(
  defineProps<{
    /** 版本历史模型（`buildVersionHistoryModel` 产出） */
    model: VersionHistoryModel;
    /** 差异行（`buildDiffRows` 产出） */
    diffRows?: DiffRow[];
    /** 差异汇总文案（`+2 −1 ~3`） */
    summaryText?: string;
    /** 对比模式 */
    compareMode?: 'split' | 'inline';
    /** 当前选中的对比版本 */
    activeVersion?: number;
    /** 是否处理中 */
    busy?: boolean;
    /** 错误信息（回滚校验失败等） */
    error?: string;
  }>(),
  {
    diffRows: () => [],
    summaryText: '',
    compareMode: 'split',
    activeVersion: 0,
    busy: false,
    error: '',
  },
);

const emit = defineEmits<{
  (event: 'compare', version: number): void;
  (event: 'restore', version: number): void;
  (event: 'create', label: string): void;
  (event: 'update:compare-mode', mode: 'split' | 'inline'): void;
}>();

const label = ref('');
const confirmVersion = ref(0);

/** 当前版本条目（用于确认条文案） */
const confirmItem = computed(() =>
  props.model.groups
    .flatMap((group) => group.items)
    .find((item) => item.version === confirmVersion.value),
);

function askRestore(version: number): void {
  if (confirmVersion.value === version) {
    emit('restore', version);
    confirmVersion.value = 0;
    return;
  }
  confirmVersion.value = version;
}

function createSnapshot(): void {
  emit('create', label.value.trim());
  label.value = '';
}
</script>

<template>
  <section class="ver">
    <header class="ver__head">
      <h3 class="ver__title">版本历史</h3>
      <div class="ver__modes" role="group" aria-label="对比模式">
        <button
          type="button"
          class="ver__mode"
          :class="{ 'ver__mode--active': props.compareMode === 'split' }"
          @click="emit('update:compare-mode', 'split')"
        >
          左右
        </button>
        <button
          type="button"
          class="ver__mode"
          :class="{ 'ver__mode--active': props.compareMode === 'inline' }"
          @click="emit('update:compare-mode', 'inline')"
        >
          行内
        </button>
      </div>
    </header>

    <div class="ver__create">
      <input
        v-model="label"
        class="ver__input"
        type="text"
        maxlength="24"
        placeholder="给这一版加个标签（可选）"
        aria-label="版本标签"
        @keyup.enter="createSnapshot"
      />
      <button type="button" class="ver__snap" :disabled="props.busy" @click="createSnapshot">打点</button>
    </div>

    <p v-if="props.error" class="ver__error">{{ props.error }}</p>

    <div class="ver__body">
      <nav class="ver__timeline" aria-label="版本列表">
        <p v-if="props.model.empty" class="ver__empty">还没有历史版本，先打一个点。</p>
        <div v-for="group in props.model.groups" :key="group.key" class="ver__group">
          <p class="ver__group-label">{{ group.label }}</p>
          <ul class="ver__list">
            <li v-for="item in group.items" :key="item.version">
              <button
                type="button"
                class="ver__item"
                :class="{ 'ver__item--active': props.activeVersion === item.version }"
                @click="emit('compare', item.version)"
              >
                <span class="ver__dot" aria-hidden="true" />
                <span class="ver__item-body">
                  <span class="ver__item-label">{{ item.label }}</span>
                  <span class="ver__item-meta">{{ item.timeText }} · {{ item.wordCountText }}</span>
                </span>
              </button>
            </li>
          </ul>
        </div>
      </nav>

      <div class="ver__diff" :class="`ver__diff--${props.compareMode}`">
        <div class="ver__diff-head">
          <span class="ver__diff-sum">{{ props.summaryText || '选择左侧版本查看差异' }}</span>
          <button
            v-if="props.activeVersion > 0"
            type="button"
            class="ver__restore"
            :disabled="props.busy"
            @click="askRestore(props.activeVersion)"
          >
            {{ confirmVersion === props.activeVersion ? '确认回滚' : '回滚到此版本' }}
          </button>
        </div>
        <p v-if="confirmVersion === props.activeVersion && props.activeVersion > 0" class="ver__confirm">
          将用「{{ confirmItem?.label }}」替换当前正文，当前未保存的改动请先保存。
        </p>

        <ul class="ver__rows">
          <li v-for="(row, index) in props.diffRows" :key="`${row.path}-${index}`" class="ver__row" :class="`ver__row--${row.kind}`">
            <span class="ver__kind">{{ row.kindLabel }}</span>
            <span class="ver__path">{{ row.path }}</span>
            <span v-if="props.compareMode === 'split'" class="ver__pair">
              <span class="ver__before">{{ row.beforeText || '—' }}</span>
              <span class="ver__after">{{ row.afterText || '—' }}</span>
            </span>
            <span v-else class="ver__inline">
              <span class="ver__before">{{ row.beforeText }}</span>
              <span class="ver__after">{{ row.afterText }}</span>
            </span>
          </li>
        </ul>
        <p v-if="props.diffRows.length === 0" class="ver__empty">两个版本内容一致。</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.ver {
  --paper: #fffdf8;
  --ink: #1f1b16;
  --ink-soft: #5c5348;
  --ink-muted: #8a8073;
  --line: #e4dbc9;
  --accent: #8c2f1f;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  background: var(--paper);
  color: var(--ink);
  font-size: 13px;
}
.ver__head {
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
}
.ver__title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.ver__modes {
  display: inline-flex;
  border: 1px solid var(--line);
  border-radius: 6px;
  overflow: hidden;
}
.ver__mode {
  padding: 4px 10px;
  border: 0;
  background: transparent;
  color: var(--ink-soft);
  cursor: pointer;
  font: inherit;
}
.ver__mode--active {
  background: rgba(140, 47, 31, 0.08);
  color: var(--accent);
}
.ver__create {
  display: flex;
  gap: 8px;
}
.ver__input {
  flex: 1;
  padding: 7px 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: #fffdf8;
  color: var(--ink);
  font: inherit;
  outline: none;
}
.ver__input:focus-visible {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(140, 47, 31, 0.14);
}
.ver__snap {
  padding: 7px 14px;
  border: 1px solid var(--accent);
  border-radius: 6px;
  background: var(--accent);
  color: #fffdf8;
  cursor: pointer;
  font: inherit;
}
.ver__error {
  margin: 0;
  padding: 8px 10px;
  border-left: 3px solid #a33a2a;
  background: rgba(163, 58, 42, 0.06);
  color: #a33a2a;
}
.ver__body {
  display: grid;
  grid-template-columns: minmax(160px, 220px) 1fr;
  gap: 12px;
  min-height: 220px;
}
.ver__timeline {
  border-right: 1px solid var(--line);
  padding-right: 10px;
  overflow-y: auto;
  max-height: 420px;
}
.ver__group-label {
  margin: 8px 0 4px;
  color: var(--ink-muted);
  font-size: 11px;
  letter-spacing: 0.08em;
}
.ver__list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.ver__item {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  width: 100%;
  padding: 5px 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  text-align: left;
}
.ver__item:hover,
.ver__item:focus-visible {
  background: rgba(140, 47, 31, 0.05);
  outline: none;
}
.ver__dot {
  margin-top: 6px;
  width: 7px;
  height: 7px;
  border: 1px solid var(--ink-muted);
  border-radius: 50%;
}
.ver__item--active .ver__dot {
  border-color: var(--accent);
  background: var(--accent);
}
.ver__item-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.ver__item-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ver__item--active .ver__item-label {
  color: var(--accent);
  font-weight: 600;
}
.ver__item-meta {
  color: var(--ink-muted);
  font-size: 11px;
}
.ver__diff {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.ver__diff-head {
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
}
.ver__diff-sum {
  color: var(--ink-soft);
  font-variant-numeric: tabular-nums;
}
.ver__restore {
  padding: 4px 10px;
  border: 1px solid var(--accent);
  border-radius: 4px;
  background: transparent;
  color: var(--accent);
  cursor: pointer;
  font-size: 12px;
}
.ver__confirm {
  margin: 0;
  padding: 6px 8px;
  border: 1px dashed rgba(140, 47, 31, 0.4);
  border-radius: 4px;
  color: var(--accent);
  font-size: 12px;
}
.ver__rows {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
  overflow-y: auto;
  max-height: 380px;
}
.ver__row {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 6px 8px;
  border-radius: 4px;
  border-left: 3px solid transparent;
  background: rgba(31, 27, 22, 0.02);
}
.ver__row--added {
  border-left-color: #2f6b4f;
  background: rgba(47, 107, 79, 0.06);
}
.ver__row--removed {
  border-left-color: #a33a2a;
  background: rgba(163, 58, 42, 0.06);
}
.ver__row--modified {
  border-left-color: #b07a21;
  background: rgba(176, 122, 33, 0.06);
}
.ver__kind {
  font-weight: 600;
  font-size: 12px;
}
.ver__path {
  color: var(--ink-muted);
  font-size: 11px;
}
.ver__pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.ver__before {
  color: #a33a2a;
  text-decoration: line-through;
  word-break: break-word;
}
.ver__after {
  color: #2f6b4f;
  word-break: break-word;
}
.ver__inline {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.ver__empty {
  margin: 0;
  color: var(--ink-muted);
}
@media (max-width: 767px) {
  .ver__body {
    grid-template-columns: 1fr;
  }
  .ver__timeline {
    border-right: 0;
    border-bottom: 1px solid var(--line);
    padding: 0 0 8px;
    max-height: 180px;
  }
}
</style>
