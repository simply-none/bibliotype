<script setup lang="ts">
/**
 * 主题面板（BtThemePanel）
 *
 * 预设卡片 + 导入导出，状态全部经 `v-model:tokens` 进出，面板自身不写存储、
 * 不下载文件（`export` 事件把 JSON 交给宿主，便于宿主复制 / 存盘 / 分享）。
 *
 * 与「样式预设」解耦：面板只改令牌，且默认保留排版令牌（`keepTokens`），
 * 因此切换主题不会覆盖用户调好的字号与版式。
 */
import { computed, ref } from 'vue';
import type { ThemePreset, ThemeToken } from '@bibliotype/core';
import { COLOR_TOKENS } from '@bibliotype/core';
import {
  CUSTOM_THEME_PRESET_ID,
  THEME_COLOR_TOKENS,
  useThemePresets,
} from '../use-theme-presets.js';

const props = withDefaults(
  defineProps<{
    /** 当前生效令牌（用于色板与导出） */
    tokens: Readonly<Record<ThemeToken, string>>;
    /** 重置目标令牌（缺省与当前一致，即「恢复当前基线」） */
    baseTokens?: Readonly<Record<ThemeToken, string>>;
    /** 预设目录（缺省内置三套） */
    presets?: readonly ThemePreset[];
    /** 切换预设时保留的令牌（缺省排版令牌） */
    keepTokens?: readonly ThemeToken[];
    /** 面板标题 */
    title?: string;
    /** 导入框占位文案 */
    importPlaceholder?: string;
  }>(),
  {
    baseTokens: undefined,
    presets: undefined,
    keepTokens: undefined,
    title: '外观主题',
    importPlaceholder: '粘贴主题包 JSON，例如 {"kind":"bibliotype-theme-preset",...}',
  },
);

const emit = defineEmits<{
  (event: 'update:tokens', tokens: Record<ThemeToken, string>): void;
  (event: 'apply', presetId: string): void;
  (event: 'export', json: string): void;
  (event: 'import', presetId: string): void;
}>();

const baseOf = (): Readonly<Record<ThemeToken, string>> => props.baseTokens ?? props.tokens;

const palette = useThemePresets({
  base: baseOf,
  tokens: () => props.tokens,
  onTokensChange: (next) => emit('update:tokens', next),
  presets: props.presets,
  keep: props.keepTokens,
});

const draft = ref('');

/** 预设色板底色（预设未给背景时退回当前背景） */
function swatchBackground(preset: ThemePreset): string {
  return preset.tokens[COLOR_TOKENS.BACKGROUND] ?? props.tokens[COLOR_TOKENS.BACKGROUND];
}

/** 预设色板文字色 */
function swatchText(preset: ThemePreset): string {
  return preset.tokens[COLOR_TOKENS.TEXT] ?? props.tokens[COLOR_TOKENS.TEXT];
}

/** 当前令牌的色板（背景 + 正文 + 注文 + 强调） */
const currentSwatch = computed(() =>
  THEME_COLOR_TOKENS.map((token) => ({ token, value: props.tokens[token] })),
);

/** 当前选中的预设名（未选中时显示「自定义」） */
const activeName = computed(() => {
  const found = palette.presets.value.find((preset) => preset.id === palette.activeId.value);
  return found?.name ?? '自定义';
});

function onApply(presetId: string): void {
  if (!palette.applyPreset(presetId)) return;
  emit('apply', presetId);
}

function onReset(): void {
  palette.resetTheme();
}

function onExport(): void {
  const json = palette.exportJson();
  draft.value = json;
  emit('export', json);
}

function onImport(): void {
  if (draft.value.trim() === '') return;
  if (!palette.importJson(draft.value)) return;
  emit('import', palette.activeId.value ?? CUSTOM_THEME_PRESET_ID);
}
</script>

<template>
  <section class="bt-theme-panel" aria-label="外观主题">
    <header class="bt-theme-panel__head">
      <h3 class="bt-theme-panel__title">{{ title }}</h3>
      <span class="bt-theme-panel__current">当前：{{ activeName }}</span>
    </header>

    <ul class="bt-theme-panel__grid">
      <li v-for="preset in palette.presets.value" :key="preset.id">
        <button
          type="button"
          class="bt-theme-panel__card"
          :class="{ 'bt-theme-panel__card--active': palette.activeId.value === preset.id }"
          :aria-pressed="palette.activeId.value === preset.id"
          @click="onApply(preset.id)"
        >
          <span
            class="bt-theme-panel__swatch"
            :style="{ background: swatchBackground(preset), color: swatchText(preset) }"
            aria-hidden="true"
          >文</span>
          <span class="bt-theme-panel__name">{{ preset.name }}</span>
          <span v-if="preset.description" class="bt-theme-panel__desc">{{ preset.description }}</span>
        </button>
      </li>
    </ul>

    <div class="bt-theme-panel__palette" aria-hidden="true">
      <span
        v-for="entry in currentSwatch"
        :key="entry.token"
        class="bt-theme-panel__chip"
        :style="{ background: entry.value }"
        :title="entry.token"
      />
      <span class="bt-theme-panel__note-text">正文 / 注文 / 强调 由当前令牌驱动</span>
    </div>

    <div class="bt-theme-panel__actions">
      <button type="button" class="bt-theme-panel__button" @click="onReset">恢复默认</button>
      <button type="button" class="bt-theme-panel__button" @click="onExport">导出当前</button>
    </div>

    <label class="bt-theme-panel__import">
      <span class="bt-theme-panel__label">导入主题包</span>
      <textarea
        v-model="draft"
        class="bt-theme-panel__textarea"
        rows="5"
        spellcheck="false"
        :placeholder="importPlaceholder"
      />
    </label>
    <button type="button" class="bt-theme-panel__button" @click="onImport">导入并应用</button>

    <ul v-if="palette.issues.value.length > 0" class="bt-theme-panel__issues" role="alert">
      <li v-for="(issue, index) in palette.issues.value" :key="`${issue.path}-${index}`">
        <span v-if="issue.path" class="bt-theme-panel__issue-path">{{ issue.path }}</span>
        {{ issue.message }}
      </li>
    </ul>
  </section>
</template>

<style scoped>
.bt-theme-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 13px;
  color: var(--bt-color-text, #2c2c2c);
}

.bt-theme-panel__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.bt-theme-panel__title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}

.bt-theme-panel__current {
  color: var(--bt-color-note-text, #6b6b6b);
  font-size: 12px;
}

.bt-theme-panel__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.bt-theme-panel__card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  padding: 8px;
  border: 1px solid rgba(127, 127, 127, 0.24);
  border-radius: 8px;
  background: none;
  color: inherit;
  font: inherit;
  text-align: start;
  cursor: pointer;
  transition: border-color 160ms ease, box-shadow 160ms ease;
}

.bt-theme-panel__card:hover {
  border-color: var(--bt-color-accent, #8c5a2b);
}

.bt-theme-panel__card--active {
  border-color: var(--bt-color-accent, #8c5a2b);
  box-shadow: inset 0 0 0 1px var(--bt-color-accent, #8c5a2b);
}

.bt-theme-panel__swatch {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 52px;
  border-radius: 6px;
  border: 1px solid rgba(127, 127, 127, 0.18);
  font-size: 18px;
}

.bt-theme-panel__name {
  font-weight: 600;
}

.bt-theme-panel__desc {
  color: var(--bt-color-note-text, #6b6b6b);
  font-size: 12px;
  line-height: 1.5;
}

.bt-theme-panel__palette {
  display: flex;
  align-items: center;
  gap: 6px;
}

.bt-theme-panel__chip {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  border: 1px solid rgba(127, 127, 127, 0.24);
}

.bt-theme-panel__note-text {
  color: var(--bt-color-note-text, #6b6b6b);
  font-size: 12px;
}

.bt-theme-panel__actions {
  display: flex;
  gap: 8px;
}

.bt-theme-panel__button {
  padding: 5px 10px;
  border: 1px solid rgba(127, 127, 127, 0.28);
  border-radius: 6px;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.bt-theme-panel__button:hover {
  border-color: var(--bt-color-accent, #8c5a2b);
  color: var(--bt-color-accent, #8c5a2b);
}

.bt-theme-panel__import {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.bt-theme-panel__label {
  color: var(--bt-color-note-text, #6b6b6b);
  font-size: 12px;
}

.bt-theme-panel__textarea {
  box-sizing: border-box;
  width: 100%;
  padding: 6px 8px;
  border: 1px solid rgba(127, 127, 127, 0.28);
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font-family: var(--bt-font-family-mono, ui-monospace, monospace);
  font-size: 12px;
  line-height: 1.5;
  resize: vertical;
}

.bt-theme-panel__textarea:focus-visible {
  outline: 2px solid rgba(140, 90, 43, 0.35);
  outline-offset: 1px;
}

.bt-theme-panel__issues {
  margin: 0;
  padding: 8px 10px 8px 24px;
  border-radius: 6px;
  background: rgba(180, 85, 58, 0.08);
  color: #b4553a;
  font-size: 12px;
  line-height: 1.6;
}

.bt-theme-panel__issue-path {
  font-family: var(--bt-font-family-mono, ui-monospace, monospace);
  opacity: 0.75;
}

@media (prefers-reduced-motion: reduce) {
  .bt-theme-panel__card {
    transition: none;
  }
}

/* H5（C2）：全屏模态内控件触控目标 ≥44px */
@media (pointer: coarse) {
  .bt-theme-panel button,
  .bt-theme-panel input,
  .bt-theme-panel select {
    min-height: var(--bt-touch-target, 44px);
  }
}
</style>
