<script setup lang="ts">
/**
 * 书籍页面视图（BtBookView）
 *
 * - 渲染当前页节点：IR → HTML 经 layout/html 序列化（与导出器同源）；
 * - 注入书册样式表：buildBookCss，容器选择器指向本组件的页框；
 * - 页框 inline 样式 = buildPageStyle（尺寸 / 页边距）+ buildRootStyle（排版规则）；
 * - fit 缩放：按容器尺寸等比缩放整页（ResizeObserver）。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { DEFAULT_THEME, isTextNode } from '@bibliotype/core';
import { buildPageStyle, buildRootStyle } from '@bibliotype/layout';
import { buildBookCss, serializeNode } from '@bibliotype/layout/html';
import type { Reader } from '@bibliotype/reader';
import { useReaderBinding } from '../use-reader.js';

const props = withDefaults(
  defineProps<{
    /** 阅读器实例 */
    reader: Reader;
    /** 主题令牌值表（缺省 DEFAULT_THEME） */
    tokens?: Readonly<Record<string, string | undefined>>;
    /** 正文字体族令牌键（古籍可传 FONT_TOKENS.CLASSICAL_BODY） */
    fontToken?: string;
    /** 缩放策略：width 按容器宽 / contain 按容器宽高 / none 原尺寸 */
    fit?: 'width' | 'contain' | 'none';
  }>(),
  { fit: 'contain' },
);

const { layout, pageNodes } = useReaderBinding(props.reader);
const tokens = computed<Readonly<Record<string, string | undefined>>>(
  () => props.tokens ?? DEFAULT_THEME,
);
const pageSize = computed(() => layout.value.pageSize);

/* ---------- 页内容与样式 ---------- */

/** 当前页 HTML 片段（文本叶子不输出） */
const pageHtml = computed(() =>
  pageNodes.value
    .filter((node) => !isTextNode(node))
    .map((node) => serializeNode(node))
    .join('\n'),
);

/** 页框样式（固定尺寸 + 页边距 + 排版规则） */
const pageStyle = computed(() => ({
  ...buildPageStyle(pageSize.value, tokens.value),
  ...buildRootStyle({
    tokens: tokens.value,
    options: layout.value,
    fontToken: props.fontToken,
  }),
}));

/** 注入 / 更新全局书册样式表（多实例共享，以最后写入为准） */
const STYLE_ELEMENT_ID = 'bt-book-css';

function syncBookStyle(): void {
  if (typeof document === 'undefined') return;
  const css = buildBookCss({
    tokens: tokens.value,
    options: layout.value,
    fontToken: props.fontToken,
    containerSelector: '.bt-reader-page',
  });
  let element = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;
  if (element === null) {
    element = document.createElement('style');
    element.id = STYLE_ELEMENT_ID;
    document.head.appendChild(element);
  }
  if (element.textContent !== css) {
    element.textContent = css;
  }
}

onMounted(syncBookStyle);
watch([tokens, () => layout.value], syncBookStyle);

/* ---------- fit 缩放 ---------- */

const rootRef = ref<HTMLElement | null>(null);
const scale = ref(1);
let observer: ResizeObserver | undefined;

function updateScale(): void {
  const root = rootRef.value;
  if (props.fit === 'none' || root === null || root.clientWidth <= 0) {
    scale.value = 1;
    return;
  }
  const widthRatio = root.clientWidth / pageSize.value.width;
  const heightRatio = root.clientHeight / pageSize.value.height;
  const ratio =
    props.fit === 'width' || root.clientHeight <= 0
      ? widthRatio
      : Math.min(widthRatio, heightRatio);
  scale.value = Math.min(1, ratio);
}

onMounted(() => {
  updateScale();
  if (props.fit !== 'none' && typeof ResizeObserver !== 'undefined' && rootRef.value !== null) {
    observer = new ResizeObserver(updateScale);
    observer.observe(rootRef.value);
  }
});
onBeforeUnmount(() => {
  observer?.disconnect();
});
watch([() => props.fit, pageSize], updateScale);

/** 舞台尺寸：为缩放下了的整页预留版面（不遮挡相邻内容） */
const stageStyle = computed(() => ({
  width: `${pageSize.value.width * scale.value}px`,
  height: `${pageSize.value.height * scale.value}px`,
}));

/** 页框最终样式：原尺寸渲染 + transform 缩放（transform-origin 左上） */
const scaledPageStyle = computed(() => ({
  ...pageStyle.value,
  transform: `scale(${scale.value})`,
  transformOrigin: 'top left',
}));
</script>

<template>
  <div ref="rootRef" class="bt-book-view">
    <div class="bt-book-view__stage" :style="stageStyle">
      <div class="bt-reader-page" :style="scaledPageStyle" v-html="pageHtml"></div>
    </div>
  </div>
</template>

<style scoped>
.bt-book-view {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.bt-book-view__stage {
  position: relative;
  flex: none;
  box-shadow: 0 2px 14px rgba(0, 0, 0, 0.18);
}

.bt-reader-page {
  position: absolute;
  inset-block-start: 0;
  inset-inline-start: 0;
}
</style>
