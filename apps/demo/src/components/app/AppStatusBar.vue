<script setup lang="ts">
/**
 * 底部状态栏（Demo 层，A6 / P1）
 *
 * 阅读态桌面 = 进度 + 翻页 + 视图切换 + 对照；编辑态桌面 = 页码 + 缩放；
 * H5 = 通栏进度细线 + 翻页（或页码）+ 四个高频入口（目录 / 搜索 / 属性或设置 / 编辑），
 * 重复的「更多」只留在顶栏，底栏不再摆第二个入口。
 *
 * 直排（.app--rail）时本栏作为 grid 第五列紧贴书页左侧、横排时作为最底一行；
 * 转置样式仍由 App.vue 的 app-vertical-rail.css 以 `.app--rail` 前缀驱动（根元素带父级
 * scope id 命中；本组件内部元素的转置规则在下方 scoped 块内以祖先选择器命中）。
 * 挂载条件 booted 由父级 v-if 决定；compareOpen / settingsOpen / editorScale 写回的都是
 * App 持有的同一批源 ref（视图模式、对照、缩放语义与持久化不受拆分影响）。
 */
import { BtPager, BtDocumentStats, type EditorBinding } from '@bibliotype/vue';
import type { Reader } from '@bibliotype/reader';
import type { DocumentStats } from '@bibliotype/core';
import type { AsideTab } from '../../composables/use-aside-tabs.js';
import ProgressBar from '../ProgressBar.vue';
import AppIcon from '../AppIcon.vue';
import ToolbarUsageTip from '../ToolbarUsageTip.vue';
import type { ToolbarUsage } from '../toolbar-usage.js';

/** 「单页翻页 / 滚动翻页」按钮的悬浮说明 */
const VIEW_MODE_USAGE: ToolbarUsage = {
  use: '在「单页翻页」与「连续滚动多页」之间切换',
  where: '阅读态用 ← / → 翻页；连续模式也可用滚轮上下浏览',
};

/** 双页对照（D5）悬浮说明 */
const COMPARE_USAGE: ToolbarUsage = {
  use: '打开双页对照视图：当前文档左右对页阅读（同书对照）；可接入两份文稿做底本 / 校本比对',
  where: '对照视图由 BtSpreadLayout 承载，中缝分隔、标签固定',
};

/** 设置弹窗开合（同一 settingsOpen ref） */
const settingsOpen = defineModel<boolean>('settingsOpen', { required: true });
/** 双页对照开关（同一 compareOpen ref） */
const compareOpen = defineModel<boolean>('compareOpen', { required: true });
/** 编辑态缩放比例（同一 editorScale ref） */
const editorScale = defineModel<number>('editorScale', { required: true });

defineProps<{
  /** 是否 H5 单列骨架 */
  mobileShell: boolean;
  /** 阅读 / 编辑模式 */
  mode: 'read' | 'edit';
  /** 当前主题 key（连同 readerEpoch 组成翻页器重挂 key） */
  themeKey: string;
  /** Reader 重建轮次 */
  readerEpoch: number;
  /** 当前 Reader 实例 */
  reader: Reader;
  /** 编辑器当前可见页（编辑态页码读数） */
  editorVisiblePage: number;
  /** H5 左抽屉是否打开（目录 / 搜索入口 aria-expanded） */
  mobileAsideOpen: boolean;
  /** H5 属性 sheet 是否打开 */
  mobileInspectorOpen: boolean;
  /** 文档统计（桌面阅读态展示） */
  stats: DocumentStats;
  /** 编辑器绑定（编辑态属性入口仅在有绑定时出现） */
  inspectorBinding: EditorBinding | null;
  /** 阅读形态 */
  viewMode: 'page' | 'scroll' | 'scroll-flow';
  /** 当前版式是否支持流式 */
  flowSupported: boolean;
  /** 阅读形态按钮文案 */
  viewModeLabel: string;
  /** 是否直排（缩放「适应高度 / 适应宽度」文案） */
  railLayout: boolean;
  /** 打开 H5 左抽屉某面板 */
  openMobileTab: (tab: AsideTab) => void;
  /** 打开 H5 属性 sheet */
  openMobileInspector: () => void;
  /** 编辑 ↔ 保存并预览切换 */
  toggleEditMode: () => void;
  /** 循环阅读形态 */
  cycleViewMode: () => void;
  /** 编辑态缩放步进 */
  zoomStep: (delta: number) => void;
  /** 缩放整页适应宽度 / 高度 */
  fitEditorWidth: () => void;
}>();
</script>

<template>
  <footer class="statusbar" :class="{ 'statusbar--mobile': mobileShell }">
    <template v-if="mobileShell">
      <ProgressBar
        v-if="mode === 'read'"
        :key="`${themeKey}-${readerEpoch}`"
        class="statusbar__line"
        :reader="reader"
      />
      <div class="statusbar__mobile-row">
        <BtPager
          v-if="mode === 'read'"
          :key="`${themeKey}-${readerEpoch}`"
          class="statusbar__pager"
          :reader="reader"
        />
        <span v-else class="statusbar__readout">第 {{ editorVisiblePage + 1 }} 页</span>
        <span class="statusbar__spacer" />
        <button
          type="button"
          class="statusbar__icon"
          aria-label="目录"
          :aria-expanded="mobileAsideOpen"
          @click="openMobileTab('toc')"
        >
          <AppIcon name="toc" />
        </button>
        <button
          type="button"
          class="statusbar__icon"
          aria-label="搜索"
          :aria-expanded="mobileAsideOpen"
          @click="openMobileTab('search')"
        >
          <AppIcon name="search" />
        </button>
        <button
          v-if="mode === 'edit' && inspectorBinding"
          type="button"
          class="statusbar__icon"
          aria-label="属性"
          :aria-expanded="mobileInspectorOpen"
          @click="openMobileInspector"
        >
          <AppIcon name="grid" />
        </button>
        <button
          v-if="mode === 'read'"
          type="button"
          class="statusbar__icon"
          aria-label="设置"
          :aria-expanded="settingsOpen"
          @click="settingsOpen = true"
        >
          <AppIcon name="settings" />
        </button>
        <button
          type="button"
          class="statusbar__icon"
          :aria-label="mode === 'edit' ? '保存并预览' : '编辑'"
          @click="toggleEditMode"
        >
          <AppIcon name="edit" />
        </button>
      </div>
    </template>
    <template v-else-if="mode === 'read'">
      <div class="statusbar__cluster">
        <ProgressBar :key="`${themeKey}-${readerEpoch}`" class="statusbar__progress" :reader="reader" />
        <BtPager :key="`${themeKey}-${readerEpoch}`" class="statusbar__pager" :reader="reader" />
        <BtDocumentStats class="statusbar__stats" :stats="stats" :compact="true" />
      </div>
      <div class="statusbar__cluster">
        <ToolbarUsageTip :usage="VIEW_MODE_USAGE">
          <button
            type="button"
            class="statusbar__button"
            :class="{ 'statusbar__button--on': viewMode !== 'page' }"
            :disabled="!flowSupported && viewMode === 'page'"
            :title="flowSupported ? '切换阅读形态：单页 / 连续滚动 / 流式' : '当前版式（直排 / 仿真）不支持流式阅读'"
            @click="cycleViewMode"
          >
            {{ viewModeLabel }}
          </button>
        </ToolbarUsageTip>
        <ToolbarUsageTip :usage="COMPARE_USAGE">
          <button
            type="button"
            class="statusbar__button"
            :class="{ 'statusbar__button--on': compareOpen }"
            @click="compareOpen = !compareOpen"
          >
            双页对照
          </button>
        </ToolbarUsageTip>
      </div>
    </template>
    <template v-else>
      <span class="statusbar__readout">第 {{ editorVisiblePage + 1 }} 页</span>
      <span class="statusbar__spacer" />
      <div class="statusbar__cluster">
        <button type="button" class="statusbar__button" title="缩小" @click="zoomStep(-0.1)">
          −
        </button>
        <span class="statusbar__zoom">{{ Math.round(editorScale * 100) }}%</span>
        <button type="button" class="statusbar__button" title="放大" @click="zoomStep(0.1)">
          +
        </button>
        <button type="button" class="statusbar__button" title="恢复 100%" @click="editorScale = 1">
          100%
        </button>
        <button
          type="button"
          class="statusbar__button"
          :title="railLayout ? '按高度缩放整页' : '按宽度缩放整页'"
          @click="fitEditorWidth"
        >
          {{ railLayout ? '适应高度' : '适应宽度' }}
        </button>
      </div>
    </template>
  </footer>
</template>

<style scoped>
.statusbar {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--ui-space-4);
  padding: var(--ui-space-1) var(--ui-space-5);
  border-block-start: var(--ui-border-width, 1px) solid var(--ui-border);
  background: var(--ui-surface);
  color: var(--ui-text);
  font-size: var(--ui-font-sm);
}

/* H5 底栏（P1）：通栏进度细线在上，下面才是操作行 */
.statusbar--mobile {
  flex-direction: column;
  align-items: stretch;
  gap: 0;
  padding: 0;
}

.statusbar__line {
  flex: none;
  width: 100%;
  min-width: 0;
}

.statusbar__line :deep(.progress__text) {
  display: none;
}

.statusbar__line :deep(.progress__track),
.statusbar__line :deep(.progress__fill) {
  border-radius: 0;
}

.statusbar__line :deep(.progress__track) {
  block-size: 2px;
  /* 只能写 background-color：`background` 简写会把触屏补偿用的
     `background-clip: content-box` 重置回 border-box，细线变成 40px 高的色带 */
  background-color: var(--ui-divider);
}

.statusbar__mobile-row {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--ui-space-1);
  min-height: var(--ui-bar-h-mobile);
  padding: var(--ui-space-1) var(--ui-space-2);
}

/* 底栏图标按钮：只靠 44px 触控目标与强调色底做选中态 */
.statusbar__icon {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--bt-touch-target, 44px);
  height: var(--bt-touch-target, 44px);
  padding: 0;
  color: var(--ui-text);
  background: transparent;
  border: 0;
  border-radius: var(--ui-radius-sm);
  cursor: pointer;
}

.statusbar__icon:hover,
.statusbar__icon:active {
  color: var(--ui-accent);
  background: var(--ui-accent-weak);
}

.statusbar__progress {
  flex: 1;
  min-width: 120px;
}

/* 桌面：进度条与翻页读数二选一（状态栏已有页码）；H5 底栏只剩翻页器，读数必须留 */
.statusbar:not(.statusbar--mobile) .statusbar__pager :deep(.bt-pager__status) {
  display: none;
}

/*
 * H5 底栏：翻页改纯图标
 *
 * 三字按钮在 375px 上会把整行挤到换行（行高溢出、按钮顶出底栏），
 * 所以文案隐去、只画箭头；可访问名由 `BtPager` 自带的
 * `aria-label="上一页 / 下一页"` 承担（e2e 按名点击不受影响）。
 */
.statusbar--mobile .statusbar__pager :deep(.bt-pager) {
  gap: 0;
}

.statusbar--mobile .statusbar__pager :deep(.bt-pager__button) {
  display: grid;
  flex: none;
  place-items: center;
  width: var(--bt-touch-target, 44px);
  height: var(--bt-touch-target, 44px);
  padding: 0;
  border: 0;
  border-radius: var(--ui-radius-sm);
  color: var(--ui-text);
  font-size: 0; /* 文案让位给图标 */
  cursor: pointer;
}

.statusbar--mobile .statusbar__pager :deep(.bt-pager__button)::before {
  font-size: var(--ui-font-2xl);
  line-height: 1;
}

.statusbar--mobile .statusbar__pager :deep(.bt-pager__button:first-child)::before {
  content: '\2039';
}

.statusbar--mobile .statusbar__pager :deep(.bt-pager__button:last-child)::before {
  content: '\203A';
}

.statusbar--mobile .statusbar__pager :deep(.bt-pager__button:hover),
.statusbar--mobile .statusbar__pager :deep(.bt-pager__button:active) {
  color: var(--ui-accent);
  background: var(--ui-accent-weak);
}

.statusbar--mobile .statusbar__pager :deep(.bt-pager__button:disabled) {
  color: var(--ui-text-muted);
  opacity: 0.5;
}

.statusbar--mobile .statusbar__pager :deep(.bt-pager__status) {
  min-width: 0;
  color: var(--ui-text-muted);
  font-size: var(--ui-font-md);
  font-variant-numeric: tabular-nums;
  /* 不折行：读数换行会把 52px 的底栏顶高，整行错位 */
  white-space: nowrap;
}

.statusbar__spacer {
  flex: 1;
}

/* 页码读数：等宽数字，翻页时不左右抖（P3 状态栏制式） */
.statusbar__readout {
  flex: none;
  color: var(--ui-text-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.statusbar__zoom {
  flex: none;
  min-width: 40px;
  text-align: center;
  color: var(--ui-text-muted);
  font-variant-numeric: tabular-nums;
}

/* 缩放 / 视图控件分组：平时 contents 对父级 flex 完全透明，直排时才成换行子盒 */
.statusbar__cluster {
  display: contents;
}

.statusbar__button {
  flex: none;
  padding: 2px 10px;
  font-size: var(--ui-font-sm);
  color: var(--ui-text);
  background: transparent;
  border: var(--ui-border-width, 1px) solid var(--ui-border);
  border-radius: var(--ui-radius-sm);
  cursor: pointer;
}

.statusbar__button:hover {
  border-color: var(--ui-accent);
  color: var(--ui-accent);
}

.statusbar__button--on {
  color: var(--ui-accent);
  border-color: var(--ui-accent);
  background: var(--ui-accent-weak);
}
</style>
