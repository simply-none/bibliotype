<script setup lang="ts">
/**
 * 「古籍仿真」分区（版框 / 界行 / 版心 + 版式模板）
 *
 * 模板点选与逐项改动都只写布局草稿（令牌由主题侧按模板 id 派生，不写令牌补丁），
 * 「已修改」判定复用 `facsimile-theme.ts` 的纯函数，保证与 App 的派生口径同源。
 */
import { computed } from 'vue';
import {
  DEFAULT_FACSIMILE_PRESET_ID,
  DEFAULT_GUTTER_FIELDS,
  FACSIMILE_FRAMES,
  FACSIMILE_PRESETS,
  FACSIMILE_RULES,
  GUTTER_FISH_TAILS,
  GUTTER_MOUTHS,
  GUTTER_SIDES,
  isVerticalMode,
  resolveFacsimileGrid,
  resolveFacsimilePreset,
  type FacsimileGutterOptions,
  type FacsimileOptions,
  type LayoutOptions,
} from '@bibliotype/layout';
import type { PageChromeField } from './settings-types.js';
import type { StyleSettingsApi } from '../../composables/use-style-settings.js';
import { isFacsimilePresetModified } from '../../facsimile-theme.js';

const props = defineProps<{
  /** 样式设置 API（状态 + 持久化 + 预设） */
  api: StyleSettingsApi;
  /** 当前生效布局（主题基准 + 补丁合并后） */
  layout: LayoutOptions;
  /** 当前生效令牌（含夜间覆盖） */
  tokens: Readonly<Record<string, string | undefined>>;
}>();

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
  { value: GUTTER_MOUTHS.BLACK, label: '细黑口' },
  { value: GUTTER_MOUTHS.BLACK_WIDE, label: '大黑口' },
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
 * 判定规则收在 `facsimile-theme.ts` 的纯函数里（只比版式字段与四个结构令牌，
 * 纯颜色令牌不参与），便于单测。
 */
const facsimileDirty = computed(() => isFacsimilePresetModified(props.layout, props.tokens));

/** 行款回显（每半页行数 / 每行字数 / 列距 / 带宽） */
const facsimileGrid = computed(() => resolveFacsimileGrid(props.layout, props.tokens));

/** 仿真装饰仅在直排下渲染（横排给提示） */
const vertical = computed(() => isVerticalMode(props.layout.writingMode));

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
</script>

<template>
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
      改版框颜色 / 界行颜色不会触发重排。
    </p>
    <p v-if="!vertical" class="panel__hint">
      仿真装饰仅在直排下渲染：当前为横排，版框 / 界行 / 版心均不显示（版式数据保留）。
    </p>
  </template>

  <p v-else class="panel__hint">
    当前未启用仿真版式：点上方任一模板即启用（模板自带直排右起与开本）。
  </p>
</template>

<style scoped src="../../styles/settings-controls.css"></style>
