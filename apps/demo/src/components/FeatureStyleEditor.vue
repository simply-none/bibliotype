<script setup lang="ts">
/**
 * 功能样式编辑器（通用表单渲染器）
 *
 * 输入「功能 id + 该功能的声明」，按 `use-style-schema.ts` 的字段元数据自动生成控件：
 * 分组小节 → 控件（下拉 / 分段 / 数值 / 文本 / 颜色 / 滑块）→ 自定义声明兜底。
 *
 * 设计要点：
 * - **不写死任何一个功能**：新增参数只改元数据表；
 * - 未登记字段的功能也能配：底部「自定义声明」直接写 `属性: 值;`，
 *   保证「每个功能都能改细节」没有死角；
 * - 清空控件 = 删除该条声明（回落默认样式），而不是写空串。
 */
import { computed, ref, watch } from 'vue';
import type { FeatureDeclarations, FeatureStyleId } from '@bibliotype/core';
import { getStyleFields, listSections, type StyleField } from '../composables/use-style-schema.js';

const props = defineProps<{
  /** 功能 id */
  id: FeatureStyleId;
  /** 该功能当前生效的声明（用户覆盖部分） */
  declarations: FeatureDeclarations;
  /** 功能中文名 */
  label: string;
}>();

const emit = defineEmits<{
  /** 单条声明变更（value 为 null 表示删除） */
  declaration: [property: string, value: string | null];
  /** 整体替换声明（自定义声明文本框） */
  replace: [declarations: FeatureDeclarations];
  /** 恢复该功能默认样式 */
  reset: [];
}>();

const fields = computed<StyleField[]>(() => getStyleFields(props.id));
const sections = computed(() => listSections(fields.value));

/** 按小节取字段 */
function sectionFields(section: string): StyleField[] {
  return fields.value.filter((field) => (field.section ?? '基本') === section);
}

/** 取声明值（不存在返回空串） */
function valueOf(property: string): string {
  return props.declarations[property] ?? '';
}

/** 数值部分（'1.6em' → '1.6'） */
function numericOf(property: string): string {
  const match = /^-?\d+(?:\.\d+)?/.exec(valueOf(property));
  return match?.[0] ?? '';
}

/** 颜色部分（非 #rrggbb 时回退黑色，仅影响取色器显示） */
function colorOf(property: string): string {
  const value = valueOf(property).trim();
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000';
}

/** 色值是否为合法 hex（决定取色器是否显示「已改」态） */
function hasColor(property: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(valueOf(property).trim());
}

/** 提交数值（空 → 删除声明） */
function commitNumber(field: StyleField, raw: string): void {
  const trimmed = raw.trim();
  if (trimmed === '') {
    emit('declaration', field.property, null);
    return;
  }
  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed)) return;
  emit('declaration', field.property, `${parsed}${field.unit ?? ''}`);
}

/** 提交文本（空 → 删除声明） */
function commitText(field: StyleField, raw: string): void {
  const trimmed = raw.trim();
  emit('declaration', field.property, trimmed === '' ? null : trimmed);
}

/** 是否被覆盖（用于「已改」标记） */
function isOverridden(property: string): boolean {
  return property in props.declarations;
}

/** 已覆盖项数量 */
const overriddenCount = computed(() => Object.keys(props.declarations).length);

/* ---------- 自定义声明文本 ---------- */

/** 声明对象 → 文本（每行一条） */
function toText(declarations: FeatureDeclarations): string {
  return Object.entries(declarations)
    .map(([property, value]) => `${property}: ${value};`)
    .join('\n');
}

const rawText = ref(toText(props.declarations));
const rawError = ref('');

watch(
  () => props.declarations,
  (next) => {
    /* 表单改动会回流：仅当语义不同才覆盖文本框，避免打断正在编辑的光标 */
    if (parseDeclarations(rawText.value) === undefined) return;
    const same =
      JSON.stringify(sortRecord(parseDeclarations(rawText.value) ?? {})) ===
      JSON.stringify(sortRecord(next));
    if (!same) {
      rawText.value = toText(next);
      rawError.value = '';
    }
  },
  { deep: true },
);

/** 键排序（用于比较两份声明是否等价） */
function sortRecord(record: FeatureDeclarations): FeatureDeclarations {
  const sorted: FeatureDeclarations = {};
  for (const key of Object.keys(record).sort()) sorted[key] = record[key] as string;
  return sorted;
}

/** 解析 `属性: 值;` 文本（非法行忽略；全空返回空对象） */
function parseDeclarations(text: string): FeatureDeclarations | undefined {
  const result: FeatureDeclarations = {};
  for (const line of text.split(/[;\n]/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('/*')) continue;
    const index = trimmed.indexOf(':');
    if (index <= 0) {
      rawError.value = `无法识别：${trimmed}`;
      return undefined;
    }
    const property = trimmed.slice(0, index).trim().toLowerCase();
    const value = trimmed.slice(index + 1).trim();
    if (property === '' || value === '') continue;
    result[property] = value;
  }
  rawError.value = '';
  return result;
}

/** 应用自定义声明 */
function applyRaw(): void {
  const parsed = parseDeclarations(rawText.value);
  if (parsed === undefined) return;
  emit('replace', parsed);
}
</script>

<template>
  <section class="fs">
    <header class="fs__header">
      <h4 class="fs__title">{{ label }}</h4>
      <div class="fs__actions">
        <span v-if="overriddenCount > 0" class="fs__badge">已改 {{ overriddenCount }}</span>
        <button
          type="button"
          class="fs__reset"
          :disabled="overriddenCount === 0"
          @click="emit('reset')"
        >
          恢复默认
        </button>
      </div>
    </header>

    <p v-if="fields.length === 0" class="fs__empty">
      该功能暂无结构化参数，可用下方「自定义声明」直接写 CSS。
    </p>

    <div v-for="section in sections" :key="section" class="fs__section">
      <h5 class="fs__section-title">{{ section }}</h5>
      <div class="fs__grid">
        <label
          v-for="field in sectionFields(section)"
          :key="field.property"
          class="fs__field"
          :class="{ 'fs__field--wide': field.control === 'text' }"
          :title="field.hint ?? field.property"
        >
          <span class="fs__label">
            {{ field.label }}
            <i v-if="isOverridden(field.property)" class="fs__dot" title="已覆盖"></i>
          </span>

          <!-- 下拉 -->
          <select
            v-if="field.control === 'select'"
            class="fs__control"
            :value="valueOf(field.property)"
            @change="commitText(field, ($event.target as HTMLSelectElement).value)"
          >
            <option value="">默认</option>
            <option v-for="option in field.options" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>

          <!-- 分段 -->
          <div v-else-if="field.control === 'chips'" class="fs__chips">
            <button
              v-for="option in field.options"
              :key="option.value"
              type="button"
              class="fs__chip"
              :class="{ 'fs__chip--active': valueOf(field.property) === option.value }"
              @click="commitText(field, valueOf(field.property) === option.value ? '' : option.value)"
            >
              {{ option.label }}
            </button>
          </div>

          <!-- 颜色 -->
          <div v-else-if="field.control === 'color'" class="fs__color">
            <input
              type="color"
              class="fs__color-input"
              :value="colorOf(field.property)"
              @input="emit('declaration', field.property, ($event.target as HTMLInputElement).value)"
            />
            <span class="fs__color-value">{{ hasColor(field.property) ? valueOf(field.property) : '默认' }}</span>
            <button
              v-if="hasColor(field.property)"
              type="button"
              class="fs__color-clear"
              title="恢复默认"
              @click="emit('declaration', field.property, null)"
            >
              ×
            </button>
          </div>

          <!-- 数值 -->
          <span v-else-if="field.control === 'number'" class="fs__number">
            <input
              type="number"
              class="fs__control fs__control--num"
              :value="numericOf(field.property)"
              :min="field.min"
              :max="field.max"
              :step="field.step ?? 1"
              :placeholder="field.placeholder ?? String(field.min ?? '')"
              @change="commitNumber(field, ($event.target as HTMLInputElement).value)"
            />
            <span v-if="field.unit" class="fs__unit">{{ field.unit }}</span>
          </span>

          <!-- 文本 -->
          <input
            v-else
            type="text"
            class="fs__control"
            :value="valueOf(field.property)"
            :placeholder="field.placeholder ?? '默认'"
            @change="commitText(field, ($event.target as HTMLInputElement).value)"
          />
        </label>
      </div>
    </div>

    <details class="fs__raw">
      <summary class="fs__raw-summary">自定义声明（CSS）</summary>
      <textarea
        v-model="rawText"
        class="fs__raw-text"
        rows="6"
        spellcheck="false"
        placeholder="每行一条，例如：&#10;font-size: 0.72em&#10;letter-spacing: 0.05em"
        @blur="applyRaw"
      ></textarea>
      <p v-if="rawError !== ''" class="fs__raw-error">{{ rawError }}</p>
      <p class="fs__raw-hint">
        属性名用 kebab-case；无需写选择器（已自动限定到「{{ label }}」）。改动失焦即生效。
      </p>
    </details>
  </section>
</template>

<style scoped>
.fs {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.fs__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.fs__title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--demo-text);
}

.fs__actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.fs__badge {
  font-size: 11px;
  color: var(--demo-accent);
  border: 1px solid var(--demo-accent);
  border-radius: 10px;
  padding: 0 6px;
  line-height: 16px;
}

.fs__reset {
  font-size: 11px;
  padding: 2px 8px;
  color: var(--demo-muted);
  background: var(--demo-control);
  border: 1px solid var(--demo-control-border);
  border-radius: 4px;
  cursor: pointer;
}

.fs__reset:disabled {
  opacity: 0.45;
  cursor: default;
}

.fs__empty {
  margin: 0;
  font-size: 11px;
  color: var(--demo-muted);
}

.fs__section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.fs__section-title {
  margin: 0;
  font-size: 11px;
  font-weight: 500;
  color: var(--demo-muted);
}

.fs__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 8px;
}

.fs__field {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.fs__field--wide {
  grid-column: span 2;
}

.fs__label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--demo-muted);
}

.fs__dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--demo-accent);
}

.fs__control {
  width: 100%;
  min-width: 0;
  padding: 3px 6px;
  font-size: 12px;
  color: var(--demo-text);
  background: var(--demo-control);
  border: 1px solid var(--demo-control-border);
  border-radius: 4px;
}

.fs__control--num {
  flex: 1;
}

.fs__number {
  display: flex;
  align-items: center;
  gap: 4px;
}

.fs__unit {
  font-size: 11px;
  color: var(--demo-muted);
}

.fs__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.fs__chip {
  padding: 2px 7px;
  font-size: 11px;
  color: var(--demo-text);
  background: var(--demo-control);
  border: 1px solid var(--demo-control-border);
  border-radius: 4px;
  cursor: pointer;
}

.fs__chip--active {
  color: #fff;
  background: var(--demo-accent);
  border-color: var(--demo-accent);
}

.fs__color {
  display: flex;
  align-items: center;
  gap: 6px;
}

.fs__color-input {
  width: 28px;
  height: 22px;
  padding: 0;
  border: 1px solid var(--demo-control-border);
  border-radius: 4px;
  background: none;
  cursor: pointer;
}

.fs__color-value {
  font-size: 11px;
  color: var(--demo-muted);
  font-family: var(--demo-mono, monospace);
}

.fs__color-clear {
  border: none;
  background: none;
  color: var(--demo-muted);
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
}

.fs__raw {
  border-top: 1px dashed var(--demo-border);
  padding-top: 6px;
}

.fs__raw-summary {
  font-size: 11px;
  color: var(--demo-muted);
  cursor: pointer;
}

.fs__raw-text {
  width: 100%;
  margin-top: 6px;
  padding: 6px;
  font-family: var(--demo-mono, monospace);
  font-size: 11px;
  line-height: 1.5;
  color: var(--demo-text);
  background: var(--demo-control);
  border: 1px solid var(--demo-control-border);
  border-radius: 4px;
  resize: vertical;
}

.fs__raw-error {
  margin: 4px 0 0;
  font-size: 11px;
  color: #c0392b;
}

.fs__raw-hint {
  margin: 4px 0 0;
  font-size: 10px;
  color: var(--demo-muted);
}
</style>
