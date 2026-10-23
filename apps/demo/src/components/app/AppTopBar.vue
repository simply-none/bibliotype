<script setup lang="ts">
/**
 * 桌面顶栏 + H5 顶栏（Demo 层，应用栏）
 *
 * 桌面：书名 chip（点击开书籍信息）+ 保存状态；右侧主题 / 编辑 / 书库 / 设置 /
 * tab 面板 / 导出等全局动作，单行横向溢出时滚轮转横向、按住可拖动（useToolbarScroll）。
 * H5：只留书名 + 保存状态 +「更多」，全局动作收进菜单 sheet（MobileMoreSheet）。
 *
 * 直排（.app--rail）时本栏作为 grid 第一列、并把书名列 / 按钮列转成两条竖列；
 * 这些转置规则仍以 `.app--rail` 前缀留在 App.vue 的 app-vertical-rail.css：本栏根元素
 * 带父级 scope id 命中根规则，内部元素的转置经 :deep() 命中（拆分不改样式行为）。
 * 工具栏滚动 / 拖动是本栏自身关注点，useToolbarScroll 的清理挂到本组件卸载钩子。
 */
import { onBeforeUnmount } from 'vue';
import AppIcon from '../AppIcon.vue';
import ToolbarUsageTip from '../ToolbarUsageTip.vue';
import type { ToolbarUsage } from '../toolbar-usage.js';
import { THEME_ENTRIES, type ThemeKey } from '../../composables/use-app-themes.js';
import { ASIDE_TABS, type AsideTab } from '../../composables/use-aside-tabs.js';
import { useToolbarScroll } from '../../composables/use-toolbar-scroll.js';

/** 「编辑 / 保存并预览」按钮的悬浮说明 */
const MODE_USAGE: ToolbarUsage = {
  use: '进入编辑模式（分页画布编辑）；再点「保存并预览」回阅读态',
  where: '编辑内容自动存入本地草稿；保存并预览会先落盘再刷新阅读视图',
  key: 'Ctrl/Cmd+S 立即保存',
  limit: '编辑态 ← / → 交给编辑器移动光标，不翻页',
};

/* 工具栏鼠标交互（横向滚动 + 按住拖动）：容器 ref 与事件都只服务本栏 */
const {
  toolbarActionsRef,
  onToolbarWheel,
  onToolbarPointerDown,
  onToolbarClickCapture,
  removeToolbarDragListeners,
} = useToolbarScroll();
onBeforeUnmount(removeToolbarDragListeners);

/** 书籍信息弹窗开合（同一 infoOpen ref） */
const infoOpen = defineModel<boolean>('infoOpen', { required: true });
/** 书库抽屉开合（同一 libraryOpen ref） */
const libraryOpen = defineModel<boolean>('libraryOpen', { required: true });
/** 设置弹窗开合（同一 settingsOpen ref） */
const settingsOpen = defineModel<boolean>('settingsOpen', { required: true });
/** PDF 逐页 / 连续导出模式（同一 pdfPagedMode ref） */
const pdfPagedMode = defineModel<boolean>('pdfPagedMode', { required: true });
/** H5「更多」菜单 sheet 开合（同一 mobileMenuOpen ref） */
const mobileMenuOpen = defineModel<boolean>('mobileMenuOpen', { required: true });

defineProps<{
  /** 是否 H5 单列骨架（决定桌面动作区 / H5 更多按钮） */
  mobileShell: boolean;
  /** 阅读 / 编辑模式 */
  mode: 'read' | 'edit';
  /** 书名（书籍信息入口文案） */
  bookTitle: string;
  /** 是否有未保存改动 */
  dirty: boolean;
  /** 保存是否失败 */
  saveFailed: boolean;
  /** 保存状态文案 */
  saveStatusText: string;
  /** 当前主题 key */
  themeKey: ThemeKey;
  /** 当前左栏 tab（高亮对应面板入口） */
  activeTab: AsideTab | null;
  /** PDF 是否正在导出 */
  pdfExporting: boolean;
  /** 应用内直出逐页进度（null = 非光栅路径；展示「导出中 N/M」） */
  pdfProgress?: { done: number; total: number } | null;
  /** 切换主题 */
  switchTheme: (key: ThemeKey) => void;
  /** 编辑 ↔ 保存并预览切换 */
  toggleEditMode: () => void;
  /** 切换左栏 tab 面板 */
  toggleTab: (tab: AsideTab) => void;
  /** 导出 EPUB */
  onExportEpub: () => void;
  /** 导出 PDF */
  onExportPdf: () => void;
}>();
</script>

<template>
  <header class="toolbar">
    <div class="toolbar__title">
      <button
        type="button"
        class="toolbar__book"
        title="查看书籍信息"
        @click="infoOpen = true"
      >
        <AppIcon class="toolbar__book-icon" name="book" :size="17" :stroke-width="1.6" />
        <strong>{{ bookTitle }}</strong>
      </button>
      <span
        v-if="mode === 'edit'"
        class="toolbar__dirty"
        :class="{ 'toolbar__dirty--on': dirty || saveFailed }"
      >
        {{ saveStatusText }}
      </span>
    </div>
    <div
      v-if="!mobileShell"
      ref="toolbarActionsRef"
      class="toolbar__actions"
      @wheel="onToolbarWheel"
      @pointerdown="onToolbarPointerDown"
      @click.capture="onToolbarClickCapture"
    >
      <div class="toolbar__group">
        <button
          v-for="entry in THEME_ENTRIES"
          :key="entry.key"
          type="button"
          class="toolbar__button"
          :class="{ 'toolbar__button--active': themeKey === entry.key }"
          @click="switchTheme(entry.key)"
        >
          {{ entry.config.label }}
        </button>
      </div>
      <div class="toolbar__group">
        <ToolbarUsageTip :usage="MODE_USAGE">
          <button
            type="button"
            class="toolbar__button"
            :class="{ 'toolbar__button--active': mode === 'edit' }"
            @click="toggleEditMode"
          >
            {{ mode === 'edit' ? '保存并预览' : '编辑' }}
          </button>
        </ToolbarUsageTip>
        <button
          type="button"
          class="toolbar__button"
          :class="{ 'toolbar__button--active': libraryOpen }"
          @click="libraryOpen = !libraryOpen"
        >
          书库
        </button>
        <button
          type="button"
          class="toolbar__button"
          :class="{ 'toolbar__button--active': settingsOpen }"
          @click="settingsOpen = !settingsOpen"
        >
          设置
        </button>
      </div>
      <div class="toolbar__group">
        <button
          v-for="tab in ASIDE_TABS"
          v-show="tab.key !== 'suggestions' || mode === 'edit'"
          :key="tab.key"
          type="button"
          class="toolbar__button"
          :class="{ 'toolbar__button--active': activeTab === tab.key }"
          @click="toggleTab(tab.key)"
        >
          {{ tab.label }}
        </button>
      </div>
      <div class="toolbar__group">
        <button type="button" class="toolbar__button" @click="onExportEpub">导出 EPUB</button>
        <button
          type="button"
          class="toolbar__button"
          :class="{ 'toolbar__button--active': pdfExporting }"
          :title="pdfExporting ? '正在导出，再次点击中止' : '导出 PDF'"
          @click="onExportPdf"
        >
          {{
            pdfExporting
              ? pdfProgress
                ? `导出中 ${pdfProgress.done}/${pdfProgress.total}（点击中止）`
                : '导出中…'
              : '导出 PDF'
          }}
        </button>
        <button
          type="button"
          class="toolbar__button"
          :class="{ 'toolbar__button--active': pdfPagedMode }"
          title="逐页：与屏幕预览逐页同源（较慢）；连续：打印引擎自动分页（较快）"
          @click="pdfPagedMode = !pdfPagedMode"
        >
          {{ pdfPagedMode ? '逐页' : '连续' }}
        </button>
      </div>
    </div>

    <!-- H5（A1 / P1）：顶栏只留书名 + 保存状态 + 「更多」，全局动作收进菜单 sheet -->
    <div v-else class="toolbar__mobile">
      <span
        v-if="mode === 'edit'"
        class="toolbar__dirty"
        :class="{ 'toolbar__dirty--on': dirty || saveFailed }"
      >
        {{ saveStatusText }}
      </span>
      <button
        type="button"
        class="toolbar__button toolbar__button--menu"
        aria-label="更多"
        :aria-expanded="mobileMenuOpen"
        @click="mobileMenuOpen = !mobileMenuOpen"
      >
        <AppIcon name="more" :size="20" />
        <span class="toolbar__button-label">更多</span>
      </button>
    </div>
  </header>
</template>

<style scoped>
.toolbar {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: var(--ui-space-3);
  min-height: var(--ui-bar-h);
  padding: var(--ui-space-2) var(--ui-space-5);
  border-block-end: var(--ui-border-width, 1px) solid var(--ui-border);
  /*
   * 应用栏常驻（P1）：半透明 + 模糊让正文滚到栏下时不硬碰；
   * 先写实色再写 color-mix，不支持 color-mix 的内核直接拿实色，不会透成空栏。
   */
  position: sticky;
  top: 0;
  z-index: var(--ui-z-bar);
  background: var(--ui-surface);
  background: color-mix(in srgb, var(--ui-surface) 92%, transparent);
  backdrop-filter: blur(12px) saturate(1.2);
  -webkit-backdrop-filter: blur(12px) saturate(1.2);
  color: var(--ui-text);
}

.toolbar__title {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--ui-space-3);
}

/* 书名 chip：点击开书籍信息（主流阅读器把元数据入口挂在书名上） */
.toolbar__book {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 4px 10px;
  font: inherit;
  color: inherit;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--ui-radius-sm);
  cursor: pointer;
}

.toolbar__book:hover {
  background: var(--ui-surface-sunken);
  border-color: var(--ui-border);
}

.toolbar__book:active {
  background: var(--ui-accent-weak);
  border-color: var(--ui-accent);
}

.toolbar__book strong {
  font-size: var(--ui-font-lg);
  font-weight: 600;
  letter-spacing: 0.08em;
}

.toolbar__book-icon {
  color: var(--ui-text-muted);
}

.toolbar__dirty {
  font-size: var(--ui-font-sm);
  color: var(--ui-text-muted);
}

/* 未保存 / 保存失败：前置小圆点，比整段变红更早进入视线 */
.toolbar__dirty--on {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--ui-danger);
}

.toolbar__dirty--on::before {
  width: 6px;
  height: 6px;
  background: var(--ui-danger);
  border-radius: 50%;
  content: '';
}

/* H5 顶栏右侧：「保存状态 + 更多」（面板内容进抽屉，全局动作进菜单 sheet） */
.toolbar__mobile {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--ui-space-2);
}

/* 「更多」图标按钮：图形承担识别、文本承担可访问名（e2e 与读屏都靠这个名字） */
.toolbar__button--menu {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: var(--bt-touch-target, 44px);
  min-height: var(--bt-touch-target, 44px);
  padding: 0;
  gap: 0;
}

/* 只给读屏与自动化留名字，视觉上不占位 */
.toolbar__button-label {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

.toolbar__actions {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-wrap: nowrap;
  justify-content: flex-start;
  gap: 6px 14px;
  overflow-x: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--demo-control-border) transparent;
}

/* 单行不换行：未溢出时由首组自动外边距把整排推到右端；溢出时外边距归零，从行首可滚动 */
.toolbar__actions > .toolbar__group:first-child {
  margin-inline-start: auto;
}

/* 鼠标可拖的细横向滚动条（WebKit/Blink），随演示配色令牌换色 */
.toolbar__actions::-webkit-scrollbar {
  height: 6px;
}

.toolbar__actions::-webkit-scrollbar-track {
  background: transparent;
}

.toolbar__actions::-webkit-scrollbar-thumb {
  background: var(--demo-control-border);
  border-radius: 3px;
}

.toolbar__actions::-webkit-scrollbar-thumb:hover {
  background: var(--demo-accent);
}

/* 拖动中：抓取光标 + 禁止选中文本（结束拖动后移除） */
.toolbar__actions--dragging,
.toolbar__actions--dragging .toolbar__button {
  cursor: grabbing;
  user-select: none;
}

.toolbar__group {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--ui-space-2);
  white-space: nowrap;
}

/* 组间分隔线（Word / Chrome 工具栏惯例，替代纯间距） */
.toolbar__group + .toolbar__group {
  padding-inline-start: var(--ui-space-4);
  border-inline-start: 1px solid var(--ui-divider);
}

.toolbar__button {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 5px 11px;
  font-size: var(--ui-font-md);
  white-space: nowrap;
  color: var(--ui-text);
  background: var(--ui-surface-raised);
  border: var(--ui-border-width, 1px) solid var(--ui-border);
  border-radius: var(--ui-radius-sm);
  box-shadow: var(--ui-shadow-1);
  cursor: pointer;
}

.toolbar__button:hover:not(:disabled) {
  background: var(--ui-surface-sunken);
  border-color: var(--ui-accent);
  color: var(--ui-accent);
}

.toolbar__button:disabled {
  opacity: 0.45;
  cursor: default;
}

.toolbar__button--active {
  color: var(--ui-on-accent);
  background: var(--ui-accent);
  border-color: var(--ui-accent);
}

.toolbar__button--active:hover:not(:disabled) {
  color: var(--ui-on-accent);
  background: var(--ui-accent-strong);
}
</style>
