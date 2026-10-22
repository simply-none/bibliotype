<script setup lang="ts">
/**
 * 消息条容器（Demo 层）
 *
 * 固定在右下角的浮层，承接 `useToast` 的队列：新消息向下堆叠、到期自动消失、
 * 也可手动关闭。`Teleport` 到 body 是为了不被 `.app` 的布局与 `overflow` 裁剪；
 * 不拦截指针的区域只有消息卡片本身可点（关闭按钮），其余区域穿透到画布。
 *
 * 美化 P3：卡片统一走 `--ui-surface-raised` + `--ui-radius-md` + `--ui-shadow-2`，
 * 语气除颜色外再加图标（信息 / 完成 / 错误）——单靠色条区分对色盲不友好；
 * H5 下避开底部安全区与底栏，动效受全局 `--ui-dur-*` 与 reduced-motion 控制。
 */
import type { ToastItem, ToastTone } from '../composables/use-toast.js';
import AppIcon from './AppIcon.vue';
import type { AppIconName } from '../app-icons.js';

defineProps<{ items: readonly ToastItem[] }>();
const emit = defineEmits<{ dismiss: [id: number] }>();

/** 语气→图标（与左边色条同义，保证不只看颜色也能分辨） */
const TONE_ICON: Record<ToastTone, AppIconName> = {
  info: 'info',
  success: 'check',
  error: 'close',
};
</script>

<template>
  <Teleport to="body">
    <div class="toast" role="status" aria-live="polite">
      <div
        v-for="item in items"
        :key="item.id"
        class="toast__item"
        :class="`toast__item--${item.tone}`"
      >
        <AppIcon class="toast__icon" :name="TONE_ICON[item.tone]" :size="16" :stroke-width="2" />
        <span class="toast__text">{{ item.text }}</span>
        <button
          type="button"
          class="toast__close"
          aria-label="关闭提示"
          @click="emit('dismiss', item.id)"
        >
          ×
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.toast {
  position: fixed;
  right: calc(16px + var(--bt-safe-right, 0px));
  bottom: calc(16px + var(--bt-safe-bottom, 0px));
  z-index: var(--ui-z-toast, 60);
  display: flex;
  flex-direction: column;
  gap: var(--ui-space-2, 6px);
  max-width: min(420px, calc(100vw - 32px));
  pointer-events: none;
}

.toast__item {
  display: flex;
  align-items: flex-start;
  gap: var(--ui-space-2, 6px);
  padding: var(--ui-space-3, 8px) var(--ui-space-4, 12px);
  font-size: var(--ui-font-sm, 12px);
  line-height: 1.6;
  color: var(--ui-text, #3c3a34);
  background: var(--ui-surface-raised, #faf8f4);
  border: var(--ui-border-width, 1px) solid var(--ui-border, #e2ddd2);
  border-inline-start: 3px solid var(--ui-accent, #8c5a2b);
  border-radius: var(--ui-radius-md, 12px);
  box-shadow: var(--ui-shadow-2, 0 6px 20px rgba(0, 0, 0, 0.12));
  animation: toast-in var(--ui-dur-fast, 160ms) var(--ui-ease, ease-out);
  pointer-events: auto;
}

.toast__item--success {
  border-inline-start-color: var(--ui-success, #2f7d4f);
}

.toast__item--error {
  border-inline-start-color: var(--ui-danger, #b3261e);
  color: var(--ui-danger, #b3261e);
}

.toast__icon {
  flex: none;
  margin-block-start: 2px;
  color: var(--ui-accent, #8c5a2b);
}

.toast__item--success .toast__icon {
  color: var(--ui-success, #2f7d4f);
}

.toast__item--error .toast__icon {
  color: var(--ui-danger, #b3261e);
}

.toast__text {
  flex: 1;
  min-width: 0;
  word-break: break-word;
}

.toast__close {
  flex: none;
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  margin-block-start: 1px;
  font-size: 14px;
  line-height: 1;
  color: var(--ui-text-muted, #7f7a6d);
  background: none;
  border: 0;
  border-radius: var(--ui-radius-xs, 4px);
  cursor: pointer;
  transition:
    background var(--ui-dur-fast, 120ms) var(--ui-ease, ease),
    color var(--ui-dur-fast, 120ms) var(--ui-ease, ease);
}

.toast__close:hover {
  color: var(--ui-text, #3c3a34);
  background: var(--ui-surface-sunken, rgba(127, 127, 127, 0.15));
}

@keyframes toast-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* H5：消息条不让 Home 指示条压住，同时给底栏留出空间 */
@media (max-width: 767px) {
  .toast {
    right: var(--ui-space-4, 12px);
    left: var(--ui-space-4, 12px);
    bottom: calc(72px + var(--bt-safe-bottom, 0px));
    max-width: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .toast__item {
    animation: none;
  }
}
</style>
