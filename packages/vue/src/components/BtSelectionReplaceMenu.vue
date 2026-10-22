<script setup lang="ts">
/**
 * 选区「替换为」浮动菜单（BtSelectionReplaceMenu）
 *
 * 选中文本后在选区旁弹出，标题固定为「替换为」，下方按分组展示可转换目标。
 * 只负责视图、定位与生命周期；具体目标与命令由使用方经 `groups` 注入，
 * 点击时统一走 `binding.execute`（请传 BtEditor 插槽的 slotBinding，paged 态
 * 才会同步选区并在重排后还原光标）。
 *
 * 交互约束：
 * - 菜单项 `@mousedown.prevent`，点击时不塌陷选区；
 * - `Esc` / 点击菜单外关闭；关闭后同一选区不再自动弹出，选区变化后重置；
 * - Teleport 到 body + position: fixed，避免被工具条 overflow 裁剪；
 * - 定位只用视口坐标，横排 / 直排通用。
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
import type { EditorBinding } from '../use-editor.js';
import { useBreakpoint } from '../use-breakpoint.js';
import { placeFloating } from '../floating-position.js';
import {
  useSelectionReplace,
  type ReplaceTargetGroup,
  type ReplaceTargetItem,
} from '../use-selection-replace.js';

const props = withDefaults(
  defineProps<{
    /** BtEditor 插槽透传的 binding（paged 态请传 slotBinding） */
    binding: EditorBinding;
    /** 目标分组 */
    groups: readonly ReplaceTargetGroup[];
    /** 只读时永不显示 */
    readonly?: boolean;
    /** 选区变化时自动弹出（默认 true） */
    autoShow?: boolean;
  }>(),
  {
    // 布尔 prop 缺省会被 Vue 转成 false，这里显式声明默认值
    autoShow: true,
    readonly: false,
  },
);

const { visible, anchor, close } = useSelectionReplace(props.binding, {
  autoShow: props.autoShow,
  readonly: () => props.readonly === true,
});

const menuRef = ref<HTMLElement | null>(null);
const menuSize = ref({ width: 0, height: 0 });
let observer: ResizeObserver | null = null;

/** 粗指针（触屏）：菜单项放大到 44px，滚动时直接关闭（B3） */
const breakpoint = useBreakpoint();

/** 实测菜单尺寸（首次渲染后由 watch 触发） */
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

/** 视口尺寸（SSR 兜底）：软键盘弹出时取 visualViewport（菜单不上移进键盘区） */
function viewportSize(): { width: number; height: number } {
  if (typeof window === 'undefined') {
    return { width: 1024, height: 768 };
  }
  const visual = window.visualViewport;
  return {
    width: visual?.width ?? window.innerWidth,
    height: visual?.height ?? window.innerHeight,
  };
}

const placed = computed(() => {
  if (anchor.value === null) {
    return null;
  }
  return placeFloating(anchor.value, menuSize.value, viewportSize());
});

const menuStyle = computed<CSSProperties>(() => {
  const position = placed.value;
  if (position === null) {
    return {};
  }
  return {
    top: `${Math.round(position.top)}px`,
    left: `${Math.round(position.left)}px`,
    // 首次渲染尚未实测尺寸时先隐藏，避免从错误位置闪一下
    visibility: menuSize.value.width > 0 ? 'visible' : 'hidden',
  };
});

const show = computed(() => visible.value && anchor.value !== null && props.groups.length > 0);

function run(item: ReplaceTargetItem): void {
  if (item.disabled?.(props.binding) === true) {
    return;
  }
  props.binding.execute(item.command());
  close();
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && visible.value) {
    close();
  }
}

function onDocMousedown(event: MouseEvent): void {
  if (!visible.value) {
    return;
  }
  const target = event.target as Node | null;
  if (target !== null && menuRef.value?.contains(target) === true) {
    return;
  }
  close();
}

watch(
  [visible, anchor],
  async () => {
    if (!visible.value) {
      observer?.disconnect();
      return;
    }
    await nextTick();
    measure();
    if (typeof ResizeObserver !== 'undefined' && menuRef.value !== null) {
      observer?.disconnect();
      observer = new ResizeObserver(() => measure());
      observer.observe(menuRef.value);
    }
  },
  { flush: 'post' },
);

/**
 * 触摸滚动时直接关闭（B3）
 *
 * 桌面由 `useSelectionReplace` 在滚动时重算位置（菜单跟随选区）；触屏滚动后选区
 * 手柄与菜单同时漂移，体验更差，故触屏口径改为关闭，再次拖选时重新弹出。
 */
function onWindowScroll(): void {
  if (breakpoint.coarsePointer.value && visible.value) close();
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown, true);
  document.addEventListener('mousedown', onDocMousedown, true);
  window.addEventListener('scroll', onWindowScroll, true);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  document.removeEventListener('keydown', onKeydown, true);
  document.removeEventListener('mousedown', onDocMousedown, true);
  window.removeEventListener('scroll', onWindowScroll, true);
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="show"
      ref="menuRef"
      class="bt-replace-menu"
      :class="{ 'bt-replace-menu--touch': breakpoint.coarsePointer.value }"
      role="toolbar"
      aria-label="替换为"
      :style="menuStyle"
      @mousedown.prevent
    >
      <div class="bt-replace-menu__title">替换为</div>
      <div v-for="group in groups" :key="group.key" class="bt-replace-menu__group">
        <div class="bt-replace-menu__label">{{ group.label }}</div>
        <div class="bt-replace-menu__items">
          <button
            v-for="item in group.items"
            :key="item.key"
            type="button"
            class="bt-replace-menu__item"
            :class="{ 'bt-replace-menu__item--active': item.active?.(binding) === true }"
            :disabled="item.disabled?.(binding) === true"
            :title="item.hint"
            @mousedown.prevent
            @click="run(item)"
          >
            {{ item.label }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.bt-replace-menu {
  position: fixed;
  z-index: 3000;
  display: flex;
  flex-direction: column;
  gap: 6px;
  box-sizing: border-box;
  width: max-content;
  max-width: min(92vw, 520px);
  max-height: min(60vh, 460px);
  padding: 8px 10px 10px;
  overflow-y: auto;
  border: 1px solid var(--bt-replace-menu-border, rgba(15, 23, 42, 0.14));
  border-radius: 8px;
  background: var(--bt-replace-menu-bg, #fff);
  color: var(--bt-replace-menu-color, #1f2328);
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.18);
  font-size: 13px;
  line-height: 1.4;
  user-select: none;
}

.bt-replace-menu__title {
  padding-bottom: 4px;
  border-bottom: 1px solid var(--bt-replace-menu-border, rgba(15, 23, 42, 0.1));
  font-weight: 600;
  font-size: 12px;
  letter-spacing: 0.04em;
  opacity: 0.86;
}

.bt-replace-menu__group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.bt-replace-menu__label {
  font-size: 11px;
  opacity: 0.62;
}

.bt-replace-menu__items {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.bt-replace-menu__item {
  padding: 3px 10px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: var(--bt-replace-menu-item-bg, rgba(15, 23, 42, 0.05));
  color: inherit;
  font-size: 13px;
  line-height: 1.6;
  cursor: pointer;
}

.bt-replace-menu__item:hover:not(:disabled) {
  background: var(--bt-replace-menu-item-hover, rgba(37, 99, 235, 0.12));
}

.bt-replace-menu__item:disabled {
  opacity: 0.38;
  cursor: not-allowed;
}

.bt-replace-menu__item--active {
  border-color: var(--bt-replace-menu-active, rgba(37, 99, 235, 0.65));
  color: var(--bt-replace-menu-active, #2563eb);
}

/* 触屏（D2）：菜单项点击区补到 44px（字号不变） */
.bt-replace-menu--touch .bt-replace-menu__item {
  min-height: 44px;
  padding: 8px 12px;
}

.bt-replace-menu--touch .bt-replace-menu__items {
  gap: 6px;
}

@media (prefers-color-scheme: dark) {
  .bt-replace-menu {
    --bt-replace-menu-bg: #1e242d;
    --bt-replace-menu-color: #e6e8eb;
    --bt-replace-menu-border: rgba(255, 255, 255, 0.14);
    --bt-replace-menu-item-bg: rgba(255, 255, 255, 0.08);
    --bt-replace-menu-item-hover: rgba(96, 165, 250, 0.22);
    --bt-replace-menu-active: #93c5fd;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
  }
}
</style>
