<script setup lang="ts">
/**
 * 图片放大弹窗（lightbox）
 *
 * 阅读视图点击图片 / 编辑画布双击图片后的放大查看容器：Teleport 到 body 的暗色
 * 遮罩 + 居中等比大图（object-fit contain）+ 说明文字（字图显示原字，插图显示
 * alt）。关闭途径：遮罩点击 / Esc / 右上角关闭按钮（触屏无 Esc）；开启期间
 * `useScrollLock` 锁背景滚动（计数锁，可与抽屉等浮层叠加）。
 *
 * 缩放 / 平移：滚轮与双指捏合**恒以图片中心为锚居中放大**（1×~8×，只变倍率、
 * 视觉中心不动），超出适配大小后可拖拽平移，双击图片复位。手势跟踪的 move / up
 * 挂 window 且仅在手势进行中存在（首指按下挂、末指抬起摘，关闭 / 卸载强制摘），
 * 不用 setPointerCapture（会把 click 重定向到根元素，关闭按钮与遮罩点击失效）；
 * `touch-action: none` + `draggable=false` 接管浏览器默认平移 / 捏合 / 拖图。
 * 缩放与平移状态在每次打开时重置，上一张的手势残留不带入。
 *
 * `image` 为 null 即关闭态（不渲染）。字图（缺字字形图）无论横排 / 直排
 * 恒以原图方向展示（直排汉字直立，字图同理，不随书写方向旋转）。视觉
 * 变量（美化口径同 BtDrawer，均带默认值）：
 * `--bt-lightbox-mask`（遮罩色）/ `--bt-lightbox-color`（说明文字色）/
 * `--bt-lightbox-image-bg`（图片衬底，透明 PNG 字图在暗背景上以白衬底保持可读）。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useScrollLock } from '../use-scroll-lock.js';
import type { LightboxImage } from '../use-image-lightbox.js';

const props = withDefaults(
  defineProps<{
    /** 展示的图片信息（null = 关闭态，不渲染） */
    image: LightboxImage | null;
    /** 点遮罩是否关闭（缺省 true） */
    maskClosable?: boolean;
    /** 无障碍名称（读屏用，缺省「图片放大查看」） */
    ariaLabel?: string;
  }>(),
  { maskClosable: true, ariaLabel: '' },
);

const emit = defineEmits<{ (event: 'close'): void }>();

const scrollLock = useScrollLock();

/** 说明文字：字图优先原字（data-char），插图用 alt；都无则不渲染 */
const caption = computed(() => {
  const image = props.image;
  if (image === null) return '';
  if (image.char !== undefined) return `原字：${image.char}`;
  return image.alt ?? '';
});

/* =========================================================================
 * 缩放 / 平移（滚轮 + 双指捏合 + 拖拽）
 *
 * 缩放恒以图片中心为锚：只变倍率、视觉中心不动（未平移时即一直居中放大）。
 * 手势跟踪：pointerdown 绑在弹窗根元素；move / up / cancel 挂 window 且仅在
 * 手势进行中存在（首指按下挂、末指抬起摘、关闭 / 卸载强制摘）——不用
 * setPointerCapture，它会把后续 click 重定向到根元素，关闭按钮与遮罩点击会失效。
 * ========================================================================= */

/** 缩放下限：1 = 适配窗口（contain 布局尺寸） */
const MIN_SCALE = 1;
/** 缩放上限（8 倍足够看扫描字图笔画细节） */
const MAX_SCALE = 8;
/** 判定拖动阈值（px）：超过视为手势，结束的 click 不当点按关闭遮罩 */
const GESTURE_THRESHOLD = 6;

/** 当前缩放倍率（1 = 适配窗口） */
const scale = ref(1);
/** 平移偏移（px；scale = 1 时恒为 0） */
const offsetX = ref(0);
const offsetY = ref(0);
/** 是否处于拖拽 / 捏合手势中（光标抓手态） */
const dragging = ref(false);

/** 图片元素（量取布局尺寸做平移限幅；v-if 随开关自动绑定 / 置 null） */
const imageRef = ref<HTMLImageElement | null>(null);

/** 按住的指针集合（pointerId → 坐标；1 指 = 拖拽平移，2 指 = 捏合缩放） */
const pointers = new Map<number, { x: number; y: number }>();
/** 捏合基准：起始指距与起始倍率 */
let pinchStartDistance = 0;
let pinchStartScale = 1;
/** 单指拖拽锚点（null = 未在拖拽） */
let dragStart: { x: number; y: number } | null = null;
/** 按压起点（判定「拖动过」，拖后的 click 不再当点按关闭遮罩） */
let pressStart: { x: number; y: number } | null = null;
/** 本次按压是否发生过大位移 */
let gestured = false;
/** window 手势监听是否已挂（仅手势进行中挂） */
let gestureBound = false;

/** 摘 window 手势监听（幂等） */
function unbindGesture(): void {
  if (!gestureBound || typeof window === 'undefined') return;
  gestureBound = false;
  window.removeEventListener('pointermove', onWindowPointerMove);
  window.removeEventListener('pointerup', onWindowPointerUp);
  window.removeEventListener('pointercancel', onWindowPointerCancel);
}

/** 挂 window 手势监听（幂等；仅手势进行中存在，弹窗关闭即无监听） */
function bindGesture(): void {
  if (gestureBound || typeof window === 'undefined') return;
  gestureBound = true;
  window.addEventListener('pointermove', onWindowPointerMove);
  window.addEventListener('pointerup', onWindowPointerUp);
  window.addEventListener('pointercancel', onWindowPointerCancel);
}

/** 复位缩放与平移 + 摘手势监听（关闭 / 换图 / 双击图片时调用） */
function resetTransform(): void {
  scale.value = 1;
  offsetX.value = 0;
  offsetY.value = 0;
  dragging.value = false;
  pointers.clear();
  pinchStartDistance = 0;
  dragStart = null;
  pressStart = null;
  gestured = false;
  unbindGesture();
}

/** 居中缩放：只变倍率，图片视觉中心保持不动；回 1× 时平移归零 */
function applyScale(next: number): void {
  scale.value = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
  if (scale.value === MIN_SCALE) {
    offsetX.value = 0;
    offsetY.value = 0;
    return;
  }
  clampOffset();
}

/** 平移限幅：仅当缩放后图片超出视口才允许平移（不足则回正），避免图被甩出视野 */
function clampOffset(): void {
  const img = imageRef.value;
  if (img === null) return;
  /* 无布局环境（SSR / 测试）量不到尺寸，跳过限幅 */
  if (img.offsetWidth <= 0 || img.offsetHeight <= 0) return;
  const maxX = Math.max(0, (img.offsetWidth * scale.value - window.innerWidth) / 2);
  const maxY = Math.max(0, (img.offsetHeight * scale.value - window.innerHeight) / 2);
  offsetX.value = Math.min(maxX, Math.max(-maxX, offsetX.value));
  offsetY.value = Math.min(maxY, Math.max(-maxY, offsetY.value));
}

/** 滚轮缩放（居中）；preventDefault 由 .prevent 修饰符承担 */
function onWheel(event: WheelEvent): void {
  applyScale(scale.value * Math.exp(-event.deltaY * 0.002));
}

/** 首指按下（弹窗根元素）：登记指针并挂 window 跟踪后续移动 / 抬起 */
function onPointerDown(event: PointerEvent): void {
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  pressStart = { x: event.clientX, y: event.clientY };
  gestured = false;
  if (pointers.size === 1) {
    dragStart = { x: event.clientX, y: event.clientY };
    dragging.value = scale.value > MIN_SCALE;
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchStartDistance = Math.hypot(a.x - b.x, a.y - b.y);
    pinchStartScale = scale.value;
    dragStart = null;
    dragging.value = true;
  }
  bindGesture();
}

function onWindowPointerMove(event: PointerEvent): void {
  if (!pointers.has(event.pointerId)) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

  /* 双指捏合：指距比 → 倍率（居中缩放） */
  if (pointers.size >= 2 && pinchStartDistance > 0) {
    const [a, b] = [...pointers.values()];
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    applyScale(pinchStartScale * (distance / pinchStartDistance));
    gestured = true;
    return;
  }

  /* 单指 / 鼠标拖拽平移（仅在放大后有意义） */
  if (dragStart !== null && scale.value > MIN_SCALE) {
    offsetX.value += event.clientX - dragStart.x;
    offsetY.value += event.clientY - dragStart.y;
    dragStart = { x: event.clientX, y: event.clientY };
    clampOffset();
  }
  if (pressStart !== null) {
    const moved = Math.hypot(event.clientX - pressStart.x, event.clientY - pressStart.y);
    if (moved > GESTURE_THRESHOLD) gestured = true;
  }
}

function onWindowPointerUp(event: PointerEvent): void {
  pointers.delete(event.pointerId);
  if (pointers.size === 0) {
    /* 末指抬起：摘监听并结束拖拽态 */
    unbindGesture();
    dragStart = null;
    dragging.value = false;
    return;
  }
  if (pointers.size === 1) {
    /* 捏合抬起一指：剩余指平滑接续为拖拽锚点 */
    const [only] = [...pointers.values()];
    dragStart = { x: only.x, y: only.y };
    pinchStartDistance = 0;
  }
}

function onWindowPointerCancel(event: PointerEvent): void {
  onWindowPointerUp(event);
}

/** 双击图片复位（回到适配大小与居中） */
function onImageDblclick(event: MouseEvent): void {
  event.preventDefault();
  resetTransform();
}

function close(): void {
  if (props.image === null) return;
  emit('close');
}

function onMaskClick(): void {
  /* 拖拽 / 捏合结束时的 click 不当点按（否则平移一下图就关了） */
  if (gestured) {
    gestured = false;
    return;
  }
  if (props.maskClosable) close();
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && props.image !== null) {
    event.preventDefault();
    close();
  }
}

/** 键盘（Esc 关闭）只在打开态监听，与 BtDrawer 同口径 */
function bindKeyboard(): void {
  if (typeof document === 'undefined') return;
  document.addEventListener('keydown', onKeydown, true);
}

function unbindKeyboard(): void {
  if (typeof document === 'undefined') return;
  document.removeEventListener('keydown', onKeydown, true);
}

/** 开关副作用：打开锁滚 + 绑 Esc，关闭还原；缩放 / 平移状态每次换图重置 */
watch(
  () => props.image,
  (image) => {
    resetTransform();
    if (image !== null) {
      scrollLock.lock();
      bindKeyboard();
    } else {
      scrollLock.unlock();
      unbindKeyboard();
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  unbindKeyboard();
  resetTransform();
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="image !== null"
      class="bt-lightbox"
      :class="{ 'is-zoomed': scale > 1, 'is-dragging': dragging }"
      role="dialog"
      aria-modal="true"
      :aria-label="ariaLabel || '图片放大查看'"
      @wheel.prevent="onWheel"
      @pointerdown="onPointerDown"
    >
      <div class="bt-lightbox__mask" @click="onMaskClick" />
      <figure class="bt-lightbox__stage">
        <img
          ref="imageRef"
          class="bt-lightbox__image"
          :src="image.src"
          :alt="image.alt ?? ''"
          :style="{ transform: `translate(${offsetX}px, ${offsetY}px) scale(${scale})` }"
          draggable="false"
          @dblclick.prevent="onImageDblclick"
        />
        <figcaption v-if="caption !== ''" class="bt-lightbox__caption">{{ caption }}</figcaption>
      </figure>
      <button type="button" class="bt-lightbox__close" aria-label="关闭" @click="close">✕</button>
    </div>
  </Teleport>
</template>

<style scoped>
.bt-lightbox {
  position: fixed;
  inset: 0;
  /* 抽屉（BtDrawer 为 2000）之上：阅读区可能在抽屉打开时点图 */
  z-index: 2100;
  display: grid;
  place-items: center;
  /* 手势全接管：阻止浏览器原生平移 / 捏合抢事件 */
  touch-action: none;
  user-select: none;
}

.bt-lightbox__mask {
  position: absolute;
  inset: 0;
  background: var(--bt-lightbox-mask, rgb(0 0 0 / 82%));
}

.bt-lightbox__stage {
  position: relative;
  margin: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  max-width: 92vw;
  max-height: 92vh;
  /* 点击大图以外的舞台空白穿透到遮罩：点哪里都能关，只留图片本身不关 */
  pointer-events: none;
}

.bt-lightbox__image {
  max-width: 92vw;
  max-height: 86vh;
  object-fit: contain;
  pointer-events: auto;
  background: var(--bt-lightbox-image-bg, #fff);
  will-change: transform;
}

.bt-lightbox.is-zoomed .bt-lightbox__image {
  cursor: grab;
}

.bt-lightbox.is-dragging .bt-lightbox__image {
  cursor: grabbing;
}

.bt-lightbox__caption {
  max-width: 92vw;
  color: var(--bt-lightbox-color, rgb(255 255 255 / 85%));
  font-size: 14px;
  line-height: 1.5;
  text-align: center;
  pointer-events: auto;
}

.bt-lightbox__close {
  position: absolute;
  top: 12px;
  right: 14px;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 50%;
  background: rgb(255 255 255 / 12%);
  color: #fff;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}

.bt-lightbox__close:hover {
  background: rgb(255 255 255 / 24%);
}

/* 入场动效只在「减少动态效果」未开启时生效（与 BtDrawer 同口径） */
@media (prefers-reduced-motion: no-preference) {
  .bt-lightbox {
    animation: bt-lightbox-fade 0.18s ease-out;
  }

  @keyframes bt-lightbox-fade {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
}
</style>
