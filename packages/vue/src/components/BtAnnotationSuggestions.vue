<script setup lang="ts">
/**
 * 句读 / 专名建议审阅面板（K3）
 *
 * 纯展示 + 语义事件：建议列表、类别筛选、逐条接受 / 拒绝、改类、批量确认与
 * 「采纳为标点」。状态与命令执行由 `useAnnotationSuggestions` + 宿主负责，
 * 面板本身不发命令、不写存储。
 */
import type {
  AnnotationSuggestion,
  JudouSymbol,
  ProperNameKind,
  SuggestionKind,
} from '@bibliotype/classical';
import { JUDOU_SYMBOLS } from '@bibliotype/classical';
import { computed } from 'vue';
import type { SuggestionFilter } from '../use-annotation-suggestions.js';

const props = withDefaults(
  defineProps<{
    /** 待处理建议（通常取 `useAnnotationSuggestions().visible`） */
    suggestions: readonly AnnotationSuggestion[];
    /** 分类计数（未处置） */
    counts?: Record<SuggestionKind, number>;
    /** 当前类别过滤（v-model:filter） */
    filter?: SuggestionFilter;
    /** 空态文案 */
    emptyText?: string;
    /** 禁用操作（如编辑器未就绪） */
    disabled?: boolean;
  }>(),
  {
    counts: () => ({ judou: 0, 'proper-name': 0 }),
    filter: 'all',
    emptyText: '暂无待处理建议',
    disabled: false,
  },
);

const emit = defineEmits<{
  'update:filter': [value: SuggestionFilter];
  /** 接受（ids 为选中的建议；缺省表示当前列表全部） */
  accept: [ids: readonly string[]];
  /** 拒绝 */
  reject: [ids: readonly string[]];
  /** 采纳为标点 */
  commit: [ids: readonly string[]];
  /** 定位到原文 */
  locate: [suggestion: AnnotationSuggestion];
  /** 改类 / 改标点 */
  override: [id: string, patch: { symbol?: JudouSymbol; nameKind?: ProperNameKind }];
}>();

/** 专名类别下拉 */
const NAME_KIND_OPTIONS: ReadonlyArray<{ value: ProperNameKind; label: string }> = [
  { value: 'person', label: '人名' },
  { value: 'place', label: '地名' },
  { value: 'dynasty', label: '朝代' },
  { value: 'book', label: '书名' },
  { value: 'office', label: '职官' },
];

const FILTERS: ReadonlyArray<{ value: SuggestionFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'judou', label: '句读' },
  { value: 'proper-name', label: '专名' },
];

const total = computed(
  () => props.counts.judou + props.counts['proper-name'],
);

const ids = computed(() => props.suggestions.map((item) => item.id));

function kindLabel(kind: SuggestionKind): string {
  return kind === 'judou' ? '句读' : '专名';
}

function confidenceText(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function onFilter(value: SuggestionFilter): void {
  emit('update:filter', value);
}

function onSymbol(item: AnnotationSuggestion, event: Event): void {
  // 选项值来自 JUDOU_SYMBOLS，断言安全
  const value = (event.target as HTMLSelectElement).value as JudouSymbol;
  emit('override', item.id, { symbol: value });
}

function onNameKind(item: AnnotationSuggestion, event: Event): void {
  const value = (event.target as HTMLSelectElement).value as ProperNameKind;
  emit('override', item.id, { nameKind: value });
}
</script>

<template>
  <section class="bt-suggestions" aria-label="句读与专名建议">
    <header class="bt-suggestions__head">
      <div class="bt-suggestions__title">
        建议
        <span class="bt-suggestions__count">{{ total }}</span>
      </div>
      <div class="bt-suggestions__filters" role="group" aria-label="按类别筛选">
        <button
          v-for="item in FILTERS"
          :key="item.value"
          type="button"
          class="bt-suggestions__filter"
          :class="{ 'bt-suggestions__filter--active': props.filter === item.value }"
          :aria-pressed="props.filter === item.value"
          @click="onFilter(item.value)"
        >
          {{ item.label }}
        </button>
      </div>
    </header>

    <ul v-if="props.suggestions.length > 0" class="bt-suggestions__list">
      <li
        v-for="item in props.suggestions"
        :key="item.id"
        class="bt-suggestions__item"
        :class="`bt-suggestions__item--${item.kind}`"
      >
        <button
          type="button"
          class="bt-suggestions__excerpt"
          :title="`定位到原文：${item.text}`"
          @click="emit('locate', item)"
        >
          <span class="bt-suggestions__kind">{{ kindLabel(item.kind) }}</span>
          <span class="bt-suggestions__text">{{ item.text }}</span>
          <span v-if="item.kind === 'judou'" class="bt-suggestions__symbol">
            {{ item.symbol }}
          </span>
          <span class="bt-suggestions__confidence">{{ confidenceText(item.confidence) }}</span>
        </button>

        <label v-if="item.kind === 'judou'" class="bt-suggestions__pick">
          <span class="bt-suggestions__pick-label">标点</span>
          <select
            class="bt-suggestions__select"
            :value="item.symbol"
            :disabled="props.disabled"
            @change="onSymbol(item, $event)"
          >
            <option v-for="symbol in JUDOU_SYMBOLS" :key="symbol" :value="symbol">
              {{ symbol }}
            </option>
          </select>
        </label>

        <label v-else class="bt-suggestions__pick">
          <span class="bt-suggestions__pick-label">类别</span>
          <select
            class="bt-suggestions__select"
            :value="item.nameKind ?? 'person'"
            :disabled="props.disabled"
            @change="onNameKind(item, $event)"
          >
            <option v-for="option in NAME_KIND_OPTIONS" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </label>

        <div class="bt-suggestions__actions">
          <button
            type="button"
            class="bt-suggestions__accept"
            :disabled="props.disabled"
            @click="emit('accept', [item.id])"
          >
            接受
          </button>
          <button
            type="button"
            class="bt-suggestions__reject"
            :disabled="props.disabled"
            @click="emit('reject', [item.id])"
          >
            拒绝
          </button>
        </div>
      </li>
    </ul>

    <p v-else class="bt-suggestions__empty">{{ props.emptyText }}</p>

    <footer class="bt-suggestions__foot">
      <button
        type="button"
        class="bt-suggestions__bulk"
        :disabled="props.disabled || ids.length === 0"
        @click="emit('accept', ids)"
      >
        全部接受
      </button>
      <button
        type="button"
        class="bt-suggestions__bulk"
        :disabled="props.disabled || ids.length === 0"
        @click="emit('reject', ids)"
      >
        全部拒绝
      </button>
      <button
        type="button"
        class="bt-suggestions__bulk bt-suggestions__bulk--primary"
        :disabled="props.disabled"
        title="把已接受的句读标记落成真正的标点字符（可用撤销回退）"
        @click="emit('commit', [])"
      >
        采纳为标点
      </button>
    </footer>
  </section>
</template>

<style scoped>
.bt-suggestions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid rgba(127, 127, 127, 0.24);
  border-radius: 8px;
  background: var(--bt-color-background, #faf8f4);
  color: var(--bt-color-text, #2c2c2c);
  font-size: 13px;
}

.bt-suggestions__head {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.bt-suggestions__title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
}

.bt-suggestions__count {
  padding: 0 6px;
  border-radius: 9px;
  background: color-mix(in srgb, var(--bt-color-accent, #8c5a2b) 16%, transparent);
  color: var(--bt-color-accent, #8c5a2b);
  font-size: 11px;
  line-height: 18px;
}

.bt-suggestions__filters {
  display: flex;
  gap: 4px;
}

.bt-suggestions__filter {
  padding: 2px 8px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  color: var(--bt-color-note-text, #6b6b6b);
  font-size: 12px;
  cursor: pointer;
}

.bt-suggestions__filter:hover,
.bt-suggestions__filter:focus-visible {
  border-color: rgba(127, 127, 127, 0.24);
  outline: none;
}

.bt-suggestions__filter--active {
  border-color: var(--bt-color-accent, #8c5a2b);
  color: var(--bt-color-accent, #8c5a2b);
}

.bt-suggestions__list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  max-height: 320px;
  overflow-y: auto;
  list-style: none;
}

.bt-suggestions__item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 6px;
  align-items: center;
  padding: 4px 6px;
  border-radius: 6px;
}

.bt-suggestions__item:hover {
  background: color-mix(in srgb, var(--bt-color-accent, #8c5a2b) 6%, transparent);
}

.bt-suggestions__excerpt {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: start;
  cursor: pointer;
}

.bt-suggestions__excerpt:focus-visible {
  outline: 2px solid var(--bt-color-accent, #8c5a2b);
  outline-offset: 2px;
  border-radius: 4px;
}

.bt-suggestions__kind {
  flex: none;
  padding: 0 5px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--bt-color-note-text, #6b6b6b) 14%, transparent);
  color: var(--bt-color-note-text, #6b6b6b);
  font-size: 11px;
  line-height: 17px;
}

.bt-suggestions__item--proper-name .bt-suggestions__kind {
  background: color-mix(in srgb, var(--bt-color-accent, #8c5a2b) 16%, transparent);
  color: var(--bt-color-accent, #8c5a2b);
}

.bt-suggestions__text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bt-suggestions__symbol {
  color: var(--bt-color-accent, #8c5a2b);
  font-weight: 600;
}

.bt-suggestions__confidence {
  flex: none;
  color: var(--bt-color-note-text, #6b6b6b);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.bt-suggestions__pick {
  display: flex;
  align-items: center;
  gap: 3px;
}

.bt-suggestions__pick-label {
  color: var(--bt-color-note-text, #6b6b6b);
  font-size: 11px;
}

.bt-suggestions__select {
  max-width: 64px;
  padding: 1px 2px;
  border: 1px solid rgba(127, 127, 127, 0.24);
  border-radius: 4px;
  background: transparent;
  color: inherit;
  font-size: 12px;
}

.bt-suggestions__actions {
  display: flex;
  gap: 2px;
}

.bt-suggestions__accept,
.bt-suggestions__reject,
.bt-suggestions__bulk {
  padding: 2px 7px;
  border: 1px solid rgba(127, 127, 127, 0.24);
  border-radius: 4px;
  background: transparent;
  color: inherit;
  font-size: 12px;
  cursor: pointer;
}

.bt-suggestions__accept:hover,
.bt-suggestions__bulk:hover {
  border-color: var(--bt-color-accent, #8c5a2b);
  color: var(--bt-color-accent, #8c5a2b);
}

.bt-suggestions__accept:disabled,
.bt-suggestions__reject:disabled,
.bt-suggestions__bulk:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.bt-suggestions__foot {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding-block-start: 6px;
  border-block-start: 1px solid rgba(127, 127, 127, 0.24);
}

.bt-suggestions__bulk--primary {
  border-color: var(--bt-color-accent, #8c5a2b);
  color: var(--bt-color-accent, #8c5a2b);
}

.bt-suggestions__empty {
  margin: 0;
  padding: 12px 0;
  color: var(--bt-color-note-text, #6b6b6b);
  font-size: 12px;
  text-align: center;
}
</style>
