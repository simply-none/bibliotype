<script setup lang="ts">
/**
 * 工具条悬浮使用说明（Demo 层）
 *
 * 用 Vue 组件替代浏览器原生 `title`：原生提示延迟约 1s、字数一长就被截断，
 * 也无法承载「前提 / 落点 / 属性 / 限制」这类结构化信息。
 *
 * 用法：把按钮塞进默认插槽即可，`usage` 为可插拔字段 ——
 * - 传了 `usage` → 鼠标悬浮 / 键盘聚焦时弹出说明卡片；
 * - 没传 → 只渲染插槽，不注册任何悬浮行为（工具条抽成公共组件后由使用方决定）。
 *
 * 定位：卡片 `Teleport` 到 body 并 `position: fixed`，按包裹层的
 * `getBoundingClientRect()` 贴其下方；下方空间不足时翻到上方，右侧溢出则右对齐。
 * 必须 Teleport：工具条自身 `overflow-x: auto` 会裁掉非 fixed 的溢出内容。
 * 页面滚动 / 窗口缩放时直接收起（比跟随重算更稳，也不会出现错位残影）。
 */
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import type { ToolbarUsage } from './toolbar-usage.js';

const props = defineProps<{ usage?: ToolbarUsage }>();

/** 悬浮触发区（包裹按钮的 span） */
const anchorRef = ref<HTMLElement | null>(null);
/** 说明卡片 */
const cardRef = ref<HTMLElement | null>(null);
/** 是否展示 */
const visible = ref(false);
/** 是否已完成定位（定位前保持透明，避免出现「左上角闪一下」） */
const placed = ref(false);
/** 内联定位样式 */
const cardStyle = ref<Record<string, string>>({});

/** 卡片与触发区的间距 */
const GAP = 8;
/** 卡片与视口边缘的最小留白 */
const EDGE = 8;

/** 计算落点：默认下方左对齐，空间不足时翻转 / 右对齐 */
function place(): void {
  const anchor = anchorRef.value;
  const card = cardRef.value;
  if (anchor === null || card === null) return;
  const rect = anchor.getBoundingClientRect();
  const width = card.offsetWidth;
  const height = card.offsetHeight;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let left = rect.left;
  if (left + width > viewportWidth - EDGE) {
    left = Math.max(EDGE, viewportWidth - EDGE - width);
  }
  let top = rect.bottom + GAP;
  if (top + height > viewportHeight - EDGE) {
    top = Math.max(EDGE, rect.top - height - GAP);
  }
  cardStyle.value = { left: `${left}px`, top: `${top}px` };
  placed.value = true;
}

/** 展开说明（无 usage 时不做任何事） */
async function reveal(): Promise<void> {
  if (props.usage === undefined) return;
  visible.value = true;
  placed.value = false;
  await nextTick();
  place();
}

/** 延迟展开句柄（鼠标横扫一排按钮时不必逐个闪卡片） */
let showTimer: number | null = null;

/** 取消待执行的展开 */
function cancelShow(): void {
  if (showTimer !== null) {
    window.clearTimeout(showTimer);
    showTimer = null;
  }
}

/** 延迟展开（120ms） */
function scheduleShow(): void {
  if (props.usage === undefined) return;
  // 先取消待收起：鼠标快速离开又回来时，卡片不应被之前的定时器关掉
  cancelHide();
  if (visible.value) return;
  cancelShow();
  showTimer = window.setTimeout(() => {
    showTimer = null;
    void reveal();
  }, 120);
}

/** 收起说明 */
function hide(): void {
  cancelShow();
  cancelHide();
  visible.value = false;
  placed.value = false;
}

/** 延迟收起句柄（鼠标从按钮移到卡片要跨过 GAP 空隙，需要宽限） */
let hideTimer: number | null = null;

/** 取消待执行的收起 */
function cancelHide(): void {
  if (hideTimer !== null) {
    window.clearTimeout(hideTimer);
    hideTimer = null;
  }
}

/**
 * 延迟收起
 *
 * 卡片可交互（可选中 / 复制说明文字），所以鼠标离开按钮后要留约 200ms 宽限：
 * 期间进入卡片则取消收起，停在卡片上不会被误关。
 */
function scheduleHide(): void {
  cancelHide();
  hideTimer = window.setTimeout(() => {
    hideTimer = null;
    hide();
  }, 200);
}

/** 滚动 / 尺幅变化即收起，避免卡片与按钮脱离 */
function hideOnViewportChange(): void {
  if (visible.value) hide();
}

onMounted(() => {
  window.addEventListener('scroll', hideOnViewportChange, true);
  window.addEventListener('resize', hideOnViewportChange);
});

onBeforeUnmount(() => {
  cancelShow();
  cancelHide();
  window.removeEventListener('scroll', hideOnViewportChange, true);
  window.removeEventListener('resize', hideOnViewportChange);
});
</script>

<template>
  <span
    ref="anchorRef"
    class="usage-tip"
    @mouseenter="scheduleShow"
    @mouseleave="scheduleHide"
    @focusin="scheduleShow"
    @focusout="scheduleHide"
  >
    <slot />
    <Teleport to="body">
      <div
        v-if="visible && usage !== undefined"
        ref="cardRef"
        class="usage-tip__card"
        :class="{ 'usage-tip__card--placed': placed }"
        :style="cardStyle"
        role="tooltip"
        @mouseenter="cancelHide"
        @mouseleave="scheduleHide"
      >
        <p class="usage-tip__use">{{ usage.use }}</p>
        <p v-if="usage.require" class="usage-tip__row">
          <span class="usage-tip__key">前提</span>{{ usage.require }}
        </p>
        <p v-if="usage.where" class="usage-tip__row">
          <span class="usage-tip__key">落点</span>{{ usage.where }}
        </p>
        <p v-if="usage.attrs" class="usage-tip__row">
          <span class="usage-tip__key">属性</span>{{ usage.attrs }}
        </p>
        <p v-if="usage.limit" class="usage-tip__row usage-tip__row--limit">
          <span class="usage-tip__key">限制</span>{{ usage.limit }}
        </p>
        <p v-if="usage.key" class="usage-tip__foot">
          <kbd class="usage-tip__kbd">{{ usage.key }}</kbd>
        </p>
      </div>
    </Teleport>
  </span>
</template>

<style scoped>
.usage-tip {
  display: inline-flex;
  flex: none;
}

.usage-tip__card {
  position: fixed;
  z-index: 60;
  width: max-content;
  max-width: 280px;
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--demo-text, #3c3a34);
  background: var(--demo-panel, #f4f0e8);
  border: 1px solid var(--demo-border, #e2ddd2);
  border-radius: 6px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.14);
  opacity: 0;
  /* 定位完成前不接收指针（此时它可能悬在按钮附近且不可见） */
  pointer-events: none;
  transition: opacity 0.08s ease;
}

/* 定位完成后既可看也可交互：允许把鼠标移进卡片选中 / 复制说明，
   靠 scheduleHide 的 200ms 宽限期衔接「按钮 → 卡片」的空隙 */
.usage-tip__card--placed {
  opacity: 1;
  pointer-events: auto;
}

.usage-tip__use {
  margin: 0;
  font-weight: 600;
}

.usage-tip__row {
  margin: 4px 0 0;
  color: var(--demo-muted, #8a8578);
}

.usage-tip__row--limit {
  color: #a8542f;
}

.usage-tip__key {
  display: inline-block;
  min-width: 28px;
  margin-inline-end: 6px;
  padding: 0 3px;
  color: var(--demo-accent, #8c5a2b);
  font-size: 11px;
  text-align: center;
  border: 1px solid var(--demo-control-border, #d8d2c4);
  border-radius: 3px;
}

.usage-tip__foot {
  margin: 6px 0 0;
}

.usage-tip__kbd {
  padding: 1px 5px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  color: var(--demo-accent, #8c5a2b);
  background: var(--demo-control, #fbf9f4);
  border: 1px solid var(--demo-control-border, #d8d2c4);
  border-radius: 3px;
}
</style>
