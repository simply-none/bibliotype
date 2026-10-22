<script setup lang="ts">
/**
 * 应用图标（P0）
 *
 * 内联 SVG，零依赖：项目基调是「库内不引第三方运行时依赖」，图标同理。
 * - 统一 24 栅格、`stroke="currentColor"`，颜色随按钮文字走皮肤令牌；
 * - `aria-hidden` + `focusable="false"`：图标永远不承担可访问名，
 *   图标按钮必须自带 `aria-label`（e2e 也依赖这个名字，不能丢）；
 * - 路径表在 `app-icons.ts`（宿主常量要引用图标名类型，`<script setup>` 不能 export）。
 */
import { APP_ICON_PATHS, type AppIconName } from '../app-icons.js';

const props = withDefaults(
  defineProps<{
    /** 图标名 */
    name: AppIconName;
    /** 边长（px）；默认 20，按钮内一般 20，分组标题 16 */
    size?: number;
    /** 描边粗细；细图标可降到 1.6 */
    strokeWidth?: number;
  }>(),
  { size: 20, strokeWidth: 1.8 },
);

/** 当前图标的路径集合 */
const paths = APP_ICON_PATHS[props.name];
</script>

<template>
  <svg
    class="app-icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path v-for="d in paths" :key="d" :d="d" />
  </svg>
</template>

<style scoped>
.app-icon {
  display: block;
  flex: none;
}
</style>
