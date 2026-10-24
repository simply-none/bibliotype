<script setup lang="ts">
/**
 * 图片放大弹窗（lightbox）
 *
 * 阅读视图点击图片 / 编辑画布双击图片后的放大查看容器：Teleport 到 body 的暗色
 * 遮罩 + 居中等比大图（object-fit contain）+ 说明文字（字图显示原字，插图显示
 * alt）。关闭途径：遮罩点击 / Esc / 右上角关闭按钮（触屏无 Esc）；开启期间
 * `useScrollLock` 锁背景滚动（计数锁，可与抽屉等浮层叠加）。
 *
 * `image` 为 null 即关闭态（不渲染）。直排阅读流中的字图 90° 旋转不带入弹窗，
 * 恒以原图方向展示。视觉变量（美化口径同 BtDrawer，均带默认值）：
 * `--bt-lightbox-mask`（遮罩色）/ `--bt-lightbox-color`（说明文字色）/
 * `--bt-lightbox-image-bg`（图片衬底，透明 PNG 字图在暗背景上以白衬底保持可读）。
 */
import { computed, onBeforeUnmount, watch } from 'vue';
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

function close(): void {
  if (props.image === null) return;
  emit('close');
}

function onMaskClick(): void {
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

/** 开关副作用：打开锁滚 + 绑 Esc，关闭还原（immediate 覆盖初始即打开的挂载形态） */
watch(
  () => props.image,
  (image) => {
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
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="image !== null"
      class="bt-lightbox"
      role="dialog"
      aria-modal="true"
      :aria-label="ariaLabel || '图片放大查看'"
    >
      <div class="bt-lightbox__mask" @click="onMaskClick" />
      <figure class="bt-lightbox__stage">
        <img class="bt-lightbox__image" :src="image.src" :alt="image.alt ?? ''" />
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
