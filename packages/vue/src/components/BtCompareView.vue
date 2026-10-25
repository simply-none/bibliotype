<script setup lang="ts">
/**
 * 双文稿对照视图（D5 / K2 复用容器）
 *
 * - 仅传 `left`：退化为单文档「对页」阅读（`BtBookView` 的 `spread="facing"`）。
 * - 同时传 `right`：左右并排各一份 `BtBookView`，可独立翻页；开启 `syncPages` 时
 *   双向同步页码（重入守卫 + 越界钳制，左侧 / 右侧任一方翻页都会带动另一方）。
 *
 * 两侧阅读位置通过 `update:position` 汇总出去（payload 含 `side`），宿主持久化时
 * 可分别保存两份位置。
 */
import { computed, nextTick, ref } from 'vue';
import type { FeatureStyleSheet, NamedStyleSet } from '@bibliotype/core';
import type { Reader, ReadingPosition } from '@bibliotype/reader';
import BtBookView from './BtBookView.vue';
import BtSpreadLayout from './BtSpreadLayout.vue';

type ViewMode = 'page' | 'scroll' | 'scroll-flow';
type FitMode = 'width' | 'contain' | 'none';
type PageTransition = 'none' | 'slide' | 'fade';

interface Props {
  /** 左侧阅读器（底本） */
  left: Reader;
  /** 右侧阅读器（校本）；缺省则单文档对页 */
  right?: Reader;
  /** 主题令牌值表（透传；缺省由 BtBookView 用 DEFAULT_THEME） */
  tokens?: Readonly<Record<string, string | undefined>>;
  /** 正文字体族令牌键（透传，古籍可传 FONT_TOKENS.CLASSICAL_BODY） */
  fontToken?: string;
  /** 正文字号 px（透传；覆盖主题令牌 font-size-body） */
  fontSize?: number;
  /** 功能样式表（透传，与编辑画布 / 导出同源） */
  features?: FeatureStyleSheet;
  /** 命名样式集合（透传，`[data-style-id]` 规则） */
  namedStyles?: NamedStyleSet;
  /** 栏目标签，缺省「底本 / 校本」 */
  labels?: { left?: string; right?: string };
  /** 双文档模式：左右页码双向同步 */
  syncPages?: boolean;
  /** 阅读模式（透传各侧 `BtBookView`） */
  mode?: ViewMode;
  /** 缩放策略（透传） */
  fit?: FitMode;
  /** 翻页动效（透传） */
  pageTransition?: PageTransition;
  /** 流式分块上限（透传 scroll-flow） */
  flowChunkBlocks?: number;
  /** 初始阅读位置（仅单文档对页模式生效） */
  initialPosition?: ReadingPosition | string;
}

const props = withDefaults(defineProps<Props>(), {
  right: undefined,
  labels: () => ({ left: '底本', right: '校本' }),
  syncPages: false,
  mode: 'page',
  fit: 'contain',
  pageTransition: 'slide',
  flowChunkBlocks: 24,
});

const emit = defineEmits<{
  /** 任一侧阅读位置变化，payload 标注来源侧，供宿主持久化 */
  (event: 'update:position', payload: { side: 'left' | 'right'; position: ReadingPosition }): void;
  /** 某侧请求的模式不被支持，已回落（透传自 `BtBookView`） */
  (event: 'mode-fallback', payload: { side: 'left' | 'right'; requested: string; effective: string; reason: string }): void;
}>();

const isSingle = computed(() => props.right === undefined);

/**
 * 透传给两侧 `BtBookView` 的公共属性
 *
 * 主题令牌 / 字体 / 功能样式与单页阅读共用同一来源，避免对页（尤其古籍仿真）
 * 回落 DEFAULT_THEME 导致纸色、正文字体不一致。
 */
const sharedProps = computed(() => ({
  tokens: props.tokens,
  fontToken: props.fontToken,
  fontSize: props.fontSize,
  features: props.features,
  namedStyles: props.namedStyles,
  mode: props.mode,
  fit: props.fit,
  pageTransition: props.pageTransition,
  flowChunkBlocks: props.flowChunkBlocks,
}));

/** BtBookView defineExpose 暴露的句柄（页码同步用） */
interface BookViewHandle {
  goToPage: (page: number) => boolean;
  currentPage: () => number;
}

const leftRef = ref<InstanceType<typeof BtBookView> | null>(null);
const rightRef = ref<InstanceType<typeof BtBookView> | null>(null);

/** 页码同步：记录上次页码并以重入标志防止 A→B→A 死循环 */
const lastLeftPage = ref<number | undefined>(undefined);
const lastRightPage = ref<number | undefined>(undefined);
let syncing = false;

/** 同步驱动：越界由 Reader 内部钳制；重入标志避免来回触发 */
function syncTo(side: 'left' | 'right', page: number): void {
  if (isSingle.value || !props.syncPages || syncing) return;
  const last = side === 'left' ? lastLeftPage.value : lastRightPage.value;
  if (last !== undefined && last === page) return;
  if (side === 'left') lastLeftPage.value = page;
  else lastRightPage.value = page;
  syncing = true;
  const target = (side === 'left' ? rightRef.value : leftRef.value) as BookViewHandle | null;
  void target?.goToPage(page);
  void nextTick(() => {
    syncing = false;
  });
}

/** 页码变化（page 模式由 BtBookView 抛出）：同步 + 汇总位置 */
function onLeftPage(page: number): void {
  const position = props.left.getPosition();
  if (position !== undefined) emit('update:position', { side: 'left', position });
  syncTo('left', page);
}
function onRightPage(page: number): void {
  if (props.right === undefined) return;
  const position = props.right.getPosition();
  if (position !== undefined) emit('update:position', { side: 'right', position });
  syncTo('right', page);
}

/** 位置变化（scroll-flow 模式由 BtBookView 抛出）：同步 + 直接透传 */
function onLeftPosition(position: ReadingPosition): void {
  emit('update:position', { side: 'left', position });
  syncTo('left', position.pageIndex);
}
function onRightPosition(position: ReadingPosition): void {
  emit('update:position', { side: 'right', position });
  syncTo('right', position.pageIndex);
}

function onLeftFallback(payload: { requested: string; effective: string; reason: string }): void {
  emit('mode-fallback', { side: 'left', ...payload });
}
function onRightFallback(payload: { requested: string; effective: string; reason: string }): void {
  emit('mode-fallback', { side: 'right', ...payload });
}
</script>

<template>
  <!-- 单文档：对页阅读 -->
  <BtBookView
    v-if="isSingle"
    ref="leftRef"
    :reader="left"
    spread="facing"
    v-bind="sharedProps"
    :initial-position="initialPosition"
    @update:page="onLeftPage"
    @update:position="onLeftPosition"
    @mode-fallback="onLeftFallback"
  />

  <!-- 双文档：左右并排 -->
  <BtSpreadLayout
    v-else
    mode="columns"
    :left-label="labels.left"
    :right-label="labels.right"
  >
    <template #left>
      <BtBookView
        ref="leftRef"
        :reader="left"
        v-bind="sharedProps"
        @update:page="onLeftPage"
        @update:position="onLeftPosition"
        @mode-fallback="onLeftFallback"
      />
    </template>
    <template #right>
      <BtBookView
        ref="rightRef"
        :reader="right"
        v-bind="sharedProps"
        @update:page="onRightPage"
        @update:position="onRightPosition"
        @mode-fallback="onRightFallback"
      />
    </template>
  </BtSpreadLayout>
</template>
