<script setup lang="ts">
/**
 * 「版面与页面」分区
 *
 * 覆盖书写方向 / 开本 / 分栏 / 开本适配 / 翻页动效 / 页边距 / 页底溢出 / 页码样式 /
 * 字号行距字距 / 直排数字合并 / 字体族 / 配色 / 夜间预览。
 * 版式与令牌改动一律经 `api` 写进样式草稿（保存后由父级烘焙重排）；翻页动效
 * 与夜间配色是演示态快捷预设，只上抛事件、不进草稿。
 */
import { computed } from 'vue';
import { COLOR_TOKENS, FONT_SIZE_TOKENS, FONT_TOKENS, LAYOUT_TOKENS } from '@bibliotype/core';
import {
  PAGE_NUMBER_STYLES,
  PAGE_SIZES,
  PAGE_SIZE_MODES,
  WRITING_MODES,
  createPageSize,
  isVerticalMode,
  resolveBottomSlack,
  resolvePageSizeMode,
  type LayoutOptions,
  type PageSizeMode,
} from '@bibliotype/layout';
import type { StyleSettingsApi } from '../../composables/use-style-settings.js';
import {
  SLACK_PRESET_MAP,
  extractTokenNum,
  parseMarginBox,
  resolveColorValue,
  resolveSlackPreset,
  stringifyMarginBox,
} from './settings-utils.js';

const props = defineProps<{
  /** 样式设置 API（状态 + 持久化 + 预设） */
  api: StyleSettingsApi;
  /** 当前生效布局（主题基准 + 补丁合并后） */
  layout: LayoutOptions;
  /** 当前生效令牌（含夜间覆盖） */
  tokens: Readonly<Record<string, string | undefined>>;
  /** 夜间预设开关（演示态快捷预设，不写入样式快照） */
  night: boolean;
  /** 翻页动效（D5；演示态快捷预设，不写入样式快照） */
  pageTransition?: 'slide' | 'fade' | 'none';
}>();

const emit = defineEmits<{
  'update:night': [value: boolean];
  /** 翻页动效切换（D5） */
  'update:page-transition': [value: 'slide' | 'fade' | 'none'];
}>();

const PAGE_SIZE_ENTRIES = Object.entries(PAGE_SIZES) as Array<
  [string, (typeof PAGE_SIZES)[keyof typeof PAGE_SIZES]]
>;

const pageSizeKey = computed(() => {
  const entry = PAGE_SIZE_ENTRIES.find(
    ([, size]) =>
      size.width === props.layout.pageSize.width && size.height === props.layout.pageSize.height,
  );
  return entry?.[0] ?? 'custom';
});

function onPageSize(key: string): void {
  if (key === 'custom') return;
  const size = PAGE_SIZES[key as keyof typeof PAGE_SIZES];
  if (size !== undefined) props.api.patchLayout({ pageSize: size });
}

const vertical = computed(() => isVerticalMode(props.layout.writingMode));

/**
 * 开本适配选项（自适应宽度 / 自适应高度 / 自适应 H5 / 固定）
 *
 * 「宽 / 高」两档是 **PDF 式整页缩放**：页框与分页保持开本不动，宿主用
 * `resolvePageFitScale` 按「舞台实测轴 / 开本同名轴」算倍率，文字与版面一起
 * 等比缩放（允许放大）；「自适应 H5」才是真实重排（窄页单栏）；文案不随书写
 * 方向变。本选项只写进样式草稿，开本下拉仍按声明的开本回显，不跟着变「自定义」。
 */
const pageSizeModeOptions: ReadonlyArray<{ value: PageSizeMode; label: string }> = [
  { value: PAGE_SIZE_MODES.WIDTH, label: '自适应宽度' },
  { value: PAGE_SIZE_MODES.HEIGHT, label: '自适应高度' },
  { value: PAGE_SIZE_MODES.H5, label: '自适应 H5' },
  { value: PAGE_SIZE_MODES.FIXED, label: '固定' },
];

/** 当前生效适配（缺省与脏值都读作「固定」） */
const pageSizeMode = computed(() => resolvePageSizeMode(props.layout));

const marginBox = computed(() => parseMarginBox(props.tokens[LAYOUT_TOKENS.PAGE_MARGIN]));

function setMargin(side: 'top' | 'right' | 'bottom' | 'left', raw: string): void {
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value) || value < 0) return;
  const box = { ...marginBox.value, [side]: Math.round(value) };
  props.api.setToken(LAYOUT_TOKENS.PAGE_MARGIN, stringifyMarginBox(box));
}

/**
 * 页底溢出（末行可伸入下边距的深度）
 *
 * 直排下主轴是页宽（溢出吃外边距 / 版框），不开放；容量按「不压页码带」
 * 截断（与分页侧 resolveBottomSlack 同源，此处仅用于回显）。
 */
const bodyLineSize = computed(() => {
  const size = Number.parseFloat(numOf(FONT_SIZE_TOKENS.BODY));
  return Number.isFinite(size) ? size : 16;
});
const slackPx = computed(() => {
  const lh = Number.parseFloat(numOf(LAYOUT_TOKENS.LINE_HEIGHT));
  return resolveBottomSlack(
    props.layout,
    props.tokens,
    bodyLineSize.value * (Number.isFinite(lh) ? lh : 1.9),
  );
});
const slackEnabled = computed(() => !vertical.value);

/** 页底溢出预设（custom = 自由像素） */
const SLACK_PRESETS = [
  { key: 'off', label: '关闭' },
  { key: 'half', label: '半行' },
  { key: 'full', label: '一行' },
  { key: 'custom', label: '自定义' },
] as const;

/** 当前配置是否命中预设（否则为「自定义」） */
const slackPreset = computed(() => resolveSlackPreset(props.layout.bottomSlack));

function setSlackPreset(key: string): void {
  const preset = SLACK_PRESET_MAP[key];
  if (preset !== undefined) props.api.patchLayout({ bottomSlack: preset });
}

function setSlackPx(raw: string): void {
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value) || value < 0) return;
  props.api.patchLayout({ bottomSlack: { px: Math.round(value) } });
}

/** 令牌输入（空值 = 清除覆写，回落主题基准） */
function numToken(key: string, raw: string): void {
  const trimmed = raw.trim();
  if (trimmed === '') {
    props.api.clearToken(key);
    return;
  }
  props.api.setToken(key, trimmed);
}

/** 取令牌数值部分（用于 number 输入回显） */
function numOf(key: string): string {
  return extractTokenNum(props.tokens[key]);
}

const FONT_FAMILY_FIELDS: ReadonlyArray<[string, string]> = [
  [FONT_TOKENS.BODY, '正文'],
  [FONT_TOKENS.HEADING, '标题'],
  [FONT_TOKENS.CLASSICAL_BODY, '古籍正文'],
  [FONT_TOKENS.MONO, '等宽'],
];

const COLOR_FIELDS: ReadonlyArray<[string, string]> = [
  [COLOR_TOKENS.TEXT, '正文'],
  [COLOR_TOKENS.BACKGROUND, '背景'],
  [COLOR_TOKENS.NOTE_TEXT, '注文'],
  [COLOR_TOKENS.ACCENT, '强调'],
];

/** 颜色令牌 → 取色器值（非法回退黑） */
function colorValue(key: string): string {
  return resolveColorValue(props.tokens[key]);
}

/** 翻页动效选项（D5） */
const TRANSITION_OPTIONS: ReadonlyArray<{ value: 'slide' | 'fade' | 'none'; label: string }> = [
  { value: 'slide', label: '滑动' },
  { value: 'fade', label: '淡入' },
  { value: 'none', label: '无' },
];
</script>

<template>
  <div class="panel__field">
    <span class="panel__label">书写方向</span>
    <div class="panel__chips">
      <button
        v-for="mode in [WRITING_MODES.HORIZONTAL_TB, WRITING_MODES.VERTICAL_RL, WRITING_MODES.VERTICAL_LR]"
        :key="mode"
        type="button"
        class="panel__chip"
        :class="{ 'panel__chip--active': layout.writingMode === mode }"
        @click="api.patchLayout({ writingMode: mode })"
      >
        {{ mode === WRITING_MODES.HORIZONTAL_TB ? '横排' : mode === WRITING_MODES.VERTICAL_RL ? '竖排右起' : '竖排左起' }}
      </button>
    </div>
  </div>

  <div class="panel__row">
    <label class="panel__field">
      <span class="panel__label">开本</span>
      <select class="panel__input" :value="pageSizeKey" @change="onPageSize(($event.target as HTMLSelectElement).value)">
        <option v-for="[key, size] in PAGE_SIZE_ENTRIES" :key="key" :value="key">{{ size.name }}</option>
        <option value="custom">自定义</option>
      </select>
    </label>
    <label class="panel__field">
      <span class="panel__label">分栏</span>
      <select class="panel__input" :value="layout.columns" @change="api.patchLayout({ columns: Number(($event.target as HTMLSelectElement).value) })">
        <option v-for="count in 3" :key="count" :value="count">{{ count }} 栏</option>
      </select>
    </label>
    <label class="panel__field">
      <span class="panel__label">开本适配</span>
      <select class="panel__input" :value="pageSizeMode" @change="api.patchLayout({ pageSizeMode: ($event.target as HTMLSelectElement).value })">
        <option v-for="item in pageSizeModeOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
      </select>
    </label>
  </div>

  <div class="panel__field">
    <span class="panel__label">翻页动效（D5）</span>
    <div class="panel__chips">
      <button
        v-for="item in TRANSITION_OPTIONS"
        :key="item.value"
        type="button"
        class="panel__chip"
        :class="{ 'panel__chip--active': (pageTransition ?? 'slide') === item.value }"
        @click="emit('update:page-transition', item.value)"
      >
        {{ item.label }}
      </button>
    </div>
  </div>

  <div v-if="pageSizeKey === 'custom'" class="panel__row">
    <label class="panel__field">
      <span class="panel__label">宽 px</span>
      <input
        type="number"
        class="panel__input"
        :value="layout.pageSize.width"
        min="1"
        @input="api.patchLayout({ pageSize: createPageSize('自定义', Number(($event.target as HTMLInputElement).value), layout.pageSize.height) })"
      />
    </label>
    <label class="panel__field">
      <span class="panel__label">高 px</span>
      <input
        type="number"
        class="panel__input"
        :value="layout.pageSize.height"
        min="1"
        @input="api.patchLayout({ pageSize: createPageSize('自定义', layout.pageSize.width, Number(($event.target as HTMLInputElement).value)) })"
      />
    </label>
  </div>

  <div class="panel__field">
    <span class="panel__label">页边距（上右下左 px）</span>
    <div class="panel__grid4">
      <input
        v-for="side in (['top', 'right', 'bottom', 'left'] as const)"
        :key="side"
        type="number"
        class="panel__input"
        :value="marginBox[side]"
        min="0"
        @input="setMargin(side, ($event.target as HTMLInputElement).value)"
      />
    </div>
  </div>

  <div v-if="slackEnabled" class="panel__field">
    <span class="panel__label">页底溢出（末行可伸入下边距，不压页码）</span>
    <div class="panel__chips">
      <button
        v-for="preset in SLACK_PRESETS"
        :key="preset.key"
        type="button"
        class="panel__chip"
        :class="{ 'panel__chip--active': slackPreset === preset.key }"
        @click="setSlackPreset(preset.key)"
      >
        {{ preset.label }}
      </button>
    </div>
    <input
      v-if="slackPreset === 'custom'"
      type="number"
      class="panel__input"
      :value="layout.bottomSlack?.px ?? ''"
      min="0"
      placeholder="px"
      @input="setSlackPx(($event.target as HTMLInputElement).value)"
    />
    <span class="panel__hint">生效 {{ slackPx.toFixed(1) }} px（按页码带与下边距截断）</span>
  </div>

  <div class="panel__row">
    <label class="panel__field">
      <span class="panel__label">页码样式</span>
      <select class="panel__input" :value="layout.pageNumberStyle" @change="api.patchLayout({ pageNumberStyle: ($event.target as HTMLSelectElement).value })">
        <option :value="PAGE_NUMBER_STYLES.DECIMAL">阿拉伯数字</option>
        <option :value="PAGE_NUMBER_STYLES.CHINESE">中文数字</option>
        <option :value="PAGE_NUMBER_STYLES.ROMAN">罗马数字</option>
      </select>
    </label>
    <label class="panel__field">
      <span class="panel__label">正文字号 px</span>
      <input
        type="number"
        class="panel__input"
        :value="numOf(FONT_SIZE_TOKENS.BODY)"
        min="8"
        max="48"
        @input="numToken(FONT_SIZE_TOKENS.BODY, `${($event.target as HTMLInputElement).value}px`)"
      />
    </label>
  </div>

  <div class="panel__row">
    <label class="panel__field">
      <span class="panel__label">行距</span>
      <input type="number" class="panel__input" :value="numOf(LAYOUT_TOKENS.LINE_HEIGHT)" min="1" max="3" step="0.05"
        @input="numToken(LAYOUT_TOKENS.LINE_HEIGHT, ($event.target as HTMLInputElement).value)" />
    </label>
    <label class="panel__field">
      <span class="panel__label">字距</span>
      <input type="text" class="panel__input" :value="tokens[LAYOUT_TOKENS.LETTER_SPACING] ?? ''" placeholder="0.02em"
        @input="numToken(LAYOUT_TOKENS.LETTER_SPACING, ($event.target as HTMLInputElement).value)" />
    </label>
  </div>

  <div class="panel__row">
    <label class="panel__field">
      <span class="panel__label">首行缩进</span>
      <input type="text" class="panel__input" :value="tokens[LAYOUT_TOKENS.TEXT_INDENT] ?? ''" placeholder="2em"
        @input="numToken(LAYOUT_TOKENS.TEXT_INDENT, ($event.target as HTMLInputElement).value)" />
    </label>
    <label class="panel__field">
      <span class="panel__label">栏间距</span>
      <input type="text" class="panel__input" :value="tokens[LAYOUT_TOKENS.COLUMN_GAP] ?? ''" placeholder="2.5em"
        @input="numToken(LAYOUT_TOKENS.COLUMN_GAP, ($event.target as HTMLInputElement).value)" />
    </label>
  </div>

  <div class="panel__row">
    <label class="panel__field">
      <span class="panel__label">标题字号</span>
      <input type="text" class="panel__input" :value="tokens[FONT_SIZE_TOKENS.HEADING] ?? ''" placeholder="1.75em"
        @input="numToken(FONT_SIZE_TOKENS.HEADING, ($event.target as HTMLInputElement).value)" />
    </label>
    <label class="panel__field">
      <span class="panel__label">注文字号</span>
      <input type="text" class="panel__input" :value="tokens[FONT_SIZE_TOKENS.NOTE] ?? ''" placeholder="0.75em"
        @input="numToken(FONT_SIZE_TOKENS.NOTE, ($event.target as HTMLInputElement).value)" />
    </label>
  </div>

  <div v-if="vertical" class="panel__row">
    <label class="panel__field">
      <span class="panel__label">数字合并上限</span>
      <input type="number" class="panel__input" min="1" max="10"
        :value="layout.combineUpright.maxDigits"
        @input="api.patchLayout({ combineUpright: { ...layout.combineUpright, maxDigits: Math.min(10, Math.max(1, Number(($event.target as HTMLInputElement).value) || 4)) } })" />
    </label>
    <label class="panel__field">
      <span class="panel__label">拉丁词</span>
      <select class="panel__input" :value="layout.combineUpright.latinStrategy"
        @change="api.patchLayout({ combineUpright: { ...layout.combineUpright, latinStrategy: ($event.target as HTMLSelectElement).value as 'rotate' | 'combine' } })">
        <option value="rotate">侧转</option>
        <option value="combine">并入字格</option>
      </select>
    </label>
  </div>

  <div class="panel__field">
    <span class="panel__label">字体族</span>
    <label v-for="[key, label] in FONT_FAMILY_FIELDS" :key="key" class="panel__stack">
      <span class="panel__sub-label">{{ label }}</span>
      <input type="text" class="panel__input" :value="tokens[key] ?? ''"
        @input="numToken(key, ($event.target as HTMLInputElement).value)" />
    </label>
  </div>

  <div class="panel__field">
    <span class="panel__label">配色</span>
    <div class="panel__colors">
      <label v-for="[key, label] in COLOR_FIELDS" :key="key" class="panel__color">
        <input type="color" :value="colorValue(key)" @input="api.setToken(key, ($event.target as HTMLInputElement).value)" />
        <span>{{ label }}</span>
      </label>
    </div>
  </div>

  <label class="panel__switch">
    <input type="checkbox" :checked="night" @change="emit('update:night', ($event.target as HTMLInputElement).checked)" />
    夜间配色（临时预览，不写入样式）
  </label>
</template>

<style scoped src="../../styles/settings-controls.css"></style>
