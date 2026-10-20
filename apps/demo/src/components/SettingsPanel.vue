<script setup lang="ts">
/**
 * 编辑设置面板（功能细节版）
 *
 * 结构（参考 Word 的「选项 / 样式」组织方式）：
 * - 左导航：功能样式 / 版面与页面 / 页眉页脚 / 编辑行为 / 预设管理；
 * - 右侧：所选分组的表单；功能分组内先选分组、再选功能（胶囊），然后逐项改细节；
 * - 改动先进 `use-style-settings` 草稿（api 处于 draft 模式）：面板内部可感知
 *   变化，但页面 / 画布不重排；底部「保存」烘焙生效并落盘，「关闭」直接丢弃
 *   未保存改动（丢弃由父级调 api.discardDraft 完成）。
 *
 * 参数表来自 `use-style-schema.ts`，表单由 `FeatureStyleEditor` 通用渲染，
 * 因此新增参数不需要动本文件。
 */
import { computed, ref } from 'vue';
import {
  COLOR_TOKENS,
  FEATURE_STYLE_GROUPS,
  FEATURE_STYLE_IDS,
  FEATURE_STYLE_META,
  FONT_SIZE_TOKENS,
  FONT_TOKENS,
  LAYOUT_TOKENS,
  type FeatureStyleId,
} from '@bibliotype/core';
import {
  DEFAULT_FACSIMILE_PRESET_ID,
  DEFAULT_GUTTER_FIELDS,
  FACSIMILE_FRAMES,
  FACSIMILE_PRESETS,
  FACSIMILE_RULES,
  GUTTER_FISH_TAILS,
  GUTTER_MOUTHS,
  GUTTER_SIDES,
  PAGE_CHROME_FIELDS,
  PAGE_NUMBER_STYLES,
  PAGE_SIZES,
  WRITING_MODES,
  createPageSize,
  isVerticalMode,
  resolveBottomSlack,
  resolveFacsimileGrid,
  resolveFacsimilePreset,
  type BottomSlackOptions,
  type FacsimileGutterOptions,
  type FacsimileOptions,
  type LayoutOptions,
  type PageChromeField,
} from '@bibliotype/layout';
import type { StyleSettingsApi } from '../composables/use-style-settings.js';
import FeatureStyleEditor from './FeatureStyleEditor.vue';

const props = defineProps<{
  /** 样式设置 API（状态 + 持久化 + 预设） */
  api: StyleSettingsApi;
  /** 当前生效布局（主题基准 + 补丁合并后） */
  layout: LayoutOptions;
  /** 当前生效令牌（含夜间覆盖） */
  tokens: Readonly<Record<string, string | undefined>>;
  /** 夜间预设开关（演示态快捷预设，不写入样式快照） */
  night: boolean;
}>();

const emit = defineEmits<{
  'update:night': [value: boolean];
  close: [];
}>();

/* ---------- 导航 ---------- */

type PanelSection = 'features' | 'layout' | 'chrome' | 'facsimile' | 'behavior' | 'presets';

const section = ref<PanelSection>('features');
/** 功能分组（features 面板内再分） */
const group = ref<string>('text');
/** 当前编辑的功能 */
const activeFeature = ref<FeatureStyleId>('mark.underline');

const NAV: ReadonlyArray<{ id: PanelSection; label: string }> = [
  { id: 'features', label: '功能样式' },
  { id: 'layout', label: '版面与页面' },
  { id: 'chrome', label: '页眉页脚' },
  { id: 'facsimile', label: '古籍仿真' },
  { id: 'behavior', label: '编辑行为' },
  { id: 'presets', label: '预设管理' },
];

/** 当前分组的功能列表 */
const groupFeatures = computed(() =>
  FEATURE_STYLE_IDS.filter((id) => FEATURE_STYLE_META[id].group === group.value),
);

const featureLabel = computed(() => FEATURE_STYLE_META[activeFeature.value].label);
const featureDeclarations = computed(() => props.api.features.value[activeFeature.value] ?? {});

/** 已覆盖的功能数量（导航角标） */
const overriddenFeatures = computed(() => Object.keys(props.api.features.value).length);

function openFeature(id: FeatureStyleId): void {
  activeFeature.value = id;
  section.value = 'features';
}

/* ---------- 版面与页面 ---------- */

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

const marginBox = computed(() => {
  const parts = (props.tokens[LAYOUT_TOKENS.PAGE_MARGIN] ?? '48px 56px')
    .split(/\s+/)
    .map((part) => Number.parseFloat(part));
  const [top = 48, right = 56, bottom = top, left = right] = parts;
  return { top, right, bottom, left };
});

function setMargin(side: 'top' | 'right' | 'bottom' | 'left', raw: string): void {
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value) || value < 0) return;
  const box = { ...marginBox.value, [side]: Math.round(value) };
  props.api.setToken(
    LAYOUT_TOKENS.PAGE_MARGIN,
    `${box.top}px ${box.right}px ${box.bottom}px ${box.left}px`,
  );
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
const slackPreset = computed<string>(() => {
  const slack = props.layout.bottomSlack;
  if (slack === undefined) return 'custom';
  if (typeof slack.px === 'number') return slack.px <= 0 ? 'off' : 'custom';
  if (slack.lines === 0) return 'off';
  if (slack.lines === 0.5) return 'half';
  if (slack.lines === 1) return 'full';
  return 'custom';
});

function setSlackPreset(key: string): void {
  const map: Record<string, BottomSlackOptions> = {
    off: { lines: 0 },
    half: { lines: 0.5 },
    full: { lines: 1 },
  };
  const preset = map[key];
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
  return /^-?\d+(?:\.\d+)?/.exec(props.tokens[key] ?? '')?.[0] ?? '';
}

/* ---------- 古籍仿真（版框 / 界行 / 版心 + 版式模板） ---------- */

/** 版框形态选项 */
const FRAME_ENTRIES = [
  { value: FACSIMILE_FRAMES.NONE, label: '无' },
  { value: FACSIMILE_FRAMES.SINGLE, label: '四周单边' },
  { value: FACSIMILE_FRAMES.DOUBLE, label: '四周双边' },
  { value: FACSIMILE_FRAMES.LEFT_RIGHT, label: '左右双边' },
] as const;

/** 界行形态选项 */
const RULE_ENTRIES = [
  { value: FACSIMILE_RULES.NONE, label: '无' },
  { value: FACSIMILE_RULES.INK, label: '乌丝栏' },
  { value: FACSIMILE_RULES.VERMILION, label: '朱丝栏' },
] as const;

/** 版心口子选项 */
const MOUTH_ENTRIES = [
  { value: GUTTER_MOUTHS.WHITE, label: '白口' },
  { value: GUTTER_MOUTHS.BLACK, label: '黑口' },
] as const;

/** 鱼尾选项 */
const FISH_ENTRIES = [
  { value: GUTTER_FISH_TAILS.NONE, label: '无' },
  { value: GUTTER_FISH_TAILS.SINGLE, label: '单鱼尾' },
  { value: GUTTER_FISH_TAILS.DOUBLE, label: '双鱼尾' },
] as const;

/** 版心竖写字段选项（顺序与默认字段一致） */
const GUTTER_FIELD_ENTRIES: ReadonlyArray<{ value: PageChromeField; label: string }> = [
  { value: 'bookTitle', label: '书名' },
  { value: 'chapterTitle', label: '篇卷' },
  { value: 'pageNumber', label: '叶次' },
];

/** 当前仿真版式（未启用 = undefined） */
const facsimile = computed<FacsimileOptions | undefined>(() => props.layout.facsimile);

/** 当前模板 id（未套用模板时回落默认第一个） */
const facsimilePresetId = computed(
  () => facsimile.value?.preset ?? DEFAULT_FACSIMILE_PRESET_ID,
);

/** 当前模板数据 */
const facsimilePreset = computed(() => resolveFacsimilePreset(facsimilePresetId.value));

/**
 * 模板基准是否已被改动
 *
 * 只比较版式字段与四个结构令牌（字号 / 行距 / 字距 / 页边距）；夜间配色等
 * 纯颜色令牌不参与，避免夜里切一下就误报「已修改」。
 */
const facsimileDirty = computed(() => {
  const preset = facsimilePreset.value;
  const current = facsimile.value;
  if (preset === undefined || current === undefined) return false;
  if (JSON.stringify(current) !== JSON.stringify(preset.layout.facsimile)) return true;
  const structuralKeys = [
    FONT_SIZE_TOKENS.BODY,
    LAYOUT_TOKENS.LINE_HEIGHT,
    LAYOUT_TOKENS.LETTER_SPACING,
    LAYOUT_TOKENS.PAGE_MARGIN,
  ];
  return structuralKeys.some((key) => (props.tokens[key] ?? '') !== (preset.tokens[key] ?? ''));
});

/** 行款回显（每半页行数 / 每行字数 / 列距 / 带宽） */
const facsimileGrid = computed(() => resolveFacsimileGrid(props.layout, props.tokens));

/** 套用模板（单次布局补丁；令牌由主题侧按模板 id 派生，不写令牌补丁） */
function onApplyFacsimilePreset(id: string): void {
  const preset = resolveFacsimilePreset(id);
  if (preset === undefined) return;
  props.api.patchLayout(preset.layout as unknown as Record<string, unknown>);
}

/** 改版式字段（保留 preset 标识，供「已修改」与重置回显） */
function patchFacsimile(patch: Partial<FacsimileOptions>): void {
  const current = facsimile.value;
  if (current === undefined) return;
  props.api.patchLayout({ facsimile: { ...current, ...patch } });
}

/** 改版心字段 */
function patchGutter(patch: Partial<FacsimileGutterOptions>): void {
  const current = facsimile.value;
  if (current?.gutter === undefined) return;
  props.api.patchLayout({
    facsimile: { ...current, gutter: { ...current.gutter, ...patch } },
  });
}

/** 开 / 关版心（关闭 = 从布局里移除 gutter，版心带宽归零） */
function toggleGutter(enabled: boolean): void {
  const current = facsimile.value;
  if (current === undefined) return;
  if (!enabled) {
    const next: FacsimileOptions = { ...current };
    delete next.gutter;
    props.api.patchLayout({ facsimile: next });
    return;
  }
  const presetGutter = facsimilePreset.value?.layout.facsimile?.gutter;
  props.api.patchLayout({
    facsimile: {
      ...current,
      gutter: presetGutter ?? {
        side: GUTTER_SIDES.LEFT,
        size: 32,
        mouth: GUTTER_MOUTHS.WHITE,
        fishTail: GUTTER_FISH_TAILS.SINGLE,
        fields: DEFAULT_GUTTER_FIELDS,
      },
    },
  });
}

/** 勾选 / 取消版心字段（结果按默认字段顺序归一，避免抖动） */
function toggleGutterField(field: PageChromeField, checked: boolean): void {
  const gutter = facsimile.value?.gutter;
  if (gutter === undefined) return;
  const next = checked
    ? gutter.fields.filter((item) => item !== field).concat(field)
    : gutter.fields.filter((item) => item !== field);
  patchGutter({ fields: DEFAULT_GUTTER_FIELDS.filter((item) => next.includes(item)) });
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
  const value = props.tokens[key] ?? '';
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000';
}

/* ---------- 页眉页脚 ---------- */

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

/* ---------- 预设 ---------- */

const presetName = ref('');
const presetMessage = ref('');

/* ---------- 命名样式 ---------- */

const styleName = ref('');

/** 以当前功能（含其覆盖声明）为模板创建命名样式 */
function onCreateNamedStyle(): void {
  const name = styleName.value.trim();
  if (name === '') return;
  props.api.createNamedStyle(name, activeFeature.value);
  styleName.value = '';
  presetMessage.value = `已创建命名样式「${name}」（可在编辑画布的属性栏挂到段落）`;
}

async function onSavePreset(): Promise<void> {
  const name = presetName.value.trim();
  if (name === '') return;
  await props.api.saveAsPreset(name);
  presetName.value = '';
  presetMessage.value = `已保存预设「${name}」`;
}

async function onExportPreset(id: string): Promise<void> {
  const preset = props.api.presets.value.find((item) => item.id === id);
  if (preset === undefined) return;
  const json = props.api.exportPreset(preset);
  try {
    await navigator.clipboard.writeText(json);
    presetMessage.value = `预设「${preset.name}」的 JSON 已复制到剪贴板`;
  } catch {
    presetMessage.value = '复制失败：浏览器拒绝了剪贴板权限';
  }
}

async function onImportPreset(): Promise<void> {
  try {
    const json = await navigator.clipboard.readText();
    const preset = await props.api.importPreset(json);
    presetMessage.value =
      preset === undefined
        ? '导入失败：剪贴板内容不是有效的预设 JSON'
        : `已导入预设「${preset.name}」`;
  } catch {
    presetMessage.value = '导入失败：无法读取剪贴板';
  }
}

async function onGlobal(): Promise<void> {
  await props.api.saveAsGlobal();
  presetMessage.value = '已把当前配置设为全局默认（新书沿用）';
}

async function onResetAll(): Promise<void> {
  await props.api.resetAll();
  presetMessage.value = '已恢复全部默认并清除已保存的样式';
}

/* ---------- 底部保存 / 关闭 ---------- */

/** 是否存在未保存改动（草稿脏标记；非草稿模式回退常量 false） */
const dirty = computed(() => props.api.draftDirty.value);

/** 保存：把草稿烘焙进源状态（此刻一次性重排）并落盘，弹窗继续打开可接着改 */
const saving = ref(false);
async function onSave(): Promise<void> {
  if (saving.value) return;
  saving.value = true;
  try {
    await props.api.applyDraft();
  } finally {
    saving.value = false;
  }
  emit('close');
}
</script>

<template>
  <!-- 模态弹窗：遮罩点击 / 关闭按钮 / Esc（父级统一处理）关闭 -->
  <div class="dialog" role="dialog" aria-modal="true" @click.self="emit('close')">
    <section class="panel">
      <header class="panel__header">
        <h2 class="panel__title">编辑设置</h2>
        <div class="panel__meta">
          <span class="panel__store">{{ api.storeName.value }}</span>
          <button type="button" class="panel__close" aria-label="关闭" @click="emit('close')">×</button>
        </div>
      </header>

      <div class="panel__body">
        <!-- 左导航 -->
        <nav class="panel__nav">
          <button
            v-for="item in NAV"
            :key="item.id"
            type="button"
            class="panel__nav-item"
            :class="{ 'panel__nav-item--active': section === item.id }"
            @click="section = item.id"
          >
            {{ item.label }}
            <span v-if="item.id === 'features' && overriddenFeatures > 0" class="panel__nav-count">
              {{ overriddenFeatures }}
            </span>
          </button>
        </nav>

        <!-- 右内容 -->
        <div class="panel__content">
          <!-- ========== 功能样式 ========== -->
          <template v-if="section === 'features'">
            <div class="panel__chips panel__chips--groups">
              <button
                v-for="item in FEATURE_STYLE_GROUPS"
                :key="item.id"
                type="button"
                class="panel__chip"
                :class="{ 'panel__chip--active': group === item.id }"
                @click="group = item.id"
              >
                {{ item.label }}
              </button>
            </div>

            <div class="panel__chips panel__chips--features">
              <button
                v-for="id in groupFeatures"
                :key="id"
                type="button"
                class="panel__chip"
                :class="{
                  'panel__chip--active': activeFeature === id,
                  'panel__chip--dirty': api.features.value[id] !== undefined,
                }"
                @click="openFeature(id)"
              >
                {{ FEATURE_STYLE_META[id].label }}
              </button>
            </div>

            <FeatureStyleEditor
              :id="activeFeature"
              :label="featureLabel"
              :declarations="featureDeclarations"
              @declaration="(property: string, value: string | null) => api.setFeatureDeclaration(activeFeature, property, value)"
              @replace="(declarations) => api.setFeatureDeclarations(activeFeature, declarations)"
              @reset="api.resetFeature(activeFeature)"
            />
          </template>

          <!-- ========== 版面与页面 ========== -->
          <template v-else-if="section === 'layout'">
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

          <!-- ========== 页眉页脚 ========== -->
          <template v-else-if="section === 'chrome'">
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

          <!-- ========== 古籍仿真（版框 / 界行 / 版心） ========== -->
          <template v-else-if="section === 'facsimile'">
            <p class="panel__hint">
              按木刻古籍还原版框 / 界行 / 版心，与「古籍直排」并列、互不影响。
              点选模板即写入草稿，点「保存」后生效；首次进入「古籍仿真直排」主题时已默认套用第一个模板。
            </p>

            <div class="panel__field">
              <span class="panel__label">
                版式模板<template v-if="facsimileDirty">（已修改，基于{{ facsimilePreset?.label ?? '当前模板' }}）</template>
              </span>
              <div class="panel__chips">
                <button
                  v-for="preset in FACSIMILE_PRESETS"
                  :key="preset.id"
                  type="button"
                  class="panel__chip"
                  :class="{ 'panel__chip--active': facsimilePresetId === preset.id }"
                  @click="onApplyFacsimilePreset(preset.id)"
                >
                  {{ preset.label }}
                </button>
              </div>
              <span class="panel__hint">{{ facsimilePreset?.description ?? '未套用模板' }}</span>
              <button
                v-if="facsimileDirty"
                type="button"
                class="panel__mini"
                @click="onApplyFacsimilePreset(facsimilePresetId)"
              >
                恢复模板默认
              </button>
            </div>

            <template v-if="facsimile">
              <div class="panel__row">
                <div class="panel__field">
                  <span class="panel__label">版框</span>
                  <div class="panel__chips">
                    <button
                      v-for="item in FRAME_ENTRIES"
                      :key="item.value"
                      type="button"
                      class="panel__chip"
                      :class="{ 'panel__chip--active': facsimile.frame === item.value }"
                      @click="patchFacsimile({ frame: item.value })"
                    >
                      {{ item.label }}
                    </button>
                  </div>
                </div>
                <div class="panel__field">
                  <span class="panel__label">界行</span>
                  <div class="panel__chips">
                    <button
                      v-for="item in RULE_ENTRIES"
                      :key="item.value"
                      type="button"
                      class="panel__chip"
                      :class="{ 'panel__chip--active': facsimile.rule === item.value }"
                      @click="patchFacsimile({ rule: item.value })"
                    >
                      {{ item.label }}
                    </button>
                  </div>
                </div>
              </div>

              <label class="panel__switch">
                <input
                  type="checkbox"
                  :checked="facsimile.gutter !== undefined"
                  @change="toggleGutter(($event.target as HTMLInputElement).checked)"
                />
                显示版心（书口：书名 / 篇卷 / 叶次 + 鱼尾）
              </label>

              <template v-if="facsimile.gutter">
                <div class="panel__row">
                  <div class="panel__field">
                    <span class="panel__label">口子</span>
                    <div class="panel__chips">
                      <button
                        v-for="item in MOUTH_ENTRIES"
                        :key="item.value"
                        type="button"
                        class="panel__chip"
                        :class="{ 'panel__chip--active': facsimile.gutter?.mouth === item.value }"
                        @click="patchGutter({ mouth: item.value })"
                      >
                        {{ item.label }}
                      </button>
                    </div>
                  </div>
                  <div class="panel__field">
                    <span class="panel__label">鱼尾</span>
                    <div class="panel__chips">
                      <button
                        v-for="item in FISH_ENTRIES"
                        :key="item.value"
                        type="button"
                        class="panel__chip"
                        :class="{ 'panel__chip--active': facsimile.gutter?.fishTail === item.value }"
                        @click="patchGutter({ fishTail: item.value })"
                      >
                        {{ item.label }}
                      </button>
                    </div>
                  </div>
                </div>

                <label class="panel__field">
                  <span class="panel__label">版心带宽 px（从版心扣除，改动会重排）</span>
                  <input
                    type="number"
                    class="panel__input"
                    min="0"
                    max="120"
                    :value="facsimile.gutter?.size ?? 0"
                    @input="patchGutter({ size: Number(($event.target as HTMLInputElement).value) })"
                  />
                </label>

                <div class="panel__field">
                  <span class="panel__label">版心内容</span>
                  <div class="panel__chips">
                    <button
                      v-for="item in GUTTER_FIELD_ENTRIES"
                      :key="item.value"
                      type="button"
                      class="panel__chip"
                      :class="{ 'panel__chip--active': facsimile.gutter?.fields.includes(item.value) }"
                      @click="toggleGutterField(item.value, !(facsimile.gutter?.fields.includes(item.value) ?? false))"
                    >
                      {{ item.label }}
                    </button>
                  </div>
                </div>
              </template>

              <p class="panel__hint">
                行款：每半页 {{ facsimileGrid.linesPerHalfLeaf }} 行 × 每行
                {{ facsimileGrid.charsPerColumn }} 字（列距 {{ facsimileGrid.linePitch }}px，
                版心带宽 {{ facsimileGrid.gutterSize }}px，版心宽 {{ facsimileGrid.contentWidth }}px）。
                装饰只在直排下渲染；改版框颜色 / 界行颜色不会触发重排。
              </p>
            </template>

            <p v-else class="panel__hint">
              当前未启用仿真版式：点上方任一模板即启用（模板自带直排右起与开本）。
            </p>
          </template>

          <!-- ========== 编辑行为 ========== -->
          <template v-else-if="section === 'behavior'">
            <label class="panel__switch">
              <input type="checkbox" :checked="api.editing.value.readonly"
                @change="api.patchEditing({ readonly: ($event.target as HTMLInputElement).checked })" />
              只读模式（禁止输入 / 粘贴 / 拖拽）
            </label>
            <label class="panel__switch">
              <input type="checkbox" :checked="api.editing.value.pagination"
                @change="api.patchEditing({ pagination: ($event.target as HTMLInputElement).checked })" />
              书页分页（关闭 = 连续画布）
            </label>
            <label class="panel__switch">
              <input type="checkbox" :checked="api.editing.value.inheritBlockType"
                @change="api.patchEditing({ inheritBlockType: ($event.target as HTMLInputElement).checked })" />
              回车后继承当前块类型
            </label>

            <div class="panel__row">
              <label class="panel__field">
                <span class="panel__label">自动保存间隔 ms</span>
                <input type="number" class="panel__input" min="500" max="10000" step="100"
                  :value="api.editing.value.autosaveDelay"
                  @input="api.patchEditing({ autosaveDelay: Number(($event.target as HTMLInputElement).value) })" />
              </label>
              <label class="panel__field">
                <span class="panel__label">撤销合并 ms</span>
                <input type="number" class="panel__input" min="100" max="2000" step="50"
                  :value="api.editing.value.historyGroupDelay"
                  @input="api.patchEditing({ historyGroupDelay: Number(($event.target as HTMLInputElement).value) })" />
              </label>
            </div>

            <label class="panel__field">
              <span class="panel__label">粘贴策略</span>
              <select class="panel__input" :value="api.editing.value.pasteMode"
                @change="api.patchEditing({ pasteMode: ($event.target as HTMLSelectElement).value as 'rich' | 'plain' | 'structure' })">
                <option value="rich">保留样式</option>
                <option value="structure">仅结构（丢内联样式）</option>
                <option value="plain">纯文本</option>
              </select>
            </label>
          </template>

          <!-- ========== 预设管理 ========== -->
          <template v-else>
            <h5 class="panel__group-title">命名样式（挂到个别段落）</h5>
            <div class="panel__row">
              <label class="panel__field">
                <span class="panel__label">样式名（基于「{{ featureLabel }}」的当前设置）</span>
                <input v-model="styleName" type="text" class="panel__input" placeholder="如：引文-楷体" />
              </label>
              <button type="button" class="panel__primary" :disabled="styleName.trim() === ''" @click="onCreateNamedStyle">
                创建
              </button>
            </div>
            <ul class="panel__presets">
              <li v-for="style in api.namedStyles.value.styles" :key="style.id" class="panel__preset">
                <input
                  class="panel__input panel__preset-name"
                  :value="style.name"
                  @change="api.renameNamedStyle(style.id, ($event.target as HTMLInputElement).value)"
                />
                <span class="panel__preset-meta">{{ FEATURE_STYLE_META[style.featureId].label }}</span>
                <button type="button" class="panel__mini" @click="api.deleteNamedStyle(style.id)">删除</button>
              </li>
              <li v-if="api.namedStyles.value.styles.length === 0" class="panel__empty">还没有命名样式</li>
            </ul>

            <h5 class="panel__group-title">样式预设</h5>
            <div class="panel__row">
              <label class="panel__field">
                <span class="panel__label">预设名称</span>
                <input v-model="presetName" type="text" class="panel__input" placeholder="如：中华书局风" />
              </label>
              <button type="button" class="panel__primary" :disabled="presetName.trim() === ''" @click="onSavePreset">
                保存为预设
              </button>
            </div>

            <ul class="panel__presets">
              <li v-for="preset in api.presets.value" :key="preset.id" class="panel__preset">
                <span class="panel__preset-name">{{ preset.name }}</span>
                <span class="panel__preset-meta">{{ preset.basedOn === 'classical' ? '古籍' : '现代' }}</span>
                <button type="button" class="panel__mini" @click="api.applyPreset(preset)">套用</button>
                <button type="button" class="panel__mini" @click="onExportPreset(preset.id)">复制 JSON</button>
                <button type="button" class="panel__mini" @click="api.deletePreset(preset.id)">删除</button>
              </li>
              <li v-if="api.presets.value.length === 0" class="panel__empty">还没有预设</li>
            </ul>

            <div class="panel__row">
              <button type="button" class="panel__secondary" @click="onImportPreset">从剪贴板导入</button>
              <button type="button" class="panel__secondary" @click="onGlobal">设为全局默认</button>
            </div>

            <p v-if="presetMessage !== ''" class="panel__hint panel__hint--ok">{{ presetMessage }}</p>

            <div class="panel__footer">
              <button type="button" class="panel__danger" @click="onResetAll">恢复全部默认并清除已存样式</button>
            </div>
          </template>
        </div>
      </div>

      <!-- 底部动作条：改动先进草稿，「保存」后才烘焙生效（避免逐字段重排） -->
      <footer class="panel__actions">
        <span v-if="dirty" class="panel__actions-hint">有未保存的改动，关闭将丢弃</span>
        <div class="panel__actions-buttons">
          <button
            type="button"
            class="panel__secondary"
            :title="dirty ? '丢弃未保存改动并关闭' : '关闭弹窗'"
            @click="emit('close')"
          >
            关闭
          </button>
          <button
            type="button"
            class="panel__primary"
            :disabled="!dirty || saving"
            @click="onSave"
          >
            {{ saving ? '保存中…' : '保存' }}
          </button>
        </div>
      </footer>
    </section>
  </div>
</template>

<style scoped>
/* 遮罩层：固定居中，点击遮罩关闭（面板自身吞掉点击）；模糊遮罩与正文分层（主流弹窗惯例） */
.dialog {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(24, 21, 16, 0.45);
  backdrop-filter: blur(3px);
}

/* 弹窗卡片：定宽 + 限高，内容区独立滚动 */
.panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 880px;
  height: min(82vh, 720px);
  overflow: hidden;
  color: var(--demo-text);
  font-size: 12px;
  background: var(--demo-panel, #f4f0e8);
  border: 1px solid var(--demo-border, #e2ddd2);
  border-radius: 10px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
}

.panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 18px 10px;
  border-block-end: 1px solid var(--demo-border);
}

.panel__title {
  margin: 0;
  font-size: 14px;
}

.panel__meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.panel__store {
  font-size: 10px;
  color: var(--demo-muted);
  border: 1px solid var(--demo-control-border);
  border-radius: 8px;
  padding: 0 6px;
}

.panel__close {
  border: none;
  background: none;
  font-size: 16px;
  color: var(--demo-muted);
  cursor: pointer;
}

.panel__body {
  display: flex;
  min-height: 0;
  flex: 1;
}

.panel__nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 8px;
  width: 132px;
  flex: 0 0 132px;
  border-inline-end: 1px solid var(--demo-border);
}

.panel__nav-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  padding: 5px 8px;
  font-size: 12px;
  text-align: start;
  color: var(--demo-text);
  background: none;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.panel__nav-item--active {
  background: var(--demo-control);
  color: var(--demo-accent);
  font-weight: 600;
}

.panel__nav-count {
  font-size: 10px;
  color: var(--demo-accent);
}

.panel__content {
  flex: 1;
  min-width: 0;
  padding: 12px 18px 18px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.panel__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.panel__chips--groups {
  padding-block-end: 6px;
  border-block-end: 1px dashed var(--demo-border);
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

.panel__chip--dirty:not(.panel__chip--active) {
  border-color: var(--demo-accent);
  color: var(--demo-accent);
}

.panel__field {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.panel__row {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}

.panel__row > .panel__field {
  flex: 1;
}

.panel__label {
  font-size: 11px;
  color: var(--demo-muted);
}

.panel__group-title {
  margin: 6px 0 2px;
  font-size: 11px;
  font-weight: 600;
  color: var(--demo-muted);
  padding-block-start: 6px;
  border-block-start: 1px dashed var(--demo-border);
}

.panel__sub-label {
  font-size: 10px;
  color: var(--demo-muted);
}

.panel__stack {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.panel__input {
  width: 100%;
  min-width: 0;
  padding: 4px 6px;
  font-size: 12px;
  color: var(--demo-text);
  background: var(--demo-control);
  border: 1px solid var(--demo-control-border);
  border-radius: 4px;
}

.panel__grid4 {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 4px;
}

.panel__colors {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.panel__color {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--demo-muted);
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
  font-size: 12px;
  cursor: pointer;
}

.panel__hint {
  margin: 0;
  font-size: 11px;
  line-height: 1.6;
  color: var(--demo-muted);
}

.panel__hint--ok {
  color: var(--demo-accent);
}

.panel__primary,
.panel__secondary,
.panel__danger,
.panel__mini {
  font-size: 12px;
  padding: 5px 10px;
  border-radius: 4px;
  cursor: pointer;
  background: var(--demo-control);
  border: 1px solid var(--demo-control-border);
  color: var(--demo-text);
}

.panel__primary {
  color: #fff;
  background: var(--demo-accent);
  border-color: var(--demo-accent);
  flex: 0 0 auto;
}

.panel__primary:disabled {
  opacity: 0.45;
  cursor: default;
}

.panel__mini {
  font-size: 11px;
  padding: 2px 6px;
}

.panel__danger {
  width: 100%;
  color: #c0392b;
  border-color: #c0392b;
}

.panel__presets {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.panel__preset {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
  border-block-end: 1px dashed var(--demo-border);
}

.panel__preset-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.panel__preset-meta {
  font-size: 10px;
  color: var(--demo-muted);
}

.panel__empty {
  font-size: 11px;
  color: var(--demo-muted);
}

.panel__footer {
  margin-block-start: auto;
  padding-block-start: 10px;
}

/* 底部动作条：与内容区分隔，保存（主）/ 关闭（次）右对齐 */
.panel__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding: 10px 18px;
  border-block-start: 1px solid var(--demo-border);
  background: var(--demo-panel, #f4f0e8);
}

.panel__actions-hint {
  font-size: 11px;
  color: var(--demo-accent);
}

.panel__actions-buttons {
  display: flex;
  gap: 8px;
}

.panel__actions-buttons .panel__primary,
.panel__actions-buttons .panel__secondary {
  min-width: 72px;
}
</style>
