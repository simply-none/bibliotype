<script setup lang="ts">
/**
 * 「页眉页脚」分区
 *
 * 只配置内容与占位尺寸（占用版心，改动会触发重新分页）；字体 / 字号 / 对齐 /
 * 分隔线仍归「功能样式 → 页眉 / 页脚」，本区不碰样式声明。
 */
import { computed } from 'vue';
import {
  PAGE_CHROME_FIELDS,
  type LayoutOptions,
} from '@bibliotype/layout';
import type { PageChromeField } from './settings-types.js';
import type { StyleSettingsApi } from '../../composables/use-style-settings.js';
import {
  PAGE_CHROME_PRESETS,
  resolvePageChromePreset,
  type PageChromePreset,
} from './settings-presets.js';

const props = defineProps<{
  /** 样式设置 API（状态 + 持久化 + 预设） */
  api: StyleSettingsApi;
  /** 当前生效布局（主题基准 + 补丁合并后） */
  layout: LayoutOptions;
}>();

const CHROME_FIELDS: ReadonlyArray<{ value: PageChromeField; label: string }> = [
  { value: PAGE_CHROME_FIELDS.NONE, label: '不显示' },
  { value: PAGE_CHROME_FIELDS.BOOK_TITLE, label: '书名' },
  { value: PAGE_CHROME_FIELDS.CHAPTER_TITLE, label: '章名' },
  { value: PAGE_CHROME_FIELDS.PAGE_NUMBER, label: '页码' },
];

const chrome = computed(() => props.layout.pageChrome);

const chromeEnabled = computed(
  () =>
    chrome.value !== undefined &&
    (chrome.value.header !== 'none' || chrome.value.footer !== 'none'),
);

function patchChrome(patch: Partial<NonNullable<LayoutOptions['pageChrome']>>): void {
  const base = props.layout.pageChrome ?? {
    header: PAGE_CHROME_FIELDS.NONE,
    footer: PAGE_CHROME_FIELDS.NONE,
    headerSize: 0,
    footerSize: 0,
  };
  props.api.patchLayout({ pageChrome: { ...base, ...patch } });
}

function toggleChrome(enabled: boolean): void {
  if (enabled) {
    patchChrome({
      header: PAGE_CHROME_FIELDS.BOOK_TITLE,
      headerSize: 26,
      footer: PAGE_CHROME_FIELDS.PAGE_NUMBER,
      footerSize: 26,
    });
  } else {
    patchChrome({
      header: PAGE_CHROME_FIELDS.NONE,
      footer: PAGE_CHROME_FIELDS.NONE,
      headerSize: 0,
      footerSize: 0,
    });
  }
}

/** 当前配置命中哪个组合预设（四字段全等；单项微调后熄灭） */
const activeChromePreset = computed(() => resolvePageChromePreset(chrome.value));

/** 套用组合预设：一次写入页眉 / 页脚内容与占位 */
function applyChromePreset(preset: PageChromePreset): void {
  patchChrome({
    header: preset.header,
    headerSize: preset.headerSize,
    footer: preset.footer,
    footerSize: preset.footerSize,
  });
}
</script>

<template>
  <div class="panel__field">
    <span class="panel__label">常用组合</span>
    <div class="panel__chips">
      <button
        v-for="preset in PAGE_CHROME_PRESETS"
        :key="preset.key"
        type="button"
        class="panel__chip"
        :class="{ 'panel__chip--active': activeChromePreset === preset.key }"
        @click="applyChromePreset(preset)"
      >
        {{ preset.label }}
      </button>
    </div>
    <span class="panel__hint">组合预设一次写入页眉 / 页脚内容与占位，单项微调后高亮熄灭。</span>
  </div>

  <label class="panel__switch">
    <input type="checkbox" :checked="chromeEnabled" @change="toggleChrome(($event.target as HTMLInputElement).checked)" />
    启用页眉 / 页脚（占用版心，开启后重新分页）
  </label>

  <div class="panel__row">
    <label class="panel__field">
      <span class="panel__label">页眉内容</span>
      <select class="panel__input" :value="chrome?.header ?? 'none'"
        @change="patchChrome({ header: ($event.target as HTMLSelectElement).value as PageChromeField })">
        <option v-for="field in CHROME_FIELDS" :key="field.value" :value="field.value">{{ field.label }}</option>
      </select>
    </label>
    <label class="panel__field">
      <span class="panel__label">页眉占位 px</span>
      <input type="number" class="panel__input" min="0" max="120"
        :value="chrome?.headerSize ?? 0"
        @input="patchChrome({ headerSize: Number(($event.target as HTMLInputElement).value) })" />
    </label>
  </div>

  <div class="panel__row">
    <label class="panel__field">
      <span class="panel__label">页脚内容</span>
      <select class="panel__input" :value="chrome?.footer ?? 'none'"
        @change="patchChrome({ footer: ($event.target as HTMLSelectElement).value as PageChromeField })">
        <option v-for="field in CHROME_FIELDS" :key="field.value" :value="field.value">{{ field.label }}</option>
      </select>
    </label>
    <label class="panel__field">
      <span class="panel__label">页脚占位 px</span>
      <input type="number" class="panel__input" min="0" max="120"
        :value="chrome?.footerSize ?? 0"
        @input="patchChrome({ footerSize: Number(($event.target as HTMLInputElement).value) })" />
    </label>
  </div>

  <p class="panel__hint">
    页眉页脚的字体 / 字号 / 对齐 / 分隔线在「功能样式 → 页面与结构页 → 页眉 / 页脚」里调。
    页脚选「不显示」时页码一并不显示（页码属页脚内容之一）；封面页按书籍惯例不标页眉页脚。
    横排下页眉页脚占用版心高度，直排下占用每列行长（列数不变）。
  </p>
</template>

<style scoped src="../../styles/settings-controls.css"></style>
