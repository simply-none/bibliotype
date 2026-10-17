<script setup lang="ts">
/**
 * 消息条容器（Demo 层）
 *
 * 固定在右下角的浮层，承接 `useToast` 的队列：新消息向下堆叠、到期自动消失、
 * 也可手动关闭。`Teleport` 到 body 是为了不被 `.app` 的布局与 `overflow` 裁剪；
 * 不拦截指针的区域只有消息卡片本身可点（关闭按钮），其余区域穿透到画布。
 */
import type { ToastItem } from '../composables/use-toast.js';

defineProps<{ items: readonly ToastItem[] }>();
const emit = defineEmits<{ dismiss: [id: number] }>();
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
  right: 16px;
  bottom: 16px;
  z-index: 70;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: min(420px, calc(100vw - 32px));
  pointer-events: none;
}

.toast__item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--demo-text, #3c3a34);
  background: var(--demo-panel, #f4f0e8);
  border: 1px solid var(--demo-border, #e2ddd2);
  border-inline-start: 3px solid var(--demo-accent, #8c5a2b);
  border-radius: 6px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.14);
  animation: toast-in 0.16s ease-out;
  pointer-events: auto;
}

.toast__item--success {
  border-inline-start-color: #2f7d4f;
}

.toast__item--error {
  border-inline-start-color: #b3261e;
  color: #8c1d18;
}

.toast__text {
  flex: 1;
  min-width: 0;
  word-break: break-word;
}

.toast__close {
  flex: none;
  width: 18px;
  height: 18px;
  margin-block-start: 1px;
  font-size: 14px;
  line-height: 1;
  color: var(--demo-muted, #8a8578);
  background: none;
  border: 0;
  border-radius: 3px;
  cursor: pointer;
}

.toast__close:hover {
  background: rgba(127, 127, 127, 0.15);
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
</style>
