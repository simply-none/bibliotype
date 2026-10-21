<script setup lang="ts">
/**
 * 加密与隐私面板（H5）
 *
 * 开关 + 口令强度提示 + 注记独立密钥（次级折叠区）+ 导出脱敏选项。
 * 密钥派生与加解密由宿主完成，本组件只发语义事件。
 */
import { computed, ref } from 'vue';
import type { RedactOptions } from '@bibliotype/core';

const props = withDefaults(
  defineProps<{
    /** 是否已开启正文加密 */
    enabled?: boolean;
    /** 本次会话是否已解锁 */
    unlocked?: boolean;
    /** 注记是否使用独立密钥 */
    notesLocked?: boolean;
    /** 是否正在处理 */
    busy?: boolean;
    /** 错误信息 */
    error?: string;
    /** 脱敏选项 */
    redact?: RedactOptions;
  }>(),
  {
    enabled: false,
    unlocked: false,
    notesLocked: false,
    busy: false,
    error: '',
    redact: () => ({}),
  },
);

const emit = defineEmits<{
  (event: 'enable', password: string): void;
  (event: 'unlock', password: string): void;
  (event: 'disable'): void;
  (event: 'toggle-notes', locked: boolean): void;
  (event: 'update:redact', redact: RedactOptions): void;
}>();

const password = ref('');

/** 口令强度（仅作提示，不做强制） */
const strength = computed(() => {
  const value = password.value;
  if (value === '') {
    return { level: 0, text: '至少 8 位，建议混合大小写与数字' };
  }
  let score = 0;
  if (value.length >= 8) score += 1;
  if (value.length >= 12) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/\d/.test(value)) score += 1;
  if (score <= 2) {
    return { level: 1, text: '口令较弱，建议加长并混合字符' };
  }
  if (score === 3) {
    return { level: 2, text: '口令强度中等' };
  }
  return { level: 3, text: '口令强度良好' };
});

/** 脱敏项 */
const REDACT_ITEMS: { key: keyof RedactOptions; label: string }[] = [
  { key: 'hideComments', label: '隐藏批注与评论' },
  { key: 'hideAuthors', label: '隐藏作者信息' },
  { key: 'hideProgress', label: '隐藏阅读进度' },
];

function toggleRedact(key: keyof RedactOptions, checked: boolean): void {
  emit('update:redact', { ...props.redact, [key]: checked });
}

function submit(): void {
  if (props.busy || password.value === '') {
    return;
  }
  if (props.enabled) {
    emit('unlock', password.value);
  } else {
    emit('enable', password.value);
  }
}
</script>

<template>
  <section class="crypt">
    <header class="crypt__head">
      <h3 class="crypt__title">加密与隐私</h3>
      <span class="crypt__state" :class="{ 'crypt__state--on': props.enabled }">
        <span class="crypt__lock" aria-hidden="true">{{ props.enabled ? '锁' : '开' }}</span>
        {{ props.enabled ? (props.unlocked ? '本次会话已解锁' : '已加密 · 未解锁') : '未开启加密' }}
      </span>
    </header>

    <p class="crypt__sub">
      开启后正文与资产在存储层以密文保存，原始数据库内容不可读；注记可用独立密钥单独加锁。
    </p>

    <div class="crypt__form">
      <input
        v-model="password"
        class="crypt__input"
        type="password"
        autocomplete="current-password"
        :placeholder="props.enabled ? '输入口令解锁' : '设置加密口令'"
        aria-label="加密口令"
        @keyup.enter="submit"
      />
      <button type="button" class="crypt__primary" :disabled="props.busy" @click="submit">
        {{ props.enabled ? '解锁' : '开启加密' }}
      </button>
      <button
        v-if="props.enabled"
        type="button"
        class="crypt__ghost"
        :disabled="props.busy"
        @click="emit('disable')"
      >
        关闭加密
      </button>
    </div>
    <p class="crypt__strength" :class="`crypt__strength--${strength.level}`">{{ strength.text }}</p>
    <p v-if="props.error" class="crypt__error">{{ props.error }}</p>

    <details class="crypt__notes">
      <summary class="crypt__summary">注记独立密钥</summary>
      <label class="crypt__check">
        <input
          type="checkbox"
          :checked="props.notesLocked"
          @change="emit('toggle-notes', ($event.target as HTMLInputElement).checked)"
        />
        <span>只锁笔记与批注（不影响正文阅读）</span>
      </label>
    </details>

    <fieldset class="crypt__redact">
      <legend class="crypt__legend">导出脱敏</legend>
      <label v-for="item in REDACT_ITEMS" :key="item.key" class="crypt__check">
        <input
          type="checkbox"
          :checked="props.redact[item.key] === true"
          @change="toggleRedact(item.key, ($event.target as HTMLInputElement).checked)"
        />
        <span>{{ item.label }}</span>
      </label>
    </fieldset>
  </section>
</template>

<style scoped>
.crypt {
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
.crypt__head {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
}
.crypt__title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.crypt__state {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  padding: 3px 10px;
  border: 1px solid var(--line);
  border-radius: 999px;
  color: var(--ink-muted);
  font-size: 12px;
}
.crypt__state--on {
  border-color: rgba(140, 47, 31, 0.35);
  color: var(--accent);
}
.crypt__lock {
  font-size: 12px;
}
.crypt__sub {
  margin: 0;
  color: var(--ink-muted);
  line-height: 1.7;
}
.crypt__form {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.crypt__input {
  flex: 1 1 220px;
  padding: 8px 12px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: #fffdf8;
  color: var(--ink);
  font: inherit;
  outline: none;
}
.crypt__input:focus-visible {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(140, 47, 31, 0.14);
}
.crypt__primary {
  padding: 8px 16px;
  border: 1px solid var(--accent);
  border-radius: 6px;
  background: var(--accent);
  color: #fffdf8;
  cursor: pointer;
  font: inherit;
}
.crypt__primary:hover {
  background: #a8442f;
}
.crypt__ghost {
  padding: 8px 14px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: transparent;
  color: var(--ink-soft);
  cursor: pointer;
  font: inherit;
}
.crypt__primary:disabled,
.crypt__ghost:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.crypt__strength {
  margin: 0;
  font-size: 12px;
}
.crypt__strength--0,
.crypt__strength--1 {
  color: #a33a2a;
}
.crypt__strength--2 {
  color: #b07a21;
}
.crypt__strength--3 {
  color: #2f6b4f;
}
.crypt__error {
  margin: 0;
  padding: 8px 10px;
  border-left: 3px solid #a33a2a;
  background: rgba(163, 58, 42, 0.06);
  color: #a33a2a;
}
.crypt__notes,
.crypt__redact {
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
}
.crypt__summary {
  color: var(--ink-soft);
  cursor: pointer;
}
.crypt__legend {
  padding: 0 6px;
  color: var(--ink-muted);
  font-size: 12px;
}
.crypt__check {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 4px 0;
  color: var(--ink-soft);
  cursor: pointer;
}
</style>
