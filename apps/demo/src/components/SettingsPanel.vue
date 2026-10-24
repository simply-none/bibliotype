<script setup lang="ts">
/**
 * 编辑设置面板（功能细节版）
 *
 * 结构（参考 Word 的「选项 / 样式」组织方式）：
 * - 左导航：功能样式 / 版面与页面 / 页眉页脚 / 古籍仿真 / 界面外观 / 外观主题 /
 *   编辑行为 / 预设管理；
 * - 右侧：所选分区的表单。本文件只做「外壳 + 导航 + 组装」——版面与页面、古籍
 *   仿真、页眉页脚、界面外观、外观主题、预设管理六个分区拆在 `./settings/` 下，
 *   功能样式与编辑行为两区与 `api` 的声明式绑定过密，留在本文件；
 * - 改动先进 `use-style-settings` 草稿（api 处于 draft 模式）：面板内部可感知
 *   变化（选中态读 api 的面板视图与父级传入的草稿层合并结果），但页面 / 画布
 *   不重排；底部「保存」烘焙生效并落盘，「关闭」直接丢弃
 *   未保存改动（丢弃由父级调 api.discardDraft 完成）。
 *
 * 参数表来自 `use-style-schema.ts`，表单由 `FeatureStyleEditor` 通用渲染，
 * 因此新增参数不需要动本文件。
 */
import { computed, ref } from 'vue';
import {
  FEATURE_STYLE_GROUPS,
  FEATURE_STYLE_IDS,
  FEATURE_STYLE_META,
  type BookDocument,
  type FeatureStyleId,
} from '@bibliotype/core';
import type { LayoutOptions } from '@bibliotype/layout';
import { BT_BREAKPOINTS, useBreakpoint } from '@bibliotype/vue';
import type { PdfExportMode, PdfRasterScale } from '../composables/use-settings-snapshot.js';
import type { StyleSettingsApi } from '../composables/use-style-settings.js';
import type { UiDensity, UiMotion, UiSkinKey } from '../ui-skin.js';
import AppIcon from './AppIcon.vue';
import FeatureStyleEditor from './FeatureStyleEditor.vue';
import SettingsAppearance from './settings/SettingsAppearance.vue';
import SettingsFacsimile from './settings/SettingsFacsimile.vue';
import SettingsLayoutSection from './settings/SettingsLayoutSection.vue';
import SettingsMisc from './settings/SettingsMisc.vue';
import SettingsPageChrome from './settings/SettingsPageChrome.vue';
import SettingsStylesSection from './settings/SettingsStylesSection.vue';
import SettingsUiSkin from './settings/SettingsUiSkin.vue';

const props = defineProps<{
  /** 样式设置 API（状态 + 持久化 + 预设） */
  api: StyleSettingsApi;
  /** 当前生效布局（主题基准 + 补丁合并后） */
  layout: LayoutOptions;
  /** 当前生效令牌（含夜间覆盖） */
  tokens: Readonly<Record<string, string | undefined>>;
  /** 主题基线令牌（不含用户补丁与夜间覆盖，主题预设重置目标） */
  themeBaseTokens?: Readonly<Record<string, string | undefined>>;
  /** 当前文档（缺字检查扫描对象） */
  document?: BookDocument;
  /** 翻页动效（D5；演示态快捷预设，不写入样式快照） */
  pageTransition?: 'slide' | 'fade' | 'none';
  /** 生效层整页缩放倍率（width / height 档；「开本适配」回显用） */
  fitScale?: number;
  night: boolean;
  /** 界面皮肤（美化 P4）：壳层色板，与阅读纸色（主题令牌）互不干涉 */
  uiSkin: UiSkinKey;
  /** 界面密度：只缩放间距与行高，不动字号与 44px 触控目标 */
  uiDensity: UiDensity;
  /** 动效开关：auto = 跟随系统 prefers-reduced-motion */
  uiMotion: UiMotion;
  /** PDF 导出方式（「其他」分区；应用级偏好，Electron 宿主不受影响） */
  pdfExportMode: PdfExportMode;
  /** 光栅直出清晰度档位（「其他」分区；仅应用内直出生效） */
  pdfRasterScale: PdfRasterScale;
}>();

const emit = defineEmits<{
  'update:night': [value: boolean];
  /** 翻页动效切换（D5） */
  'update:page-transition': [value: 'slide' | 'fade' | 'none'];
  'update:ui-skin': [value: UiSkinKey];
  'update:ui-density': [value: UiDensity];
  'update:ui-motion': [value: UiMotion];
  /** PDF 导出方式切换（「其他」分区） */
  'update:pdf-export-mode': [value: PdfExportMode];
  /** 光栅清晰度切换（「其他」分区） */
  'update:pdf-raster-scale': [value: PdfRasterScale];
  /** 主题预设应用（全量令牌，由 App 收敛为与基线的差量） */
  'apply-theme-tokens': [tokens: Record<string, string>];
  close: [];
}>();

/**
 * H5 断点（C2）：窄屏模态转全屏页
 *
 * 与样式表里的 `@media (max-width: 767px)` 同口径，额外落一个可断言的类名 /
 * data 钩子——happy-dom 不会执行媒体查询，测试只能靠语义钩子判断布局分支。
 */
const breakpoint = useBreakpoint();
const mobileLayout = computed(() => breakpoint.width.value < BT_BREAKPOINTS.md);

/* ---------- 导航 ---------- */

type PanelSection =
  | 'features'
  | 'layout'
  | 'chrome'
  | 'facsimile'
  | 'appearance'
  | 'theme'
  | 'behavior'
  | 'presets'
  | 'misc';

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
  { id: 'appearance', label: '界面外观' },
  { id: 'theme', label: '外观主题' },
  { id: 'behavior', label: '编辑行为' },
  { id: 'presets', label: '预设管理' },
  { id: 'misc', label: '其他' },
];

/** 当前分组的功能列表 */
const groupFeatures = computed(() =>
  FEATURE_STYLE_IDS.filter((id) => FEATURE_STYLE_META[id].group === group.value),
);

const featureLabel = computed(() => FEATURE_STYLE_META[activeFeature.value].label);
const featureDeclarations = computed(() => props.api.panelFeatures.value[activeFeature.value] ?? {});

/** 已覆盖的功能数量（导航角标） */
const overriddenFeatures = computed(() => Object.keys(props.api.panelFeatures.value).length);

function openFeature(id: FeatureStyleId): void {
  activeFeature.value = id;
  section.value = 'features';
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
  <div
    class="dialog"
    :class="{ 'dialog--mobile': mobileLayout }"
    role="dialog"
    aria-modal="true"
    :data-mobile="mobileLayout ? 'true' : 'false'"
    @click.self="emit('close')"
  >
    <section class="panel">
      <header class="panel__header">
        <!-- 关闭：桌面是右上角 ×，H5 换成左上角返回箭头（全屏页惯例），可访问名不变 -->
        <button type="button" class="panel__close" aria-label="关闭" @click="emit('close')">
          <AppIcon class="panel__close-back" name="arrow-left" :size="20" />
          <span class="panel__close-cross" aria-hidden="true">×</span>
        </button>
        <h2 class="panel__title">编辑设置</h2>
        <div class="panel__meta">
          <span class="panel__store">{{ api.storeName.value }}</span>
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
                  'panel__chip--dirty': api.panelFeatures.value[id] !== undefined,
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
          <SettingsLayoutSection
            v-else-if="section === 'layout'"
            :api="api"
            :layout="layout"
            :fit-scale="fitScale"
            :tokens="tokens"
            :night="night"
            :page-transition="pageTransition"
            @update:night="emit('update:night', $event)"
            @update:page-transition="emit('update:page-transition', $event)"
          />

          <!-- ========== 页眉页脚 ========== -->
          <SettingsPageChrome v-else-if="section === 'chrome'" :api="api" :layout="layout" />

          <!-- ========== 古籍仿真（版框 / 界行 / 版心） ========== -->
          <SettingsFacsimile
            v-else-if="section === 'facsimile'"
            :api="api"
            :layout="layout"
            :tokens="tokens"
          />

          <!-- ========== 界面外观（美化 P4） ========== -->
          <SettingsUiSkin
            v-else-if="section === 'appearance'"
            :ui-skin="uiSkin"
            :ui-density="uiDensity"
            :ui-motion="uiMotion"
            :night="night"
            @update:ui-skin="emit('update:ui-skin', $event)"
            @update:ui-density="emit('update:ui-density', $event)"
            @update:ui-motion="emit('update:ui-motion', $event)"
            @update:night="emit('update:night', $event)"
          />

          <!-- ========== 外观主题（D10） ========== -->
          <SettingsAppearance
            v-else-if="section === 'theme'"
            :tokens="tokens"
            :theme-base-tokens="themeBaseTokens"
            :document="document"
            @apply-theme-tokens="emit('apply-theme-tokens', $event)"
          />

          <!-- ========== 编辑行为 ========== -->
          <template v-else-if="section === 'behavior'">
            <label class="panel__switch">
              <input type="checkbox" :checked="api.panelEditing.value.readonly"
                @change="api.patchEditing({ readonly: ($event.target as HTMLInputElement).checked })" />
              只读模式（禁止输入 / 粘贴 / 拖拽）
            </label>
            <label class="panel__switch">
              <input type="checkbox" :checked="api.panelEditing.value.pagination"
                @change="api.patchEditing({ pagination: ($event.target as HTMLInputElement).checked })" />
              书页分页（关闭 = 连续画布）
            </label>
            <label class="panel__switch">
              <input type="checkbox" :checked="api.panelEditing.value.inheritBlockType"
                @change="api.patchEditing({ inheritBlockType: ($event.target as HTMLInputElement).checked })" />
              回车后继承当前块类型
            </label>

            <div class="panel__row">
              <label class="panel__field">
                <span class="panel__label">自动保存间隔 ms</span>
                <input type="number" class="panel__input" min="500" max="10000" step="100"
                  :value="api.panelEditing.value.autosaveDelay"
                  @input="api.patchEditing({ autosaveDelay: Number(($event.target as HTMLInputElement).value) })" />
              </label>
              <label class="panel__field">
                <span class="panel__label">撤销合并 ms</span>
                <input type="number" class="panel__input" min="100" max="2000" step="50"
                  :value="api.panelEditing.value.historyGroupDelay"
                  @input="api.patchEditing({ historyGroupDelay: Number(($event.target as HTMLInputElement).value) })" />
              </label>
            </div>

            <label class="panel__field">
              <span class="panel__label">粘贴策略</span>
              <select class="panel__input" :value="api.panelEditing.value.pasteMode"
                @change="api.patchEditing({ pasteMode: ($event.target as HTMLSelectElement).value as 'rich' | 'plain' | 'structure' })">
                <option value="rich">保留样式</option>
                <option value="structure">仅结构（丢内联样式）</option>
                <option value="plain">纯文本</option>
              </select>
            </label>
          </template>

          <!-- ========== 预设管理 ========== -->
          <SettingsStylesSection
            v-else-if="section === 'presets'"
            :api="api"
            :active-feature="activeFeature"
            :feature-label="featureLabel"
          />

          <!-- ========== 其他（导出偏好等） ========== -->
          <SettingsMisc
            v-else
            :pdf-export-mode="pdfExportMode"
            :pdf-raster-scale="pdfRasterScale"
            @update:pdf-export-mode="emit('update:pdf-export-mode', $event)"
            @update:pdf-raster-scale="emit('update:pdf-raster-scale', $event)"
          />
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

<style scoped src="../styles/settings-shell.css"></style>

<style scoped src="../styles/settings-controls.css"></style>
