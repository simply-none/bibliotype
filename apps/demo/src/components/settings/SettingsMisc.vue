<script setup lang="ts">
/**
 * 「其他」分区：导出与杂项偏好
 *
 * PDF 导出方式是应用级偏好（非样式草稿）：本组件只上抛事件，持久化由父级
 * 界面偏好快照负责。字段语义化命名（`pdfExportMode`），UI 只暴露用户语言，
 * 不出现实现层技术词。
 */
import type { PdfExportMode } from '../../composables/use-settings-snapshot.js';

defineProps<{
  /** PDF 导出方式（应用级偏好，落盘由父级快照负责） */
  pdfExportMode: PdfExportMode;
}>();

const emit = defineEmits<{
  'update:pdf-export-mode': [value: PdfExportMode];
}>();

/** PDF 导出方式选项（顺序即展示顺序：默认项排第一） */
const PDF_EXPORT_MODES: ReadonlyArray<{
  value: PdfExportMode;
  label: string;
  description: string;
}> = [
  {
    value: 'in-app',
    label: '应用内直出',
    description:
      '逐页渲染后直接生成 PDF 文件并下载：免打印对话框、带进度可中止，大部头显著更快；产物为图片型，文字不可选中。',
  },
  {
    value: 'browser-dialog',
    label: '浏览器对话框导出',
    description:
      '调起系统打印对话框后手动「另存为 PDF」：矢量文字可选中，但大部头要等打印预览渲染全部页面，较慢。',
  },
];
</script>

<template>
  <p class="panel__hint">
    导出与杂项偏好，选择即时生效并记入本地。桌面客户端（Electron）宿主下 PDF
    恒走打印引擎矢量直出，不受此项影响。
  </p>

  <div class="panel__field">
    <span class="panel__label">PDF 导出方式</span>
    <div class="panel__export-modes">
      <button
        v-for="item in PDF_EXPORT_MODES"
        :key="item.value"
        type="button"
        class="panel__export-mode"
        :class="{ 'panel__export-mode--active': pdfExportMode === item.value }"
        :data-export-mode="item.value"
        :aria-pressed="pdfExportMode === item.value"
        @click="emit('update:pdf-export-mode', item.value)"
      >
        <span class="panel__export-mode-label">{{ item.label }}</span>
        <span class="panel__export-mode-desc">{{ item.description }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped src="../../styles/settings-controls.css"></style>

<style scoped>
/* 导出方式卡：标题 + 一句说明，选中项描边强调（与皮肤卡同一视觉语言） */
.panel__export-modes {
  display: grid;
  gap: var(--ui-space-2, 6px);
}

.panel__export-mode {
  display: flex;
  flex-direction: column;
  gap: var(--ui-space-1, 4px);
  padding: var(--ui-space-2, 6px) var(--ui-space-3, 10px);
  background: var(--ui-surface-raised, #faf8f4);
  border: var(--ui-border-width, 1px) solid var(--ui-border, #e2ddd2);
  border-radius: var(--ui-radius-md, 12px);
  cursor: pointer;
  text-align: start;
  transition:
    border-color var(--ui-dur-fast, 120ms) var(--ui-ease, ease),
    box-shadow var(--ui-dur-fast, 120ms) var(--ui-ease, ease);
}

.panel__export-mode:hover {
  border-color: var(--ui-accent, #8c5a2b);
}

.panel__export-mode--active {
  border-color: var(--ui-accent, #8c5a2b);
  box-shadow: inset 0 0 0 1px var(--ui-accent, #8c5a2b);
}

.panel__export-mode-label {
  font-size: var(--ui-font-sm, 12px);
  font-weight: 600;
  color: var(--ui-text, #3c3a34);
}

.panel__export-mode--active .panel__export-mode-label {
  color: var(--ui-accent, #8c5a2b);
}

.panel__export-mode-desc {
  font-size: var(--ui-font-xs, 11px);
  line-height: 1.6;
  color: var(--ui-text-muted, #8a8578);
}
</style>
