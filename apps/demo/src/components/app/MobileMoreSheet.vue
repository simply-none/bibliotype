<script setup lang="ts">
/**
 * H5「更多」菜单 sheet（Demo 层）
 *
 * H5 顶栏只留书名与保存状态，全局动作（面板 / 编辑 / 书库 / 设置 / 书籍信息 /
 * 主题 / 皮肤 / 导出 / 阅读形态 / 对照 / 夜读 / 缩放）收进这一张底部可拖拽 sheet。
 * 挂载条件（mobileShell）由父级 App.vue 决定；跨块状态经分组 props / v-model 传入，
 * 写回的都是 App 持有的同一批源 ref（切换夜间 / 折叠属性等落盘监听照常在父级触发）。
 */
import { BtDrawer } from '@bibliotype/vue';
import AppIcon from '../AppIcon.vue';
import { ASIDE_TABS, type AsideTab } from '../../composables/use-aside-tabs.js';
import { THEME_ENTRIES, type ThemeKey } from '../../composables/use-app-themes.js';
import { UI_SKINS, type UiSkinKey } from '../../ui-skin.js';
import { MOBILE_MENU_SNAPS } from '../../composables/use-mobile-shell.js';

/** 抽屉开合（父级 v-model:open 绑定 mobileMenuOpen） */
const open = defineModel<boolean>('open', { required: true });
/** 夜读纸色（同一 night ref） */
const night = defineModel<boolean>('night', { required: true });
/** 书库抽屉开合 */
const libraryOpen = defineModel<boolean>('libraryOpen', { required: true });
/** 设置弹窗开合 */
const settingsOpen = defineModel<boolean>('settingsOpen', { required: true });
/** 书籍信息弹窗开合 */
const infoOpen = defineModel<boolean>('infoOpen', { required: true });
/** PDF 逐页 / 连续导出模式 */
const pdfPagedMode = defineModel<boolean>('pdfPagedMode', { required: true });
/** 双页对照开关 */
const compareOpen = defineModel<boolean>('compareOpen', { required: true });
/** 编辑态缩放比例 */
const editorScale = defineModel<number>('editorScale', { required: true });

defineProps<{
  /** 阅读 / 编辑模式 */
  mode: 'read' | 'edit';
  /** 当前左栏 tab（高亮对应面板入口） */
  activeTab: AsideTab | null;
  /** 当前主题 key */
  themeKey: ThemeKey;
  /** 当前界面皮肤 key */
  uiSkin: UiSkinKey;
  /** PDF 是否正在导出 */
  pdfExporting: boolean;
  /** 阅读形态 */
  viewMode: 'page' | 'scroll' | 'scroll-flow';
  /** 当前版式是否支持流式阅读 */
  flowSupported: boolean;
  /** 阅读形态按钮文案 */
  viewModeLabel: string;
  /** 是否直排版面（缩放「适应高度 / 适应宽度」文案） */
  railLayout: boolean;
  /** 打开 H5 左抽屉某面板 */
  openMobileTab: (tab: AsideTab) => void;
  /** 编辑 ↔ 保存并预览切换 */
  toggleEditMode: () => void;
  /** 执行一个动作并收起菜单 sheet */
  onMobileAction: (action: () => void) => void;
  /** 切换主题 */
  switchTheme: (key: ThemeKey) => void;
  /** 切换界面皮肤 */
  setUiSkin: (key: UiSkinKey) => void;
  /** 导出 EPUB */
  onExportEpub: () => void;
  /** 导出 PDF */
  onExportPdf: () => void;
  /** 循环阅读形态 */
  cycleViewMode: () => void;
  /** 编辑态缩放步进 */
  zoomStep: (delta: number) => void;
  /** 缩放整页适应宽度 / 高度 */
  fitEditorWidth: () => void;
}>();
</script>

<template>
  <!-- H5（A1 / A6）：更多菜单 sheet——全局动作与底栏次要控件 -->
  <BtDrawer
    v-model:open="open"
    side="bottom"
    title="更多"
    :snap-heights="MOBILE_MENU_SNAPS"
  >
    <div class="app__menu">
      <section class="app__menu-group">
        <h3 class="app__menu-title">面板</h3>
        <div class="app__menu-grid">
          <button
            v-for="tab in ASIDE_TABS"
            v-show="tab.key !== 'suggestions' || mode === 'edit'"
            :key="tab.key"
            type="button"
            class="app__menu-button"
            :class="{ 'app__menu-button--active': activeTab === tab.key }"
            @click="openMobileTab(tab.key)"
          >
            <AppIcon class="app__menu-icon" :name="tab.icon" :size="18" :stroke-width="1.7" />
            <span class="app__menu-label">{{ tab.label }}</span>
            <AppIcon
              class="app__menu-trail"
              :name="activeTab === tab.key ? 'check' : 'chevron-right'"
              :size="16"
              :stroke-width="1.7"
            />
          </button>
        </div>
      </section>

      <section class="app__menu-group">
        <h3 class="app__menu-title">动作</h3>
        <div class="app__menu-grid">
          <button
            type="button"
            class="app__menu-button"
            :class="{ 'app__menu-button--active': mode === 'edit' }"
            @click="onMobileAction(toggleEditMode)"
          >
            <AppIcon class="app__menu-icon" name="edit" :size="18" :stroke-width="1.7" />
            <span class="app__menu-label">{{ mode === 'edit' ? '保存并预览' : '编辑' }}</span>
            <AppIcon class="app__menu-trail" name="chevron-right" :size="16" :stroke-width="1.7" />
          </button>
          <button
            type="button"
            class="app__menu-button"
            @click="onMobileAction(() => { libraryOpen = true; })"
          >
            <AppIcon class="app__menu-icon" name="library" :size="18" :stroke-width="1.7" />
            <span class="app__menu-label">书库</span>
            <AppIcon class="app__menu-trail" name="chevron-right" :size="16" :stroke-width="1.7" />
          </button>
          <button
            type="button"
            class="app__menu-button"
            @click="onMobileAction(() => { settingsOpen = true; })"
          >
            <AppIcon class="app__menu-icon" name="settings" :size="18" :stroke-width="1.7" />
            <span class="app__menu-label">设置</span>
            <AppIcon class="app__menu-trail" name="chevron-right" :size="16" :stroke-width="1.7" />
          </button>
          <button
            type="button"
            class="app__menu-button"
            @click="onMobileAction(() => { infoOpen = true; })"
          >
            <AppIcon class="app__menu-icon" name="info" :size="18" :stroke-width="1.7" />
            <span class="app__menu-label">书籍信息</span>
            <AppIcon class="app__menu-trail" name="chevron-right" :size="16" :stroke-width="1.7" />
          </button>
        </div>
      </section>

      <section class="app__menu-group">
        <h3 class="app__menu-title">主题</h3>
        <div class="app__menu-grid">
          <button
            v-for="entry in THEME_ENTRIES"
            :key="entry.key"
            type="button"
            class="app__menu-button"
            :class="{ 'app__menu-button--active': themeKey === entry.key }"
            @click="onMobileAction(() => switchTheme(entry.key))"
          >
            <AppIcon class="app__menu-icon" name="book" :size="18" :stroke-width="1.7" />
            <span class="app__menu-label">{{ entry.config.label }}</span>
            <AppIcon
              v-if="themeKey === entry.key"
              class="app__menu-trail"
              name="check"
              :size="16"
              :stroke-width="1.8"
            />
          </button>
        </div>
      </section>

      <!-- 界面皮肤（P4）：H5 里也能一眼换壳，与设置面板「界面外观」同一份状态 -->
      <section class="app__menu-group">
        <h3 class="app__menu-title">界面皮肤</h3>
        <div class="app__menu-grid app__menu-grid--compact">
          <button
            v-for="skin in UI_SKINS"
            :key="skin.key"
            type="button"
            class="app__menu-chip"
            :class="{ 'app__menu-chip--active': uiSkin === skin.key }"
            :aria-pressed="uiSkin === skin.key"
            @click="onMobileAction(() => setUiSkin(skin.key))"
          >
            <span class="app__menu-chip__dot" :style="{ background: skin.preview.accent }" />
            {{ skin.label }}
          </button>
        </div>
      </section>

      <section class="app__menu-group">
        <h3 class="app__menu-title">导出</h3>
        <div class="app__menu-grid">
          <button
            type="button"
            class="app__menu-button"
            @click="onMobileAction(onExportEpub)"
          >
            <AppIcon class="app__menu-icon" name="download" :size="18" :stroke-width="1.7" />
            <span class="app__menu-label">导出 EPUB</span>
          </button>
          <button
            type="button"
            class="app__menu-button"
            :disabled="pdfExporting"
            @click="onMobileAction(onExportPdf)"
          >
            <AppIcon class="app__menu-icon" name="share" :size="18" :stroke-width="1.7" />
            <span class="app__menu-label">{{ pdfExporting ? '导出中…' : '导出 PDF' }}</span>
          </button>
        </div>
        <div class="app__menu-segment" role="group" aria-label="PDF 导出方式">
          <button
            type="button"
            class="app__menu-segment__item"
            :class="{ 'app__menu-segment__item--on': pdfPagedMode }"
            @click="pdfPagedMode = true"
          >
            逐页
          </button>
          <button
            type="button"
            class="app__menu-segment__item"
            :class="{ 'app__menu-segment__item--on': !pdfPagedMode }"
            @click="pdfPagedMode = false"
          >
            连续
          </button>
        </div>
      </section>

      <section v-if="mode === 'read'" class="app__menu-group">
        <h3 class="app__menu-title">阅读</h3>
        <div class="app__menu-grid">
          <button
            type="button"
            class="app__menu-button"
            :class="{ 'app__menu-button--active': viewMode !== 'page' }"
            :disabled="!flowSupported && viewMode === 'page'"
            @click="onMobileAction(cycleViewMode)"
          >
            <AppIcon class="app__menu-icon" name="list" :size="18" :stroke-width="1.7" />
            <span class="app__menu-label">阅读形态</span>
            <span class="app__menu-value">{{ viewModeLabel }}</span>
          </button>
          <button
            type="button"
            class="app__menu-button"
            :class="{ 'app__menu-button--active': compareOpen }"
            @click="onMobileAction(() => { compareOpen = !compareOpen; })"
          >
            <AppIcon class="app__menu-icon" name="compare" :size="18" :stroke-width="1.7" />
            <span class="app__menu-label">双页对照</span>
            <AppIcon
              v-if="compareOpen"
              class="app__menu-trail"
              name="check"
              :size="16"
              :stroke-width="1.8"
            />
          </button>
          <button
            type="button"
            class="app__menu-button"
            :class="{ 'app__menu-button--active': night }"
            @click="onMobileAction(() => { night = !night; })"
          >
            <AppIcon class="app__menu-icon" :name="night ? 'moon' : 'sun'" :size="18" :stroke-width="1.7" />
            <span class="app__menu-label">夜读纸色</span>
            <AppIcon
              v-if="night"
              class="app__menu-trail"
              name="check"
              :size="16"
              :stroke-width="1.8"
            />
          </button>
        </div>
      </section>

      <section v-if="mode === 'edit'" class="app__menu-group">
        <h3 class="app__menu-title">缩放</h3>
        <div class="app__menu-grid app__menu-grid--compact">
          <button type="button" class="app__menu-chip" aria-label="缩小" @click="zoomStep(-0.1)">
            <AppIcon name="minus" :size="18" />
          </button>
          <button type="button" class="app__menu-chip" aria-label="放大" @click="zoomStep(0.1)">
            <AppIcon name="plus" :size="18" />
          </button>
          <button type="button" class="app__menu-chip" aria-label="恢复 100%" @click="editorScale = 1">
            <AppIcon name="refresh" :size="18" />
          </button>
          <button
            type="button"
            class="app__menu-chip"
            :aria-label="railLayout ? '适应高度' : '适应宽度'"
            @click="fitEditorWidth"
          >
            <AppIcon name="fit" :size="18" />
          </button>
        </div>
      </section>
    </div>
  </BtDrawer>
</template>

<style scoped>
.app__menu {
  display: flex;
  flex-direction: column;
  gap: var(--ui-space-4);
  padding: var(--ui-space-3) var(--ui-space-4) calc(var(--ui-space-5) + var(--bt-safe-bottom, 0px));
}

.app__menu-group {
  display: flex;
  flex-direction: column;
  gap: var(--ui-space-2);
}

.app__menu-title {
  margin: 0;
  padding-inline-start: var(--ui-space-1);
  font-size: var(--ui-font-xs);
  font-weight: 600;
  letter-spacing: 0.18em;
  color: var(--ui-text-muted);
}

.app__menu-grid {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--ui-surface-raised);
  border: var(--ui-border-width, 1px) solid var(--ui-border);
  border-radius: var(--ui-radius-md);
  box-shadow: var(--ui-shadow-1);
}

.app__menu-button {
  display: flex;
  align-items: center;
  gap: var(--ui-space-3);
  min-height: var(--ui-row-height);
  padding: var(--ui-space-2) var(--ui-space-4);
  font: inherit;
  font-size: var(--ui-font-lg);
  color: var(--ui-text);
  text-align: start;
  background: transparent;
  border: 0;
  cursor: pointer;
}

/* 行与行之间用细分隔线，不再靠卡片间隙拼网格 */
.app__menu-button + .app__menu-button {
  border-block-start: 1px solid var(--ui-divider);
}

.app__menu-button:hover,
.app__menu-button:active {
  background: var(--ui-surface-sunken);
}

.app__menu-icon {
  color: var(--ui-text-muted);
}

.app__menu-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 行尾：当前值（文字）或下一级（箭头 / 对钩），都靠右对齐 */
.app__menu-value,
.app__menu-trail {
  margin-inline-start: auto;
  color: var(--ui-text-muted);
  font-size: var(--ui-font-md);
}

.app__menu-button--active {
  color: var(--ui-accent);
  background: var(--ui-accent-weak);
}

.app__menu-button--active .app__menu-icon,
.app__menu-button--active .app__menu-value,
.app__menu-button--active .app__menu-trail {
  color: var(--ui-accent);
}

.app__menu-button:disabled {
  opacity: 0.45;
  cursor: default;
}

/* 紧凑行（缩放 / 皮肤）：横向等分小按钮，不卡片化 */
.app__menu-grid--compact {
  flex-direction: row;
  gap: var(--ui-space-2);
  overflow: visible;
  background: transparent;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}

.app__menu-chip {
  display: inline-flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  gap: var(--ui-space-1);
  min-height: var(--bt-touch-target, 44px);
  padding: var(--ui-space-2);
  font-size: var(--ui-font-md);
  color: var(--ui-text);
  background: var(--ui-surface-raised);
  border: var(--ui-border-width, 1px) solid var(--ui-border);
  border-radius: var(--ui-radius-sm);
  box-shadow: var(--ui-shadow-1);
  cursor: pointer;
}

.app__menu-chip--active {
  color: var(--ui-on-accent);
  background: var(--ui-accent);
  border-color: var(--ui-accent);
}

.app__menu-chip__dot {
  width: 10px;
  height: 10px;
  border: 1px solid currentColor;
  border-radius: 50%;
}

/* 二选一的分段控件（PDF 逐页 / 连续） */
.app__menu-segment {
  display: flex;
  gap: 2px;
  padding: 2px;
  background: var(--ui-surface-sunken);
  border-radius: var(--ui-radius-pill);
}

.app__menu-segment__item {
  flex: 1;
  min-height: 36px;
  font-size: var(--ui-font-md);
  color: var(--ui-text-muted);
  background: transparent;
  border: 0;
  border-radius: var(--ui-radius-pill);
  cursor: pointer;
}

.app__menu-segment__item--on {
  color: var(--ui-text-strong);
  background: var(--ui-surface-raised);
  box-shadow: var(--ui-shadow-1);
}
</style>
