<script setup lang="ts">
/**
 * 双栏 / 对页布局容器（D5）
 *
 * 纯布局组件：左右两个插槽 + 中缝分隔 + 可选标签，不持有任何阅读逻辑。
 * `BtCompareView`（双文稿对照）与 `BtCollationCompare`（校勘对照）共用本组件，
 * 因此中缝、比例、响应式堆叠规则只有一套实现。
 *
 * H5（C4/C5）：窄屏（< md 768px）从并排改为上下堆叠（`bt-spread--stacked`），
 * 中缝转为横线；宽视口自动还原并排，不留残留状态。
 */
import { computed } from 'vue';
import { useBreakpoint } from '../use-breakpoint.js';
import { BT_BREAKPOINTS } from '../breakpoints.js';

interface Props {
  /** 布局形态：columns 并列双栏 / facing 对页双栏 */
  mode?: 'columns' | 'facing';
  /** 中缝间距（CSS 长度值），缺省 24px */
  gap?: string;
  /** 左栏标签（如「底本」），留空不显示 */
  leftLabel?: string;
  /** 右栏标签（如「校本」），留空不显示 */
  rightLabel?: string;
}

const props = withDefaults(defineProps<Props>(), {
  mode: 'columns',
  gap: '24px',
});

const rootStyle = computed(() => ({ gap: props.gap }));

/** 窄屏堆叠（与 CSS 断点同源：~ md 阈值） */
const breakpoint = useBreakpoint();
const stacked = computed(() => breakpoint.width.value < BT_BREAKPOINTS.md);
</script>

<template>
  <div
    class="bt-spread"
    :class="[`bt-spread--${mode}`, { 'bt-spread--stacked': stacked }]"
    :data-stacked="stacked ? 'true' : undefined"
    :style="rootStyle"
    role="group"
  >
    <div class="bt-spread__pane bt-spread__pane--left">
      <span v-if="leftLabel" class="bt-spread__label">{{ leftLabel }}</span>
      <div class="bt-spread__slot"><slot name="left" /></div>
    </div>
    <div class="bt-spread__seam" aria-hidden="true"></div>
    <div class="bt-spread__pane bt-spread__pane--right">
      <span v-if="rightLabel" class="bt-spread__label">{{ rightLabel }}</span>
      <div class="bt-spread__slot"><slot name="right" /></div>
    </div>
  </div>
</template>

<style scoped>
.bt-spread {
  display: flex;
  align-items: stretch;
  width: 100%;
  height: 100%;
}
.bt-spread__pane {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.bt-spread__label {
  font-size: 12px;
  line-height: 1.4;
  opacity: 0.6;
  padding: 2px 4px;
}
.bt-spread__slot {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.bt-spread__seam {
  flex: 0 0 auto;
  width: 1px;
  background: currentColor;
  opacity: 0.18;
}
/* 窄屏（< md 768px）上下堆叠，标签保留（JS 断点与 CSS 同源） */
.bt-spread--stacked {
  flex-direction: column;
}
.bt-spread--stacked .bt-spread__seam {
  width: auto;
  height: 1px;
}

@media (max-width: 768px) {
  .bt-spread {
    flex-direction: column;
  }
  .bt-spread__seam {
    width: auto;
    height: 1px;
  }
}
</style>
