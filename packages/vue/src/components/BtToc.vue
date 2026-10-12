<script setup lang="ts">
/**
 * 目录树（BtToc）
 *
 * 渲染 Reader 目录层级；点击节点经 goToNode 跳页并抛出 select 事件。
 */
import type { OutlineItem, Reader } from '@bibliotype/reader';
import { useReaderBinding } from '../use-reader.js';
import BtTocItem from './BtTocItem.vue';

const props = defineProps<{ reader: Reader }>();
const emit = defineEmits<{ select: [item: OutlineItem] }>();

const { outline } = useReaderBinding(props.reader);

/** 跳转并上报（无 nodeId 的项仅上报） */
function handleSelect(item: OutlineItem): void {
  if (item.nodeId !== undefined) {
    props.reader.goToNode(item.nodeId);
  }
  emit('select', item);
}
</script>

<template>
  <nav class="bt-toc" aria-label="目录">
    <ul class="bt-toc__list">
      <BtTocItem
        v-for="item in outline"
        :key="item.nodeId ?? item.title"
        :item="item"
        @select="handleSelect"
      />
    </ul>
  </nav>
</template>

<style>
/* 目录样式为跨组件共享（BtToc / BtTocItem 同一套 bt-toc 命名空间），
   以 bt- 前缀避免全局冲突 */
.bt-toc {
  font-size: 14px;
}

.bt-toc__list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.bt-toc__link {
  display: block;
  width: 100%;
  padding: 6px 10px;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: start;
  cursor: pointer;
}

.bt-toc__link:hover {
  background: rgba(127, 127, 127, 0.12);
}
</style>
