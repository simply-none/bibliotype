<script setup lang="ts">
/**
 * 编辑器内查找替换面板（Demo 层）
 *
 * 直接作用于 BtEditor 的 ProseMirror 文档（区别于阅读态 SearchPanel 的 Reader 检索）：
 * - 查找：逐处选中并滚动到视口（findTextMatches + selectRange）；
 * - 替换当前：选中命中区间后 replaceSelectionWith；
 * - 全部替换：replaceAll（自后向前，沿用各命中处标记）。
 * 命中区间随文档事务（binding.version）重算，编辑后自动失效重取。
 */
import { computed, nextTick, ref } from 'vue';
import type { EditorBinding } from '@bibliotype/vue';
import {
  findTextMatches,
  replaceAll,
  replaceSelectionWith,
  selectRange,
  type TextMatch,
} from '@bibliotype/editor';

const props = defineProps<{ binding: EditorBinding; readonly?: boolean }>();
const emit = defineEmits<{ close: [] }>();

const query = ref('');
const replacement = ref('');
const caseSensitive = ref(false);
const current = ref(-1);

/** 当前命中集合（随事务重算；空查询即空集） */
const matches = computed<TextMatch[]>(() => {
  void props.binding.version.value;
  if (query.value === '') return [];
  return findTextMatches(props.binding.editor.editorState.doc, query.value, caseSensitive.value);
});

/** 命中总数（模板展示） */
const total = computed(() => matches.value.length);

/** 结果读数：无查询提示输入，有查询显示「第 i/n 处」或「无匹配」 */
const readout = computed(() => {
  if (query.value === '') return '';
  if (total.value === 0) return '无匹配';
  return `第 ${current.value >= 0 ? current.value + 1 : 0} / ${total.value} 处`;
});

/** 定位下一处命中（循环，自动选中并滚动） */
function findNext(): void {
  const list = matches.value;
  if (list.length === 0) {
    current.value = -1;
    return;
  }
  const next = current.value >= 0 ? (current.value + 1) % list.length : 0;
  current.value = next;
  const match = list[next];
  if (match !== undefined) props.binding.execute(selectRange(match));
}

/** 查询变化后重置游标 */
function resetCursor(): void {
  current.value = -1;
}

/** 替换当前选中的命中并前进到下一处 */
function replaceCurrent(): void {
  if (props.readonly === true) return;
  const list = matches.value;
  if (list.length === 0) return;
  const index = current.value >= 0 ? current.value : 0;
  const match = list[index];
  if (match === undefined) return;
  // 先选中该命中（保证替换区间准确），再替换为目标文本
  props.binding.execute(selectRange(match));
  props.binding.execute(replaceSelectionWith(replacement.value));
  // 替换后文档变化 → matches 重算；游标回退一位，使「下一处」指向紧随其后的命中
  current.value = index - 1;
  findNext();
}

/** 全部替换所有命中 */
function replaceEvery(): void {
  if (props.readonly === true || query.value === '') return;
  props.binding.execute(replaceAll(query.value, replacement.value, caseSensitive.value));
  current.value = -1;
}

/** 面板挂载后聚焦输入框 */
const inputRef = ref<HTMLInputElement | null>(null);
void nextTick(() => inputRef.value?.focus());
</script>

<template>
  <section class="replace">
    <div class="replace__row">
      <input
        ref="inputRef"
        v-model="query"
        type="text"
        class="replace__input"
        placeholder="查找内容"
        @input="resetCursor"
        @keyup.enter="findNext"
      />
      <label class="replace__case">
        <input v-model="caseSensitive" type="checkbox" @change="resetCursor" />
        区分大小写
      </label>
      <button type="button" class="replace__close" aria-label="关闭" @click="emit('close')">
        ×
      </button>
    </div>
    <div class="replace__row">
      <input
        v-model="replacement"
        type="text"
        class="replace__input"
        placeholder="替换为（留空即删除）"
      />
    </div>
    <div class="replace__actions">
      <span class="replace__readout">{{ readout }}</span>
      <button type="button" class="replace__button" :disabled="total === 0" @click="findNext">
        查找下一个
      </button>
      <button
        type="button"
        class="replace__button"
        :disabled="readonly === true || total === 0"
        @click="replaceCurrent"
      >
        替换
      </button>
      <button
        type="button"
        class="replace__button"
        :disabled="readonly === true || total === 0"
        @click="replaceEvery"
      >
        全部替换
      </button>
    </div>
  </section>
</template>

<style scoped>
.replace {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--demo-border, #e2ddd2);
  border-radius: 8px;
  background: var(--demo-panel, #f4f0e8);
  color: var(--demo-text, #3c3a34);
}

.replace__row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.replace__input {
  flex: 1;
  min-width: 0;
  padding: 5px 8px;
  font-size: 13px;
  color: inherit;
  background: var(--demo-control, #fbf9f4);
  border: 1px solid var(--demo-control-border, #d8d2c4);
  border-radius: 4px;
}

.replace__case {
  display: flex;
  flex: none;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--demo-muted, #8a8578);
  white-space: nowrap;
  cursor: pointer;
}

.replace__close {
  flex: none;
  width: 22px;
  height: 22px;
  font-size: 15px;
  line-height: 1;
  color: var(--demo-muted, #8a8578);
  background: none;
  border: 0;
  border-radius: 4px;
  cursor: pointer;
}

.replace__close:hover {
  background: rgba(127, 127, 127, 0.15);
}

.replace__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.replace__readout {
  flex: 1;
  font-size: 12px;
  color: var(--demo-muted, #8a8578);
}

.replace__button {
  flex: none;
  padding: 4px 10px;
  font-size: 12px;
  color: var(--demo-text, #3c3a34);
  background: var(--demo-control, #fbf9f4);
  border: 1px solid var(--demo-control-border, #d8d2c4);
  border-radius: 4px;
  cursor: pointer;
}

.replace__button:hover:not(:disabled) {
  border-color: var(--demo-accent, #8c5a2b);
  color: var(--demo-accent, #8c5a2b);
}

.replace__button:disabled {
  opacity: 0.45;
  cursor: default;
}
</style>
