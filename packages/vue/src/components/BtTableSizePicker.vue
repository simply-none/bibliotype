<script setup lang="ts">
/**
 * 表格尺寸选择器（Word / WPS 式）
 *
 * 点击工具条「表格」后弹出：上方是 `maxRows × maxCols` 网格，鼠标悬停实时高亮
 * `r × c` 并显示尺寸，点击即插入；下方另给行 / 列数字输入，便于精确建表。
 *
 * 定位复用 `placeFloating`（上/下翻转、水平夹紧），Teleport 到 body + fixed，
 * 不会被工具条横向滚动容器裁切。`trigger` 用于「点触发器再次关闭」时忽略外部点击。
 *
 * H5（B4）：触屏无 hover，网格单元放大到 44px 触控目标；点按改为两段式——
 * 首次点按只预览高亮，再次点按同一格才确认插入（桌面 hover 预览 + 单击确认不变）。
 */
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type CSSProperties,
} from 'vue';
import { placeFloating, type FloatingRect } from '../floating-position.js';
import { useBreakpoint } from '../use-breakpoint.js';

const props = withDefaults(
  defineProps<{
    /** 触发器矩形（视口坐标） */
    anchor: FloatingRect;
    /** 触发器元素；点它时不触发「外部点击关闭」，交给父级切换 */
    trigger?: HTMLElement | null;
    /** 网格最大行数 */
    maxRows?: number;
    /** 网格最大列数 */
    maxCols?: number;
    /** 初始行数 */
    rows?: number;
    /** 初始列数 */
    cols?: number;
  }>(),
  {
    trigger: null,
    maxRows: 8,
    maxCols: 8,
    rows: 3,
    cols: 3,
  },
);

const emit = defineEmits<{
  select: [payload: { rows: number; cols: number }];
  close: [];
}>();

const menuRef = ref<HTMLElement | null>(null);
const menuSize = ref({ width: 0, height: 0 });
const hoverRows = ref(props.rows);
const hoverCols = ref(props.cols);
const customRows = ref(props.rows);
const customCols = ref(props.cols);
let observer: ResizeObserver | null = null;

/** 断点 / 触控指针探测：粗指针下放大网格并启用两段式点按 */
const breakpoint = useBreakpoint();
/** 触屏网格列数上限：44px 单元 + 间距后仍要放得进窄屏（6×44 + 5×6 ≈ 294px） */
const TOUCH_GRID_MAX = 6;
/** 实际渲染的网格行数 / 列数（触屏收窄） */
const gridRows = computed(() =>
  breakpoint.coarsePointer.value ? Math.min(props.maxRows, TOUCH_GRID_MAX) : props.maxRows,
);
const gridCols = computed(() =>
  breakpoint.coarsePointer.value ? Math.min(props.maxCols, TOUCH_GRID_MAX) : props.maxCols,
);

function clamp(value: number, max: number): number {
  return Math.min(max, Math.max(1, Math.round(Number.isFinite(value) ? value : 1)));
}

function hoverAt(rows: number, cols: number): void {
  hoverRows.value = rows;
  hoverCols.value = cols;
}

function resetHover(): void {
  hoverRows.value = customRows.value;
  hoverCols.value = customCols.value;
}

function choose(rows: number, cols: number): void {
  emit('select', { rows: clamp(rows, props.maxRows), cols: clamp(cols, props.maxCols) });
}

/**
 * 网格单元点按
 *
 * 桌面：单击即插入（hover 已经给出预览）；
 * 触屏：没有 hover，首次点按只把高亮移到该格，再次点按同一格才插入。
 */
function onCellClick(rows: number, cols: number): void {
  if (!breakpoint.coarsePointer.value) {
    choose(rows, cols);
    return;
  }
  if (hoverRows.value === rows && hoverCols.value === cols) {
    choose(rows, cols);
    return;
  }
  hoverAt(rows, cols);
}

function submitCustom(): void {
  customRows.value = clamp(customRows.value, props.maxRows);
  customCols.value = clamp(customCols.value, props.maxCols);
  choose(customRows.value, customCols.value);
}

function isActive(rows: number, cols: number): boolean {
  return rows <= hoverRows.value && cols <= hoverCols.value;
}

function viewportSize(): { width: number; height: number } {
  if (typeof window === 'undefined') {
    return { width: 1024, height: 768 };
  }
  const viewport = window.visualViewport;
  return {
    width: viewport?.width ?? window.innerWidth,
    height: viewport?.height ?? window.innerHeight,
  };
}

const placed = computed(() => placeFloating(props.anchor, menuSize.value, viewportSize()));

const menuStyle = computed<CSSProperties>(() => ({
  top: `${Math.round(placed.value.top)}px`,
  left: `${Math.round(placed.value.left)}px`,
  visibility: menuSize.value.width > 0 ? 'visible' : 'hidden',
}));

function measure(): void {
  const el = menuRef.value;
  if (el === null) {
    return;
  }
  const rect = el.getBoundingClientRect();
  if (rect.width !== menuSize.value.width || rect.height !== menuSize.value.height) {
    menuSize.value = { width: rect.width, height: rect.height };
  }
}

function onDocMousedown(event: MouseEvent): void {
  const target = event.target as Node | null;
  if (target === null) {
    return;
  }
  if (menuRef.value?.contains(target) === true) {
    return;
  }
  if (props.trigger?.contains(target) === true) {
    return;
  }
  emit('close');
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    emit('close');
  }
}

watch(
  () => props.anchor,
  async () => {
    await nextTick();
    measure();
  },
  { immediate: true },
);

onMounted(async () => {
  document.addEventListener('keydown', onKeydown, true);
  document.addEventListener('mousedown', onDocMousedown, true);
  await nextTick();
  measure();
  if (typeof ResizeObserver !== 'undefined' && menuRef.value !== null) {
    observer = new ResizeObserver(() => measure());
    observer.observe(menuRef.value);
  }
});

onBeforeUnmount(() => {
  observer?.disconnect();
  document.removeEventListener('keydown', onKeydown, true);
  document.removeEventListener('mousedown', onDocMousedown, true);
});
</script>

<template>
  <Teleport to="body">
    <div
      ref="menuRef"
      class="bt-table-picker"
      :class="{ 'bt-table-picker--touch': breakpoint.coarsePointer.value }"
      role="dialog"
      aria-label="插入表格"
      :data-pointer="breakpoint.coarsePointer.value ? 'coarse' : 'fine'"
      :style="menuStyle"
    >
      <div class="bt-table-picker__title">插入表格</div>
      <div class="bt-table-picker__hint">{{ hoverRows }} × {{ hoverCols }}</div>
      <div
        class="bt-table-picker__grid"
        :style="{ gridTemplateColumns: `repeat(${gridCols}, 1fr)` }"
        @mouseleave="resetHover"
      >
        <div v-for="r in gridRows" :key="`r-${r}`" class="bt-table-picker__row">
          <button
            v-for="c in gridCols"
            :key="`c-${c}`"
            type="button"
            class="bt-table-picker__cell"
            :class="{ 'bt-table-picker__cell--active': isActive(r, c) }"
            :aria-label="`${r} 行 ${c} 列`"
            :aria-pressed="isActive(r, c)"
            tabindex="-1"
            @mouseenter="hoverAt(r, c)"
            @click="onCellClick(r, c)"
          />
        </div>
      </div>
      <div class="bt-table-picker__custom">
        <label class="bt-table-picker__field">
          <span>行</span>
          <input v-model.number="customRows" type="number" min="1" :max="maxRows" />
        </label>
        <label class="bt-table-picker__field">
          <span>列</span>
          <input v-model.number="customCols" type="number" min="1" :max="maxCols" />
        </label>
        <button type="button" class="bt-table-picker__submit" @click="submitCustom">插入</button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.bt-table-picker {
  position: fixed;
  z-index: 3000;
  display: flex;
  flex-direction: column;
  gap: 6px;
  box-sizing: border-box;
  width: max-content;
  padding: 10px 12px 12px;
  border: 1px solid var(--bt-table-picker-border, rgba(15, 23, 42, 0.14));
  border-radius: 8px;
  background: var(--bt-table-picker-bg, #fff);
  color: var(--bt-table-picker-color, #1f2328);
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.18);
  font-size: 13px;
  user-select: none;
}

.bt-table-picker__title {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  opacity: 0.86;
}

.bt-table-picker__hint {
  font-size: 12px;
  color: var(--bt-table-picker-accent, #2563eb);
  font-variant-numeric: tabular-nums;
}

.bt-table-picker__grid {
  display: grid;
  gap: 2px;
}

.bt-table-picker__row {
  display: contents;
}

.bt-table-picker__cell {
  display: block;
  box-sizing: border-box;
  width: 18px;
  height: 18px;
  border: 1px solid var(--bt-table-picker-cell-border, rgba(15, 23, 42, 0.22));
  border-radius: 2px;
  background: var(--bt-table-picker-cell-bg, transparent);
  cursor: pointer;
}

.bt-table-picker__cell--active {
  border-color: var(--bt-table-picker-accent, #2563eb);
  background: var(--bt-table-picker-cell-active, rgba(37, 99, 235, 0.18));
}

/* H5（B4）：粗指针下网格单元放大到 44px 触控目标（桌面 18px 不变） */
.bt-table-picker--touch .bt-table-picker__grid {
  gap: 6px;
}

.bt-table-picker--touch .bt-table-picker__cell {
  width: var(--bt-touch-target, 44px);
  height: var(--bt-touch-target, 44px);
  border-radius: 4px;
}

.bt-table-picker--touch .bt-table-picker__hint {
  font-size: 13px;
}

.bt-table-picker--touch .bt-table-picker__submit {
  min-height: var(--bt-touch-target, 44px);
  padding-inline: 16px;
}

.bt-table-picker--touch .bt-table-picker__field input {
  min-height: var(--bt-touch-target, 44px);
  width: 64px;
}

@media (pointer: coarse) {
  .bt-table-picker__cell {
    width: var(--bt-touch-target, 44px);
    height: var(--bt-touch-target, 44px);
  }
}

.bt-table-picker__custom {
  display: flex;
  align-items: end;
  gap: 6px;
  padding-block-start: 6px;
  border-block-start: 1px solid var(--bt-table-picker-border, rgba(15, 23, 42, 0.1));
}

.bt-table-picker__field {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 11px;
  opacity: 0.82;
}

.bt-table-picker__field input {
  box-sizing: border-box;
  width: 48px;
  padding: 2px 4px;
  border: 1px solid var(--bt-table-picker-border, rgba(15, 23, 42, 0.22));
  border-radius: 4px;
  background: var(--bt-table-picker-input-bg, #fff);
  color: inherit;
  font-size: 12px;
}

.bt-table-picker__submit {
  padding: 3px 10px;
  border: 1px solid var(--bt-table-picker-accent, #2563eb);
  border-radius: 4px;
  background: var(--bt-table-picker-accent, #2563eb);
  color: #fff;
  font-size: 12px;
  cursor: pointer;
}

@media (prefers-color-scheme: dark) {
  .bt-table-picker {
    --bt-table-picker-bg: #1e242d;
    --bt-table-picker-color: #e6e8eb;
    --bt-table-picker-border: rgba(255, 255, 255, 0.14);
    --bt-table-picker-cell-border: rgba(255, 255, 255, 0.28);
    --bt-table-picker-cell-active: rgba(96, 165, 250, 0.24);
    --bt-table-picker-accent: #93c5fd;
    --bt-table-picker-input-bg: #12171e;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
  }
}
</style>
