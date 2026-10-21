<script setup lang="ts">
/**
 * 目录项（BtTocItem）
 *
 * 两种模式：
 * - `tree`（缺省）：目录项 + 递归子级，保持旧版递归结构与事件不变（样式仍由
 *   `BtToc` 的 `bt-toc` 样式块提供）；
 * - `row`：由 `BtToc` 驱动的扁平行——折叠 / 活动 / 搜索命中均由视图模型算好，
 *   本组件只渲染一行并抛事件，不再自行递归（避免组件与会话状态双份持有）。
 *
 * 缩略图由宿主传入（`thumbnail`），缺省渲染首字占位骨架：仓库暂无截图能力，
 * 不在此处引入 Canvas 抓图。
 */
import { computed } from 'vue';
import type { OutlineItem } from '@bibliotype/reader';
import { splitTocTitle } from '../toc-model.js';

defineOptions({ name: 'BtTocItem' });

const props = withDefaults(
  defineProps<{
    /** 目录项 */
    item: OutlineItem;
    /** 层级（顶栏 0） */
    depth?: number;
    /** 渲染模式：tree = 递归树（旧行为）；row = 扁平行（BtToc 驱动） */
    mode?: 'tree' | 'row';
    /** 行键（row 模式用于滚动定位与 `data-toc-key`） */
    rowKey?: string;
    /** 是否有子项（row 模式由视图模型给出） */
    hasChildren?: boolean;
    /** 是否展开 */
    expanded?: boolean;
    /** 是否为当前阅读位置 */
    active?: boolean;
    /** 是否命中搜索词 */
    matched?: boolean;
    /** 搜索词（用于命中片段高亮） */
    query?: string;
    /** 缩略图地址（图片 / dataURL）；缺省渲染首字占位 */
    thumbnail?: string;
    /** 是否显示缩略图列 */
    showThumbnail?: boolean;
  }>(),
  {
    depth: 0,
    mode: 'tree',
    expanded: false,
    active: false,
    matched: false,
    showThumbnail: false,
  },
);

const emit = defineEmits<{
  (event: 'select', item: OutlineItem): void;
  (event: 'toggle'): void;
}>();

/** 行内缩进（与旧版 14px 阶梯一致，仅补一点起始内边距） */
const rowStyle = computed(() => ({ paddingInlineStart: `${props.depth * 14 + 6}px` }));

/** 标题高亮片段（不用 v-html，避免标题里的尖括号被当标签） */
const segments = computed(() =>
  props.matched ? splitTocTitle(props.item.title, props.query) : [{ text: props.item.title, matched: false }],
);

/** 缩略图占位首字 */
const firstGlyph = computed(() => (props.item.title.length > 0 ? props.item.title.slice(0, 1) : '目'));

const displayTitle = computed(() => (props.item.title.length > 0 ? props.item.title : '（无标题）'));
</script>

<template>
  <li
    class="bt-toc__item"
    :class="{ 'bt-toc__item--active': active }"
    :data-toc-key="rowKey"
  >
    <div class="bt-toc__row" :style="rowStyle">
      <button
        v-if="hasChildren"
        type="button"
        class="bt-toc__toggle"
        :class="{ 'bt-toc__toggle--open': expanded }"
        :aria-expanded="expanded"
        :aria-label="`${expanded ? '收起' : '展开'}${displayTitle}`"
        @click.stop="emit('toggle')"
      >
        <span class="bt-toc__arrow" aria-hidden="true" />
      </button>
      <span v-else class="bt-toc__toggle bt-toc__toggle--ghost" aria-hidden="true" />

      <span v-if="showThumbnail" class="bt-toc__thumb-wrap" aria-hidden="true">
        <img v-if="thumbnail" class="bt-toc__thumb" :src="thumbnail" alt="" loading="lazy" />
        <span v-else class="bt-toc__thumb bt-toc__thumb--placeholder">{{ firstGlyph }}</span>
      </span>

      <button
        type="button"
        class="bt-toc__link"
        :aria-current="active ? 'location' : undefined"
        @click="emit('select', item)"
      >
        <span
          v-for="(segment, index) in segments"
          :key="index"
          :class="{ 'bt-toc__hit': segment.matched }"
        >{{ segment.text }}</span>
      </button>
    </div>

    <ul v-if="mode === 'tree' && item.children.length > 0" class="bt-toc__list">
      <BtTocItem
        v-for="child in item.children"
        :key="child.nodeId ?? child.title"
        :item="child"
        :depth="depth + 1"
        @select="emit('select', $event)"
        @toggle="emit('toggle')"
      />
    </ul>
  </li>
</template>
