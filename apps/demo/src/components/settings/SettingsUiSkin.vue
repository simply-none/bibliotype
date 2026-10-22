<script setup lang="ts">
/**
 * 「界面外观」分区（美化 P4）：皮肤 / 密度 / 动效
 *
 * 皮肤只换壳层色板，与阅读纸色（主题令牌）互不干涉；三项都是即时生效的
 * 壳层偏好，不进样式草稿——本组件只上抛事件，落盘由父级快照负责。
 */
import { UI_SKINS, type UiDensity, type UiMotion, type UiSkinKey } from '../../ui-skin.js';
import AppIcon from '../AppIcon.vue';

defineProps<{
  /** 界面皮肤（美化 P4）：壳层色板，与阅读纸色（主题令牌）互不干涉 */
  uiSkin: UiSkinKey;
  /** 界面密度：只缩放间距与行高，不动字号与 44px 触控目标 */
  uiDensity: UiDensity;
  /** 动效开关：auto = 跟随系统 prefers-reduced-motion */
  uiMotion: UiMotion;
  /** 夜读纸色开关（只改阅读区与编辑画布，壳色仍由皮肤决定） */
  night: boolean;
}>();

const emit = defineEmits<{
  'update:ui-skin': [value: UiSkinKey];
  'update:ui-density': [value: UiDensity];
  'update:ui-motion': [value: UiMotion];
  'update:night': [value: boolean];
}>();

/** 密度选项 */
const DENSITY_OPTIONS: ReadonlyArray<{ value: UiDensity; label: string }> = [
  { value: 'comfortable', label: '舒适' },
  { value: 'compact', label: '紧凑' },
];

/** 动效选项：auto 交给系统 prefers-reduced-motion 判定 */
const MOTION_OPTIONS: ReadonlyArray<{ value: UiMotion; label: string }> = [
  { value: 'auto', label: '跟随系统' },
  { value: 'off', label: '关闭' },
];
</script>

<template>
  <p class="panel__hint">
    皮肤只换壳层色板（顶栏 / 侧栏 / 抽屉 / 弹窗），不改纸张与墨色；
    阅读纸色仍在「外观主题」里调，两者互不覆盖。选择即时生效并记入本地。
  </p>

  <div class="panel__field">
    <span class="panel__label">界面皮肤</span>
    <div class="panel__skins">
      <button
        v-for="skin in UI_SKINS"
        :key="skin.key"
        type="button"
        class="panel__skin"
        :class="{ 'panel__skin--active': uiSkin === skin.key }"
        :data-skin-option="skin.key"
        :aria-pressed="uiSkin === skin.key"
        @click="emit('update:ui-skin', skin.key)"
      >
        <span class="panel__skin-preview" aria-hidden="true">
          <i :style="{ background: skin.preview.canvas }" />
          <i :style="{ background: skin.preview.surface }" />
          <i :style="{ background: skin.preview.accent }" />
        </span>
        <span class="panel__skin-label">{{ skin.label }}</span>
        <AppIcon
          v-if="uiSkin === skin.key"
          class="panel__skin-check"
          name="check"
          :size="14"
          :stroke-width="2.2"
        />
      </button>
    </div>
  </div>

  <div class="panel__field">
    <span class="panel__label">界面密度（只缩放间距，不动字号）</span>
    <div class="panel__chips">
      <button
        v-for="item in DENSITY_OPTIONS"
        :key="item.value"
        type="button"
        class="panel__chip"
        :class="{ 'panel__chip--active': uiDensity === item.value }"
        :aria-pressed="uiDensity === item.value"
        @click="emit('update:ui-density', item.value)"
      >
        {{ item.label }}
      </button>
    </div>
  </div>

  <div class="panel__field">
    <span class="panel__label">动效（「跟随系统」即尊重 prefers-reduced-motion）</span>
    <div class="panel__chips">
      <button
        v-for="item in MOTION_OPTIONS"
        :key="item.value"
        type="button"
        class="panel__chip"
        :class="{ 'panel__chip--active': uiMotion === item.value }"
        :aria-pressed="uiMotion === item.value"
        @click="emit('update:ui-motion', item.value)"
      >
        {{ item.label }}
      </button>
    </div>
  </div>

  <label class="panel__switch">
    <input type="checkbox" :checked="night" @change="emit('update:night', ($event.target as HTMLInputElement).checked)" />
    夜读纸色（只改阅读区与编辑画布，壳色仍由皮肤决定）
  </label>
</template>

<style scoped src="../../styles/settings-controls.css"></style>

<style scoped>
/* 皮肤卡：三格色块预览 + 名称，选中项描边 + 右上角对勾（P4） */
.panel__skins {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: var(--ui-space-2, 6px);
}

.panel__skin {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--ui-space-2, 6px);
  min-height: 72px;
  padding: var(--ui-space-2, 6px);
  background: var(--ui-surface-raised, #faf8f4);
  border: var(--ui-border-width, 1px) solid var(--ui-border, #e2ddd2);
  border-radius: var(--ui-radius-md, 12px);
  cursor: pointer;
  text-align: start;
  transition:
    border-color var(--ui-dur-fast, 120ms) var(--ui-ease, ease),
    box-shadow var(--ui-dur-fast, 120ms) var(--ui-ease, ease),
    transform var(--ui-dur-fast, 120ms) var(--ui-ease, ease);
}

.panel__skin:hover {
  border-color: var(--ui-accent, #8c5a2b);
}

.panel__skin:active {
  transform: scale(0.98);
}

.panel__skin--active {
  border-color: var(--ui-accent, #8c5a2b);
  box-shadow: inset 0 0 0 1px var(--ui-accent, #8c5a2b);
}

.panel__skin-preview {
  display: flex;
  height: 28px;
  overflow: hidden;
  border: 1px solid var(--ui-border, #e2ddd2);
  border-radius: var(--ui-radius-sm, 8px);
}

.panel__skin-preview i {
  flex: 1;
}

/* 强调色只占一格宽，预览里就能看出主色偏差 */
.panel__skin-preview i:last-child {
  flex: 0 0 28%;
}

.panel__skin-label {
  font-size: var(--ui-font-sm, 12px);
  color: var(--ui-text, #3c3a34);
}

.panel__skin--active .panel__skin-label {
  color: var(--ui-accent, #8c5a2b);
  font-weight: 600;
}

.panel__skin-check {
  position: absolute;
  inset-block-start: 6px;
  inset-inline-end: 6px;
  color: var(--ui-accent, #8c5a2b);
}
</style>
