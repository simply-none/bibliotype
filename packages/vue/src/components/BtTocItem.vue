<script setup lang="ts">
/**
 * 目录项（BtTocItem，递归渲染）
 *
 * 层级缩进 + select 事件冒泡；样式由 BtToc 的 bt-toc 类命名空间承担。
 */
import type { OutlineItem } from '@bibliotype/reader';

defineOptions({ name: 'BtTocItem' });

withDefaults(defineProps<{ item: OutlineItem; depth?: number }>(), { depth: 0 });

const emit = defineEmits<{ select: [item: OutlineItem] }>();
</script>

<template>
  <li class="bt-toc__item">
    <button
      type="button"
      class="bt-toc__link"
      :style="{ paddingInlineStart: `${depth * 14 + 10}px` }"
      @click="emit('select', item)"
    >
      {{ item.title }}
    </button>
    <ul v-if="item.children.length > 0" class="bt-toc__list">
      <BtTocItem
        v-for="child in item.children"
        :key="child.nodeId ?? child.title"
        :item="child"
        :depth="depth + 1"
        @select="emit('select', $event)"
      />
    </ul>
  </li>
</template>
