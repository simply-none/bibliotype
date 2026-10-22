<script setup lang="ts">
/**
 * 统一抽屉容器（H5 UI 改造 A4 / C1 / D5）
 *
 * 移动端把侧栏与标签面板收进抽屉，避免挤压阅读区：遮罩 + 侧滑面板 + 滚动锁定 +
 * 边缘手势呼出 + Esc / 遮罩关闭。面板内容由插槽原样嵌入，组件自身只管容器与
 * 生命周期（`useScrollLock` 保证背景不跟随滚动，关闭后滚动位置不变）。
 *
 * 定位口径：`side` 决定面板贴哪条边——`start`（LTR 左侧，目录）/ `end`（LTR 右侧，
 * 标注 / 修订 / 版本）/ `bottom`（底部 sheet，属性检视器等）。方向语义交给宿主，
 * 组件只做物理边；直排等书写方向变化不影响抽屉本身。
 *
 * B5：`side="bottom"` 且传了 `snapHeights` 时，面板顶部出现拖拽把手，拖动改高度、
 * 松手吸附到最近档位（半屏 / 全屏），档位通过 `data-snap` 暴露给测试。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useScrollLock } from '../use-scroll-lock.js';

const props = withDefaults(
  defineProps<{
    /** 是否打开（配合 `update:open` 做 v-model） */
    open: boolean;
    /** 贴边方向：start 起点侧 / end 终点侧 / bottom 底部 */
    side?: 'start' | 'end' | 'bottom';
    /** 标题（留空则不渲染标题栏，仅保留关闭按钮） */
    title?: string;
    /** 面板宽度（side 为 start / end 时生效；CSS 长度） */
    width?: string;
    /** 面板高度（side 为 bottom 时生效；CSS 长度） */
    height?: string;
    /**
     * 底部 sheet 的吸附高度档位（自低到高，CSS 长度如 `48vh` / `92vh`）
     *
     * 仅 `side="bottom"` 生效：提供后顶部出现拖拽把手，初始落在第一档。
     */
    snapHeights?: readonly string[];
    /** 点遮罩是否关闭（缺省 true） */
    maskClosable?: boolean;
    /** 关闭态是否监听屏幕边缘手势呼出（缺省 true） */
    edgeSwipe?: boolean;
    /** 无障碍名称（缺省取 title） */
    ariaLabel?: string;
  }>(),
  {
    side: 'start',
    title: '',
    width: 'min(320px, 86vw)',
    height: 'min(72vh, 560px)',
    snapHeights: undefined,
    maskClosable: true,
    edgeSwipe: true,
    ariaLabel: '',
  },
);

const emit = defineEmits<{
  (event: 'update:open', value: boolean): void;
  (event: 'close'): void;
}>();

const scrollLock = useScrollLock();

/** 屏幕边缘触发带宽度（px）：从边缘往里拖超过此值即呼出 */
const EDGE_ZONE = 24;
/** 呼出所需最小拖动距离（px） */
const EDGE_TRIGGER = 48;

/** 边缘手势起点（null = 当前未在跟踪） */
let edgeStartX: number | null = null;

const label = computed(() => props.ariaLabel || props.title || '侧栏');

/* ---------- 底部 sheet 吸附高度（B5） ---------- */

/** 面板元素（拖拽时量当前高度） */
const panelRef = ref<HTMLElement | null>(null);
/** 当前吸附档位（0 = 最低档） */
const snapIndex = ref(0);
/** 拖拽中的临时高度（px；null = 未拖动，用档位值） */
const draggingHeight = ref<number | null>(null);
/** 拖拽起点：指针 y 与当时高度 */
let dragStartY = 0;
let dragStartHeight = 0;
/** 是否正在拖拽 */
let dragging = false;

/** 吸附档位的像素值（只支持 px / vh，其余按整屏处理） */
function resolveCssLength(value: string): number {
  if (typeof window === 'undefined') return 0;
  if (value.endsWith('vh')) return (Number.parseFloat(value) / 100) * window.innerHeight;
  if (value.endsWith('px')) return Number.parseFloat(value);
  return window.innerHeight;
}

/** 面板高度：拖拽中跟手，否则取当前档位 */
const sheetHeight = computed(() => {
  if (draggingHeight.value !== null) return `${draggingHeight.value}px`;
  const snaps = props.snapHeights;
  if (snaps !== undefined && snaps.length > 0) {
    return snaps[Math.min(snapIndex.value, snaps.length - 1)];
  }
  return props.height;
});

const panelStyle = computed(() => {
  if (props.side === 'bottom') return { height: sheetHeight.value };
  return { width: props.width };
});

/** 按下把手：记录起点并捕获指针，后续 move / up 都回到把手 */
function onGrabberDown(event: PointerEvent): void {
  const el = panelRef.value;
  if (el === null) return;
  dragging = true;
  dragStartY = event.clientY;
  dragStartHeight = el.getBoundingClientRect().height;
  draggingHeight.value = dragStartHeight;
  const target = event.currentTarget;
  if (target instanceof HTMLElement) target.setPointerCapture?.(event.pointerId);
}

/** 拖动：向上拉高、向下压低，限制在 120px 与 94vh 之间 */
function onGrabberMove(event: PointerEvent): void {
  if (!dragging) return;
  if (typeof window === 'undefined') return;
  const next = dragStartHeight + (dragStartY - event.clientY);
  draggingHeight.value = Math.min(window.innerHeight * 0.94, Math.max(120, next));
}

/** 松手：吸附到距离最近的档位 */
function onGrabberUp(): void {
  if (!dragging) return;
  dragging = false;
  const height = draggingHeight.value;
  draggingHeight.value = null;
  const snaps = props.snapHeights;
  if (height === null || snaps === undefined || snaps.length === 0) return;
  let best = 0;
  let bestDiff = Number.POSITIVE_INFINITY;
  snaps.forEach((snap, index) => {
    const diff = Math.abs(resolveCssLength(snap) - height);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = index;
    }
  });
  snapIndex.value = best;
}

/** 关闭时回到最低档，下次打开不从全屏开始 */
watch(
  () => props.open,
  (open) => {
    if (!open) {
      snapIndex.value = 0;
      draggingHeight.value = null;
    }
  },
);

function close(): void {
  if (!props.open) return;
  emit('update:open', false);
  emit('close');
}

function onMaskClick(): void {
  if (props.maskClosable) close();
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && props.open) {
    event.preventDefault();
    close();
  }
}

/* ---------- 边缘手势呼出（仅关闭态监听） ---------- */

function onEdgeStart(event: TouchEvent): void {
  if (props.open) return;
  const touch = event.touches[0];
  if (touch === undefined) return;
  const fromStart = props.side === 'start' && touch.clientX <= EDGE_ZONE;
  const fromEnd = props.side === 'end' && touch.clientX >= window.innerWidth - EDGE_ZONE;
  edgeStartX = fromStart || fromEnd ? touch.clientX : null;
}

function onEdgeMove(event: TouchEvent): void {
  if (edgeStartX === null || props.open) return;
  const touch = event.touches[0];
  if (touch === undefined) return;
  const dx = touch.clientX - edgeStartX;
  const inward = props.side === 'start' ? dx : -dx;
  if (inward < EDGE_TRIGGER) return;
  edgeStartX = null;
  emit('update:open', true);
}

function onEdgeEnd(): void {
  edgeStartX = null;
}

/** 边缘触摸手势：只在关闭态有意义（`onEdgeStart` 已带 open 守卫，这里只是不白绑） */
function bindEdgeTouch(): void {
  if (typeof document === 'undefined') return;
  document.addEventListener('touchstart', onEdgeStart, { passive: true });
  document.addEventListener('touchmove', onEdgeMove, { passive: true });
  document.addEventListener('touchend', onEdgeEnd, { passive: true });
}

function unbindEdgeTouch(): void {
  if (typeof document === 'undefined') return;
  document.removeEventListener('touchstart', onEdgeStart);
  document.removeEventListener('touchmove', onEdgeMove);
  document.removeEventListener('touchend', onEdgeEnd);
}

/** 键盘（Esc 关闭）：只在打开态需要；与触摸手势分开绑，避免开关互相牵连 */
function bindKeyboard(): void {
  if (typeof document === 'undefined') return;
  document.addEventListener('keydown', onKeydown, true);
}

function unbindKeyboard(): void {
  if (typeof document === 'undefined') return;
  document.removeEventListener('keydown', onKeydown, true);
}

/**
 * 开关副作用
 *
 * 打开：锁滚 + 绑 Esc，同时摘掉边缘手势；关闭：反过来，并按 `edgeSwipe` 决定
 * 是否重新绑边缘手势。`immediate` 首轮必须走到 else：抽屉一生下来就是关闭态，
 * 初始不绑的话 `edgeSwipe` 默认 true 也永远不会生效。
 */
watch(
  () => props.open,
  (open) => {
    if (open) {
      scrollLock.lock();
      unbindEdgeTouch();
      bindKeyboard();
    } else {
      scrollLock.unlock();
      unbindKeyboard();
      if (props.edgeSwipe) bindEdgeTouch();
      else unbindEdgeTouch();
    }
  },
  { immediate: true },
);

watch(
  () => props.edgeSwipe,
  (edgeSwipe) => {
    // 手势监听只在关闭态需要：打开时由 watch(open) 统一管理
    if (!edgeSwipe) unbindEdgeTouch();
    else if (!props.open) bindEdgeTouch();
  },
);

onBeforeUnmount(() => {
  unbindEdgeTouch();
  unbindKeyboard();
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="bt-drawer"
      :class="`bt-drawer--${side}`"
      :data-side="side"
      data-open="true"
    >
      <div class="bt-drawer__mask" @click="onMaskClick" />
      <section
        ref="panelRef"
        class="bt-drawer__panel"
        :style="panelStyle"
        role="dialog"
        aria-modal="true"
        :aria-label="label"
      >
        <div
          v-if="side === 'bottom' && snapHeights !== undefined && snapHeights.length > 0"
          class="bt-drawer__grabber"
          role="separator"
          aria-orientation="horizontal"
          :aria-label="`拖动调整高度，当前第 ${snapIndex + 1} 档`"
          :data-snap="snapIndex"
          @pointerdown="onGrabberDown"
          @pointermove="onGrabberMove"
          @pointerup="onGrabberUp"
          @pointercancel="onGrabberUp"
        >
          <span class="bt-drawer__grabber-bar" />
        </div>
        <header class="bt-drawer__header">
          <h2 v-if="title" class="bt-drawer__title">{{ title }}</h2>
          <span v-else class="bt-drawer__title" aria-hidden="true"></span>
          <button
            type="button"
            class="bt-drawer__close"
            aria-label="关闭"
            @click="close"
          >
            关闭
          </button>
        </header>
        <div class="bt-drawer__body">
          <slot />
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.bt-drawer {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  touch-action: none;
}

.bt-drawer--end {
  justify-content: flex-end;
}

.bt-drawer--bottom {
  align-items: flex-end;
}

.bt-drawer__mask {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.38);
}

.bt-drawer__panel {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  max-width: 100vw;
  max-height: 100vh;
  overflow: hidden;
  background: var(--bt-drawer-bg, #faf8f4);
  color: var(--bt-drawer-color, #3c3a34);
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.24);
  /* 刘海屏安全区（D3）：底部 / 左右各留 env 值 */
  padding-block-end: env(safe-area-inset-bottom, 0px);
}

.bt-drawer--start .bt-drawer__panel {
  padding-inline-start: env(safe-area-inset-left, 0px);
}

.bt-drawer--end .bt-drawer__panel {
  padding-inline-end: env(safe-area-inset-right, 0px);
}

.bt-drawer--bottom .bt-drawer__panel {
  width: 100%;
  border-start-start-radius: 12px;
  border-start-end-radius: 12px;
}

.bt-drawer__grabber {
  display: flex;
  flex: none;
  justify-content: center;
  padding: 6px 0 2px;
  touch-action: none;
  cursor: grab;
}

.bt-drawer__grabber-bar {
  width: 36px;
  height: 4px;
  border-radius: 2px;
  background: currentColor;
  opacity: 0.25;
}

.bt-drawer__header {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border-block-end: 1px solid var(--bt-drawer-border, rgba(127, 127, 127, 0.22));
}

.bt-drawer__title {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  font-size: 14px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bt-drawer__close {
  flex: none;
  min-width: 44px;
  min-height: 32px;
  padding: 4px 10px;
  border: 1px solid var(--bt-drawer-border, rgba(127, 127, 127, 0.32));
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font-size: 13px;
  cursor: pointer;
}

.bt-drawer__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}

/* 触屏（D2）：抽屉内操作控件的点击区补足到 44px（视觉尺寸不变） */
@media (pointer: coarse) {
  .bt-drawer__close,
  .bt-drawer__body :deep(button) {
    min-height: 44px;
  }
}
</style>
