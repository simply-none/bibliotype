<script setup lang="ts">
/**
 * 「预设管理」分区：命名样式 + 样式预设 + 全局默认 / 恢复默认
 *
 * 命名样式挂到个别段落（依据链由 `resolveNamedStyleChain` 判环），样式预设与
 * 全局默认经 `api` 落盘；本区所有提示语都写 `presetMessage`，只在本区内展示。
 */
import { ref } from 'vue';
import { FEATURE_STYLE_META, resolveNamedStyleChain, type FeatureStyleId } from '@bibliotype/core';
import type { StyleSettingsApi } from '../../composables/use-style-settings.js';

const props = defineProps<{
  /** 样式设置 API（状态 + 持久化 + 预设） */
  api: StyleSettingsApi;
  /** 当前功能（命名样式以此为模板创建） */
  activeFeature: FeatureStyleId;
  /** 当前功能名（仅用于「基于 xx 的当前设置」提示） */
  featureLabel: string;
}>();

const presetName = ref('');
const presetMessage = ref('');

const styleName = ref('');

/**
 * 「依据」候选：排除自身，以及以自身为祖先的样式（选中会造成继承环）。
 */
function basedOnCandidates(styleId: string) {
  const set = props.api.panelNamedStyles.value;
  return set.styles.filter((candidate) => {
    if (candidate.id === styleId) return false;
    return !resolveNamedStyleChain(set, candidate.id).some((item) => item.id === styleId);
  });
}

/** 以当前功能（含其覆盖声明）为模板创建命名样式 */
function onCreateNamedStyle(): void {
  const name = styleName.value.trim();
  if (name === '') return;
  props.api.createNamedStyle(name, props.activeFeature);
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
</script>

<template>
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
    <li v-for="style in api.panelNamedStyles.value.styles" :key="style.id" class="panel__preset">
      <input
        class="panel__input panel__preset-name"
        :value="style.name"
        @change="api.renameNamedStyle(style.id, ($event.target as HTMLInputElement).value)"
      />
      <span class="panel__preset-meta">{{ FEATURE_STYLE_META[style.featureId].label }}</span>
      <select
        class="panel__input panel__preset-meta"
        :value="style.basedOn ?? ''"
        :title="style.basedOn ? '依据其他命名样式，声明按链合并' : '不继承其他命名样式'"
        @change="api.setNamedStyleBasedOn(style.id, ($event.target as HTMLSelectElement).value || null)"
      >
        <option value="">无依据</option>
        <option v-for="candidate in basedOnCandidates(style.id)" :key="candidate.id" :value="candidate.id">
          依据：{{ candidate.name }}
        </option>
      </select>
      <button type="button" class="panel__mini" @click="api.deleteNamedStyle(style.id)">删除</button>
    </li>
    <li v-if="api.panelNamedStyles.value.styles.length === 0" class="panel__empty">还没有命名样式</li>
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

<style scoped src="../../styles/settings-controls.css"></style>
