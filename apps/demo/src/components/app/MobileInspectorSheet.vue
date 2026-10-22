<script setup lang="ts">
/**
 * H5 编辑态属性 sheet（Demo 层）
 *
 * 底部可拖拽抽屉（半屏 / 全屏两档吸附），承载属性检视器 AttrInspector：
 * 桌面横排时属性栏是主区右侧常驻栏、直排时是状态栏左侧附加列，H5 空间受限
 * 改走底部 sheet —— 同一份 AttrInspector、同一份 binding。挂载条件
 * （mobileShell / 编辑态 / 有 binding）由父级 App.vue 决定，本组件只管渲染抽屉。
 */
import { BtDrawer, type EditorBinding } from '@bibliotype/vue';
import type { NamedStyle } from '@bibliotype/core';
import AttrInspector from '../AttrInspector.vue';
import { MOBILE_INSPECTOR_SNAPS } from '../../composables/use-mobile-shell.js';

/** 抽屉开合（父级经 v-model:open 双向绑定 mobileInspectorOpen） */
const open = defineModel<boolean>('open', { required: true });

defineProps<{
  /** 当前编辑器绑定（非空由父级 v-if 保证） */
  binding: EditorBinding;
  /** 命名样式列表（透传给 AttrInspector） */
  namedStyles: NamedStyle[];
}>();
</script>

<template>
  <BtDrawer
    v-model:open="open"
    side="bottom"
    title="属性"
    :snap-heights="MOBILE_INSPECTOR_SNAPS"
  >
    <AttrInspector :binding="binding" :named-styles="namedStyles" />
  </BtDrawer>
</template>
