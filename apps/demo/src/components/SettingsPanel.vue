<script setup lang="ts">
/**
 * 编辑设置面板（Demo 组件）
 *
 * 收拢「版式参数」的可视化入口，全部经 App 的补丁状态生效，
 * 阅读（BtBookView / Reader）、编辑画布（BtEditor）、导出（EPUB / PDF）
 * 共用同一份 layout 与 tokens，改一处三端联动。
 *
 * 分组：
 * - 版面与页面（LayoutOptions）：书写方向 / 页面尺寸 / 分栏 / 页码样式 / 直排数字合并；
 * - 文字与版式（主题令牌）：字号 / 行高 / 注文与标题字号 / 字距 / 缩进 / 页边距 / 栏间距 / 字体族；
 * - 颜色：正文 / 背景 / 注文 / 强调 + 夜间预设；
 * - 编辑画布：分页参考线开关。
 * 「恢复主题预设」清空全部补丁回到当前主题基准值。
 */
import { computed } from 'vue';
import {
  COLOR_TOKENS,
  FONT_SIZE_TOKENS,
  FONT_TOKENS,
  LAYOUT_TOKENS,
} from '@bibliotype/core';
import {
  createPageSize,
  PAGE_NUMBER_STYLES,
  PAGE_SIZES,
  WRITING_MODES,
  isVerticalMode,
  type LayoutOptions,
  type PageNumberStyle,
  type PageSize,
  type WritingMode,
} from '@bibliotype/layout';

const props = defineProps<{
  /** 当前生效布局（主题基准 + 补丁合并后） */
  layout: LayoutOptions;
  /** 当前生效令牌表（含夜间后的最终值，控件读其展示） */
  tokens: Readonly<Record<string, string | undefined>>;
  /** 分页参考线是否显示（编辑画布） */
  pagination: boolean;
  /** 夜间预设是否开启 */
  night: boolean;
  /** 是否存在任何补丁（控制「恢复主题预设」可用性） */
  customized: boolean;
}>();

const emit = defineEmits<{
  /** 布局补丁（浅合并进 layoutPatch） */
  'update:layout': [patch: Partial<LayoutOptions>];
  /** 单令牌写入 */
  'update:token': [key: string, value: string];
  /** 分页参考线开关 */
  'update:pagination': [value: boolean];
  /** 夜间预设开关 */
  'update:night': [value: boolean];
  /** 清空全部补丁 */
  reset: [];
  /** 关闭面板 */
  close: [];
}>();

/* ---------- 数值解析工具 ---------- */

/** 解析 px / em / 纯数值串的前导数字（失败回退 fallback） */
function parseNum(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** 解析颜色令牌（input type=color 需 #rrggbb，非法回退黑色） */
function parseColor(value: string | undefined): string {
  return /^#[0-9a-fA-F]{6}$/.test(value ?? '') ? (value as string) : '#000000';
}

/* ---------- 版面与页面 ---------- */

const WRITING_ENTRIES: ReadonlyArray<[WritingMode, string]> = [
  [WRITING_MODES.HORIZONTAL_TB, '横排'],
  [WRITING_MODES.VERTICAL_RL, '竖排右起'],
  [WRITING_MODES.VERTICAL_LR, '竖排左起'],
];

const PAGE_NUMBER_ENTRIES: ReadonlyArray<[PageNumberStyle, string]> = [
  [PAGE_NUMBER_STYLES.DECIMAL, '阿拉伯数字'],
  [PAGE_NUMBER_STYLES.CHINESE, '中文数字'],
  [PAGE_NUMBER_STYLES.ROMAN, '罗马数字'],
];

const PAGE_SIZE_ENTRIES: ReadonlyArray<[string, PageSize]> = Object.entries(
  PAGE_SIZES,
) as ReadonlyArray<[string, PageSize]>;

/** 当前尺寸匹配的预设键（无匹配视为自定义） */
const pageSizeKey = computed(() => {
  const entry = PAGE_SIZE_ENTRIES.find(
    ([, size]) => size.width === props.layout.pageSize.width && size.height === props.layout.pageSize.height,
  );
  return entry?.[0] ?? 'custom';
});

/** 开本切换（自定义时保持当前宽高，由数值框调整） */
function onPageSizeChange(key: string): void {
  if (key === 'custom') return;
  const size = PAGE_SIZES[key as keyof typeof PAGE_SIZES];
  if (size !== undefined) emit('update:layout', { pageSize: size });
}

/** 自定义页面宽高（px） */
function onCustomSize(part: 'width' | 'height', value: number): void {
  const current = props.layout.pageSize;
  const next = part === 'width' ? value : current.width;
  const other = part === 'width' ? current.height : value;
  if (next <= 0 || other <= 0) return;
  emit('update:layout', { pageSize: createPageSize('自定义', next, other) });
}

/* ---------- 文字与版式 ---------- */

const FONT_SIZE_MIN = 12;
const FONT_SIZE_MAX = 24;

const fontSize = computed(() => parseNum(props.tokens[FONT_SIZE_TOKENS.BODY], 16));
const lineHeight = computed(() => parseNum(props.tokens[LAYOUT_TOKENS.LINE_HEIGHT], 1.9));

function stepFontSize(delta: number): void {
  const next = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, fontSize.value + delta));
  emit('update:token', FONT_SIZE_TOKENS.BODY, `${next}px`);
}

/** 页边距简写 → 四边数值（"48px 56px" → 上下 48 / 左右 56） */
const marginBox = computed(() => {
  const parts = (props.tokens[LAYOUT_TOKENS.PAGE_MARGIN] ?? '48px 56px')
    .split(/\s+/)
    .map((part) => parseNum(part, 0));
  const [top = 48, right = 56, bottom = top, left = right] = parts;
  return { top, right, bottom, left };
});

function onMarginPart(part: 'top' | 'right' | 'bottom' | 'left', value: number): void {
  if (!Number.isFinite(value) || value < 0) return;
  const box = { ...marginBox.value, [part]: Math.round(value) };
  emit(
    'update:token',
    LAYOUT_TOKENS.PAGE_MARGIN,
    `${box.top}px ${box.right}px ${box.bottom}px ${box.left}px`,
  );
}

/** 文本令牌输入（非法空值忽略） */
function onTokenInput(key: string, value: string): void {
  const trimmed = value.trim();
  if (trimmed !== '') emit('update:token', key, trimmed);
}

/* ---------- 颜色 ---------- */

const COLOR_ENTRIES: ReadonlyArray<[string, string]> = [
  [COLOR_TOKENS.TEXT, '正文'],
  [COLOR_TOKENS.BACKGROUND, '背景'],
  [COLOR_TOKENS.NOTE_TEXT, '注文'],
  [COLOR_TOKENS.ACCENT, '强调'],
];

/* ---------- 字体族 ---------- */

const FONT_FAMILY_ENTRIES: ReadonlyArray<[string, string]> = [
  [FONT_TOKENS.BODY, '正文'],
  [FONT_TOKENS.HEADING, '标题'],
  [FONT_TOKENS.CLASSICAL_BODY, '古籍正文'],
  [FONT_TOKENS.MONO, '等宽'],
];

const vertical = computed(() => isVerticalMode(props.layout.writingMode));
</script>

<template>
  <section class="panel">
    <header class="panel__header">
      <h2 class="panel__title">设置</h2>
      <button type="button" class="panel__close" aria-label="关闭" @click="emit('close')">×</button>
    </header>

    <!-- 版面与页面 -->
    <h3 class="panel__group-title">版面与页面</h3>
    <div class="panel__field">
      <span class="panel__label">书写方向</span>
      <div class="panel__chips">
        <button
          v-for="[mode, label] in WRITING_ENTRIES"
          :key="mode"
          type="button"
          class="panel__chip"
          :class="{ 'panel__chip--active': layout.writingMode === mode }"
          @click="emit('update:layout', { writingMode: mode })"
        >
          {{ label }}
        </button>
      </div>
    </div>
    <div class="panel__field">
      <span class="panel__label">页面尺寸</span>
      <select class="panel__input" :value="pageSizeKey" @change="onPageSizeChange(($event.target as HTMLSelectElement).value)">
        <option v-for="[key, size] in PAGE_SIZE_ENTRIES" :key="key" :value="key">{{ size.name }}</option>
        <option value="custom">自定义</option>
      </select>
    </div>
    <div v-if="pageSizeKey === 'custom'" class="panel__field panel__field--inline">
      <label class="panel__sub">
        <span class="panel__label">宽</span>
        <input
          type="number"
          class="panel__input panel__input--num"
          :value="layout.pageSize.width"
          min="1"
          @change="onCustomSize('width', Number(($event.target as HTMLInputElement).value))"
        />
      </label>
      <label class="panel__sub">
        <span class="panel__label">高</span>
        <input
          type="number"
          class="panel__input panel__input--num"
          :value="layout.pageSize.height"
          min="1"
          @change="onCustomSize('height', Number(($event.target as HTMLInputElement).value))"
        />
      </label>
    </div>
    <div class="panel__field">
      <span class="panel__label">分栏</span>
      <div class="panel__chips">
        <button
          v-for="count in 3"
          :key="count"
          type="button"
          class="panel__chip"
          :class="{ 'panel__chip--active': layout.columns === count }"
          @click="emit('update:layout', { columns: count })"
        >
          {{ count }} 栏
        </button>
      </div>
    </div>
    <div class="panel__field">
      <span class="panel__label">页码样式</span>
      <select
        class="panel__input"
        :value="layout.pageNumberStyle"
        @change="emit('update:layout', { pageNumberStyle: ($event.target as HTMLSelectElement).value as PageNumberStyle })"
      >
        <option v-for="[style, label] in PAGE_NUMBER_ENTRIES" :key="style" :value="style">{{ label }}</option>
      </select>
    </div>
    <div v-if="vertical" class="panel__field">
      <label class="panel__sub">
        <span class="panel__label">数字合并上限</span>
        <input
          type="number"
          class="panel__input panel__input--num"
          :value="layout.combineUpright.maxDigits"
          min="1"
          max="10"
          @change="
            emit('update:layout', {
              combineUpright: { ...layout.combineUpright, maxDigits: Math.min(10, Math.max(1, Number(($event.target as HTMLInputElement).value) || 4)) },
            })
          "
        />
      </label>
      <label class="panel__sub">
        <span class="panel__label">拉丁词</span>
        <select
          class="panel__input"
          :value="layout.combineUpright.latinStrategy"
          @change="
            emit('update:layout', {
              combineUpright: { ...layout.combineUpright, latinStrategy: ($event.target as HTMLSelectElement).value as 'rotate' | 'combine' },
            })
          "
        >
          <option value="rotate">侧转</option>
          <option value="combine">并入字格</option>
        </select>
      </label>
    </div>

    <!-- 文字与版式 -->
    <h3 class="panel__group-title">文字与版式</h3>
    <div class="panel__field panel__field--stepper">
      <span class="panel__label">正文字号</span>
      <button type="button" class="panel__chip" :disabled="fontSize <= FONT_SIZE_MIN" @click="stepFontSize(-2)">A−</button>
      <span class="panel__value">{{ fontSize }}px</span>
      <button type="button" class="panel__chip" :disabled="fontSize >= FONT_SIZE_MAX" @click="stepFontSize(2)">A＋</button>
    </div>
    <div class="panel__field">
      <label class="panel__slider-label">
        <span class="panel__label">行距</span>
        <span class="panel__value">{{ lineHeight.toFixed(2) }}</span>
      </label>
      <input
        type="range"
        class="panel__range"
        min="1.4"
        max="2.5"
        step="0.05"
        :value="lineHeight"
        @input="emit('update:token', LAYOUT_TOKENS.LINE_HEIGHT, String(Number(($event.target as HTMLInputElement).value)))"
      />
    </div>
    <div class="panel__field">
      <label class="panel__sub">
        <span class="panel__label">注文字号</span>
        <input class="panel__input" :value="tokens[FONT_SIZE_TOKENS.NOTE]" @change="onTokenInput(FONT_SIZE_TOKENS.NOTE, ($event.target as HTMLInputElement).value)" />
      </label>
      <label class="panel__sub">
        <span class="panel__label">标题字号</span>
        <input class="panel__input" :value="tokens[FONT_SIZE_TOKENS.HEADING]" @change="onTokenInput(FONT_SIZE_TOKENS.HEADING, ($event.target as HTMLInputElement).value)" />
      </label>
    </div>
    <div class="panel__field">
      <label class="panel__sub">
        <span class="panel__label">字距</span>
        <input class="panel__input" :value="tokens[LAYOUT_TOKENS.LETTER_SPACING]" @change="onTokenInput(LAYOUT_TOKENS.LETTER_SPACING, ($event.target as HTMLInputElement).value)" />
      </label>
      <label class="panel__sub">
        <span class="panel__label">缩进</span>
        <input class="panel__input" :value="tokens[LAYOUT_TOKENS.TEXT_INDENT]" @change="onTokenInput(LAYOUT_TOKENS.TEXT_INDENT, ($event.target as HTMLInputElement).value)" />
      </label>
    </div>
    <div class="panel__field">
      <span class="panel__label">页边距（上右下左 px）</span>
      <div class="panel__margin">
        <input
          v-for="side in (['top', 'right', 'bottom', 'left'] as const)"
          :key="side"
          type="number"
          class="panel__input panel__input--num"
          :value="marginBox[side]"
          min="0"
          @change="onMarginPart(side, Number(($event.target as HTMLInputElement).value))"
        />
      </div>
    </div>
    <div class="panel__field">
      <label class="panel__sub">
        <span class="panel__label">栏间距</span>
        <input class="panel__input" :value="tokens[LAYOUT_TOKENS.COLUMN_GAP]" @change="onTokenInput(LAYOUT_TOKENS.COLUMN_GAP, ($event.target as HTMLInputElement).value)" />
      </label>
      <label class="panel__sub">
        <span class="panel__label">版框</span>
        <input class="panel__input" :value="tokens['page-border']" placeholder="如 3px double #b09a76" @change="onTokenInput('page-border', ($event.target as HTMLInputElement).value)" />
      </label>
    </div>
    <div class="panel__field panel__field--stack">
      <label v-for="[key, label] in FONT_FAMILY_ENTRIES" :key="key" class="panel__sub panel__sub--full">
        <span class="panel__label">字体族 · {{ label }}</span>
        <input class="panel__input panel__input--family" :value="tokens[key]" @change="onTokenInput(key, ($event.target as HTMLInputElement).value)" />
      </label>
    </div>

    <!-- 颜色 -->
    <h3 class="panel__group-title">颜色</h3>
    <div class="panel__field panel__field--colors">
      <label v-for="[key, label] in COLOR_ENTRIES" :key="key" class="panel__color">
        <input
          type="color"
          :value="parseColor(tokens[key])"
          @input="emit('update:token', key, ($event.target as HTMLInputElement).value)"
        />
        <span>{{ label }}</span>
      </label>
    </div>
    <div class="panel__field">
      <label class="panel__switch">
        <input type="checkbox" :checked="night" @change="emit('update:night', ($event.target as HTMLInputElement).checked)" />
        夜间预设（覆盖配色）
      </label>
    </div>

    <!-- 编辑画布 -->
    <h3 class="panel__group-title">编辑画布</h3>
    <div class="panel__field">
      <label class="panel__switch">
        <input type="checkbox" :checked="pagination" @change="emit('update:pagination', ($event.target as HTMLInputElement).checked)" />
        分页参考线
      </label>
    </div>

    <footer class="panel__footer">
      <button type="button" class="panel__reset" :disabled="!customized" @click="emit('reset')">
        恢复主题预设
      </button>
    </footer>
  </section>
</template>

<style scoped>
.panel {
  padding: 10px 12px 14px;
  border-block-end: 1px solid var(--demo-border);
  color: var(--demo-text);
  font-size: 12px;
}

.panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.panel__title {
  font-size: 14px;
  margin: 0;
}

.panel__close {
  border: none;
  background: none;
  font-size: 16px;
  color: var(--demo-muted);
  cursor: pointer;
}

.panel__group-title {
  font-size: 12px;
  color: var(--demo-muted);
  margin: 14px 0 8px;
  padding-block-start: 8px;
  border-block-start: 1px dashed var(--demo-border);
}

.panel__group-title:first-of-type {
  border-block-start: none;
  padding-block-start: 0;
}

.panel__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;
}

.panel__field--inline {
  flex-direction: row;
  align-items: center;
  gap: 8px;
}

.panel__field--stepper {
  flex-direction: row;
  align-items: center;
  gap: 8px;
}

.panel__field--stack {
  gap: 8px;
}

.panel__label {
  color: var(--demo-muted);
}

.panel__value {
  min-width: 42px;
  text-align: center;
}

.panel__sub {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.panel__sub--full {
  flex-direction: column;
  align-items: stretch;
}

.panel__input {
  flex: 1;
  min-width: 0;
  padding: 4px 6px;
  font-size: 12px;
  color: var(--demo-text);
  background: var(--demo-control);
  border: 1px solid var(--demo-control-border);
  border-radius: 4px;
}

.panel__input--num {
  flex: 0 0 64px;
}

.panel__input--family {
  font-size: 11px;
}

.panel__chips {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.panel__chip {
  padding: 3px 8px;
  font-size: 12px;
  color: var(--demo-text);
  background: var(--demo-control);
  border: 1px solid var(--demo-control-border);
  border-radius: 4px;
  cursor: pointer;
}

.panel__chip--active {
  color: #fff;
  background: var(--demo-accent);
  border-color: var(--demo-accent);
}

.panel__chip:disabled {
  opacity: 0.45;
  cursor: default;
}

.panel__range {
  width: 100%;
  accent-color: var(--demo-accent);
}

.panel__slider-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.panel__margin {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
}

.panel__field--colors {
  flex-direction: row;
  flex-wrap: wrap;
  gap: 8px;
}

.panel__color {
  display: flex;
  align-items: center;
  gap: 4px;
}

.panel__color input {
  width: 26px;
  height: 22px;
  padding: 0;
  border: 1px solid var(--demo-control-border);
  border-radius: 4px;
  background: none;
  cursor: pointer;
}

.panel__switch {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.panel__footer {
  margin-block-start: 12px;
}

.panel__reset {
  width: 100%;
  padding: 6px;
  font-size: 12px;
  color: var(--demo-text);
  background: var(--demo-control);
  border: 1px solid var(--demo-control-border);
  border-radius: 4px;
  cursor: pointer;
}

.panel__reset:hover:not(:disabled) {
  border-color: var(--demo-accent);
  color: var(--demo-accent);
}

.panel__reset:disabled {
  opacity: 0.45;
  cursor: default;
}
</style>
