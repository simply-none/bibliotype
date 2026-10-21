<script setup lang="ts">
/**
 * 侧栏宽度拖拽条（BtSidebarResizer）
 *
 * 纯受控组件：宽度经 `v-model` 进、`update:modelValue` 出，持久化由宿主负责
 * （库内不写 localStorage）。键盘可操作：方向键步进、Home/End 到极值、
 * Enter/空格或双击回到默认宽度；拖拽用 Pointer Events，触屏同样可用。
 */
import { computed, onBeforeUnmount, ref } from 'vue';
import {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_STEP,
  clampSidebarWidth,
  stepSidebarWidth,
} from '../sidebar-width.js';

const props = withDefaults(
  defineProps<{
    /** 当前宽度（px） */
    modelValue: number;
    /** 最小宽度 */
    min?: number;
    /** 最大宽度 */
    max?: number;
    /** 键盘单次步进（px） */
    step?: number;
    /** 双击 / Enter 复位宽度 */
    defaultWidth?: number;
    /**
     * 拖拽方向
     *
     * `start`：侧栏在书写起点侧（LTR 左栏），向右拖变宽；
     * `end`：侧栏在书写终点侧，向右拖变窄（delta 取反）。
     */
    side?: 'start' | 'end';
    /** 无障碍名称 */
    label?: string;
    /** 禁用拖拽与键盘调整 */
    disabled?: boolean;
  }>(),
  {
    min: SIDEBAR_MIN_WIDTH,
    max: SIDEBAR_MAX_WIDTH,
    step: SIDEBAR_STEP,
    defaultWidth: SIDEBAR_DEFAULT_WIDTH,
    side: 'start',
    label: '调整侧栏宽度',
    disabled: false,
  },
);

const emit = defineEmits<{
  (event: 'update:modelValue', width: number): void;
  (event: 'reset', width: number): void;
  (event: 'dragstart'): void;
  (event: 'dragend'): void;
}>();

const dragging = ref(false);
let startX = 0;
let startWidth = 0;

const range = computed(() => ({ min: props.min, max: props.max }));
const current = computed(() => clampSidebarWidth(props.modelValue, range.value));

function update(width: number): void {
  const next = clampSidebarWidth(width, range.value);
  if (next !== props.modelValue) emit('update:modelValue', next);
}

function reset(): void {
  emit('reset', clampSidebarWidth(props.defaultWidth, range.value));
  update(props.defaultWidth);
}

function onPointerDown(event: PointerEvent): void {
  if (props.disabled) return;
  event.preventDefault();
  dragging.value = true;
  startX = event.clientX;
  startWidth = current.value;
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
  emit('dragstart');
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging.value) return;
  const sign = props.side === 'end' ? -1 : 1;
  update(startWidth + (event.clientX - startX) * sign);
}

function onPointerUp(): void {
  unbind();
  if (!dragging.value) return;
  dragging.value = false;
  emit('dragend');
}

function unbind(): void {
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
  window.removeEventListener('pointercancel', onPointerUp);
}

/** 方向键语义跟随侧栏位置：向「远离正文」的方向变宽 */
function onKeydown(event: KeyboardEvent): void {
  if (props.disabled) return;
  const sign = props.side === 'end' ? -1 : 1;
  switch (event.key) {
    case 'ArrowLeft':
      event.preventDefault();
      update(stepSidebarWidth(current.value, -1 * sign, range.value, props.step));
      break;
    case 'ArrowRight':
      event.preventDefault();
      update(stepSidebarWidth(current.value, 1 * sign, range.value, props.step));
      break;
    case 'Home':
      event.preventDefault();
      update(props.min);
      break;
    case 'End':
      event.preventDefault();
      update(props.max);
      break;
    case 'Enter':
    case ' ':
      event.preventDefault();
      reset();
      break;
    default:
      break;
  }
}

onBeforeUnmount(unbind);
</script>

<template>
  <div
    class="bt-sidebar-resizer"
    :class="{ 'bt-sidebar-resizer--dragging': dragging, 'bt-sidebar-resizer--disabled': disabled }"
    role="separator"
    aria-orientation="vertical"
    :aria-label="label"
    :aria-valuemin="min"
    :aria-valuemax="max"
    :aria-valuenow="current"
    :tabindex="disabled ? -1 : 0"
    @pointerdown="onPointerDown"
    @dblclick="reset"
    @keydown="onKeydown"
  />
</template>

<style>
.bt-sidebar-resizer {
  position: relative;
  flex: none;
  align-self: stretch;
  width: 8px;
  cursor: col-resize;
  touch-action: none;
  outline: none;
}

.bt-sidebar-resizer::after {
  content: '';
  position: absolute;
  inset-block: 0;
  inset-inline-start: 3px;
  width: 2px;
  border-radius: 1px;
  background: transparent;
  transition: background-color 160ms ease, width 160ms ease;
}

.bt-sidebar-resizer:hover::after,
.bt-sidebar-resizer--dragging::after,
.bt-sidebar-resizer:focus-visible::after {
  width: 4px;
  background: var(--bt-color-accent, #8c5a2b);
}

.bt-sidebar-resizer:focus-visible {
  box-shadow: inset 0 0 0 2px rgba(140, 90, 43, 0.35);
}

.bt-sidebar-resizer--disabled {
  cursor: default;
  opacity: 0.4;
}

@media (prefers-reduced-motion: reduce) {
  .bt-sidebar-resizer::after {
    transition: none;
  }
}
</style>
