<script setup lang="ts">
/**
 * Demo 主界面（App）——参照主流书籍排版编辑器的三层 chrome：
 * - 顶栏（应用栏）：书名 chip（点击开书籍信息）+ 保存状态；右侧为主题切换、
 *   编辑、设置、导出等全局动作（单行横向滚动，溢出时滚轮 / 拖动可滑）；
 * - 左栏（标签面板）：目录 / 搜索 / 书签 / 导入 改为 tab 切换（同屏仅一个，
 *   参照 Apple Books / Calibre），顶栏按钮即 tab 入口，再点收起；
 *   编辑态另有右栏「属性」检视器（纵向 inspector 列，Word 任务窗格式）；
 * - 主区：阅读 = BtBookView（等比缩放自适应）；编辑 = BtEditor（默认插槽只放
 *   二级格式工具条 EditorToolbar，仿 Word 功能区，位于画布上方）；
 * - 底部状态栏（阅读器 / PDF 工具惯例）：阅读态 = 进度条 + 翻页器 + 视图切换；
 *   编辑态 = 页码读数 + 缩放控件；
 * - 设置 / 书籍信息为模态弹窗；导出 EPUB / PDF（逐页·连续切换；Electron 宿主秒级
 *   直出，浏览器降级打印）；
 * - 键盘：← / → 翻页；Esc 关闭书籍信息 / 设置弹窗。
 * - 反馈分层：**事前**「这个按钮怎么用」→ 按钮悬浮卡片（ToolbarUsageTip）；
 *   **事后**「刚才发生了什么」→ 右下角消息条（composables/use-toast）。
 *   顶栏只留书名与保存状态，不再追加会长期滞留、挤占排版的操作提示。
 *
 * 书写方向决定 chrome 摆位：横排 = 顶栏 + 主区（画布上方工具条 + 右栏属性）+ 底栏；
 * 直排（.app--rail）= 把横排的那五行（顶栏 / 工具条三行 / 状态栏）整体旋 90°，
 * 变成五条通高竖列横向并排（列序自左向右 = 横排行序自上而下：顶栏 → 工具条三行 →
 * 状态栏）：排列与文字都竖向，任何一块都不再上下堆叠；属性栏为附加列，紧随状态栏左侧。
 *
 * 版式参数 = 补丁双层：主题预设（基准）+ layoutPatch / tokenPatch（设置面板覆写），
 * 阅读 / 编辑 / 导出共用同一份 effectiveLayout 与 tokens，改一处三端联动；
 * 字号 / 行距变更经双通道联动（tokens 视觉 + repaginate measure 估算），
 * 主题切换重建 Reader 并清空布局补丁（书写方向随主题），字号等个人设置保留；
 * 刷新启动恢复上次会话：内容取 IndexedDB 草稿回写预览，页码取 localStorage 回跳。
 * 编辑自动保存走「节流合并 + 空闲落盘 + 单飞去重」（composables/use-draft-autosave）：
 * 序列化与整本写入都不落在输入帧上；Ctrl/Cmd+S 立即保存，转入后台 / 关闭前兜底落盘。
 *
 * 逻辑按注释分块抽离到 src/composables/（use-app-themes / use-app-skin /
 * use-mobile-shell / use-layout-tokens / use-settings-snapshot / use-reader-session /
 * use-edit-session / use-view-mode / use-editor-zoom / use-export /
 * use-toolbar-scroll / use-suggestions / use-aside-tabs / use-book-meta /
 * use-app-lifecycle），本文件只做组装接线与启动 / 卸载流程；组合式之间经参数
 * 传递依赖（依赖注入），不互相 import 全局单例。
 */
import { nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue';
import { type OutlineItem } from '@bibliotype/reader';
import {
  BtBookView,
  BtCompareView,
  BtDocumentStats,
  BtDrawer,
  BtEditor,
  BtPager,
  BtSidebarResizer,
  disposeMeasureSheet,
} from '@bibliotype/vue';
import AppToast from './components/AppToast.vue';
import AppIcon from './components/AppIcon.vue';
import AsidePanels from './components/AsidePanels.vue';
import BookInfoDialog from './components/BookInfoDialog.vue';
import AttrInspector from './components/AttrInspector.vue';
import EditorToolbar from './components/EditorToolbar.vue';
import ProgressBar from './components/ProgressBar.vue';
import SettingsPanel from './components/SettingsPanel.vue';
import LibraryDrawer from './components/LibraryDrawer.vue';
import MobileInspectorSheet from './components/app/MobileInspectorSheet.vue';
import MobileMoreSheet from './components/app/MobileMoreSheet.vue';
import AppStatusBar from './components/app/AppStatusBar.vue';
import AppTopBar from './components/app/AppTopBar.vue';
import { useToast } from './composables/use-toast.js';
import { useTocPrefs } from './composables/use-toc-prefs.js';
import { installPerfProbe, type PerfProbe } from './composables/use-perf-probe.js';
import { lunyuDocument } from './data/lunyu.js';
import { UI_SKINS } from './ui-skin.js';
import { useAppThemes } from './composables/use-app-themes.js';
import { useAppSkin } from './composables/use-app-skin.js';
import { useMobileShell } from './composables/use-mobile-shell.js';
import { useStageSize } from './composables/use-stage-size.js';
import { useLayoutTokens } from './composables/use-layout-tokens.js';
import { useSettingsSnapshot, bookIdFromTitle } from './composables/use-settings-snapshot.js';
import { useReaderSession } from './composables/use-reader-session.js';
import { useEditSession } from './composables/use-edit-session.js';
import { useViewMode } from './composables/use-view-mode.js';
import { useEditorZoom } from './composables/use-editor-zoom.js';
import { useSuggestions } from './composables/use-suggestions.js';
import { useBookMeta } from './composables/use-book-meta.js';
import { useExport } from './composables/use-export.js';
import { useAsideTabs } from './composables/use-aside-tabs.js';
import { useAppLifecycle } from './composables/use-app-lifecycle.js';

/* ---------------- 组装接线：组合式（创建顺序 = 依赖顺序） ---------------- */

/* 操作后的一次性反馈走右下角消息条：顶栏只承担书名与常驻状态，
   不再追加会长期滞留、挤占排版的状态行。 */
const { items: toasts, push: pushToast, dismiss: dismissToast } = useToast();

/* 主题态（三档主题 + 夜间纸面）；theme 基准直接注入版式块 */
const { themeKey, night, theme: themeBase } = useAppThemes();

/* 界面皮肤 / 密度 / 动效（壳层观感与阅读纸面正交；<html> data-* 同步在块内） */
const { uiSkin, uiDensity, uiMotion, setUiSkin } = useAppSkin({ night });

/* H5 断点与单列骨架开合状态 */
const { breakpoint, mobileShell, mobileAsideOpen, mobileMenuOpen, mobileInspectorOpen } =
  useMobileShell();

/* App 持有的跨块源状态（供界面偏好快照共享，组合式不各自建 ref） */
/** 启动恢复完成（草稿内容 + 页码已回灌）；就绪前视图不渲染，避免样章闪烁 */
const booted = ref(false);
/** 阅读视图模式：单页翻页 / 连续滚动多页 / 流式阅读（D5） */
const viewMode = ref<'page' | 'scroll' | 'scroll-flow'>('page');
/** 翻页动效：slide（默认）/ fade / none */
const pageTransition = ref<'slide' | 'fade' | 'none'>('slide');
/** 编辑态右栏属性检视器是否折叠（收成细条只留展开把手；随界面偏好快照持久化） */
const inspectorCollapsed = ref(false);
/** 阅读位置持久化（D5）：以锚点为主，刷新 / 改字号后回到原句 */
const savedPosition = ref<string | undefined>(undefined);

/* 跨块回调晚绑定：layout 块构造时需要重排调度与界面偏好落盘，
   但其目标分别来自更晚创建的 reader / snapshot 块（破除构造期循环） */
let remeasureBound: () => void = () => undefined;
let snapshotPersistBound: () => void = () => undefined;
function scheduleRemeasureLate(): void {
  remeasureBound();
}
function persistSnapshotLate(): void {
  snapshotPersistBound();
}

/* 舞台实测可用尺寸（开本自适应与编辑画布「适应」的共同量源） */
const { stageEl, stageSize } = useStageSize();

/* 版式补丁与令牌层（样式作用域 / effectiveLayout / tokens / 面板视图） */
const layout = useLayoutTokens({
  theme: themeBase,
  night,
  mobileShell,
  stageSize,
  scheduleRemeasure: scheduleRemeasureLate,
  persistSnapshot: persistSnapshotLate,
});
const {
  currentBookId,
  styleApi,
  layoutPatch,
  features,
  namedStyles,
  editing,
  effectiveLayout,
  facsimilePreset,
  activeFontToken,
  railLayout,
  themePresetTokens,
  themeBaseTokens,
  tokens,
  panelLayout,
  panelTokens,
  fontSizeNum,
  onApplyThemeTokens,
  onFontSizeUpdate,
} = layout;

/* 界面偏好快照与阅读位置持久化（localStorage 三键；读写上面的源 ref） */
const {
  readSettingsSnapshot,
  applySettingsSnapshot,
  persistSettingsSnapshot,
  readLastPage,
  writeLastPage,
  readSavedPosition,
  writeSavedPosition,
} = useSettingsSnapshot({
  themeKey,
  night,
  viewMode,
  pageTransition,
  inspectorCollapsed,
  uiSkin,
  uiDensity,
  uiMotion,
});
snapshotPersistBound = persistSettingsSnapshot;

/**
 * 应用界面偏好（主题 / 夜间 / 视图模式 / 参考线）
 *
 * 改造后版式与功能样式**自动落盘**（`use-style-settings`），不再需要「保存设置」按钮；
 * 分页重算由度量签名变化驱动（见 use-reader-session 的 readerMetricsSignature）。
 */

/**
 * 界面偏好（主题 / 夜间 / 视图模式 / 属性栏折叠）任意变化时自动落盘
 *
 * 仅靠零散的 `persistSettingsSnapshot()` 调用（切换夜间 / 折叠属性栏）会漏掉最常见、
 * 也最影响「下次进来观感」的**主题切换**：`switchTheme` 此前未回调持久化，设置面板
 * 「保存」走的是 `styleApi` 草稿、也不触碰 `themeKey`。漏存会导致下次进来主题回落
 * 默认、横竖排随之归位，整本观感回到初始化。改用 watch 全量兜底，任何路径改了偏好
 * 都即时写回 localStorage，无需调用方逐个补 `persistSettingsSnapshot()`。
 */
watch(
  [themeKey, night, viewMode, pageTransition, inspectorCollapsed, uiSkin, uiDensity, uiMotion],
  persistSettingsSnapshot,
);

/* Reader 会话：实例重建、DOM 实测重排与页态订阅 */
const reader = useReaderSession({
  effectiveLayout: layout.effectiveLayout,
  tokens: layout.tokens,
  activeFontToken: layout.activeFontToken,
  fontSizeNum: layout.fontSizeNum,
  lineHeightNum: layout.lineHeightNum,
  features: layout.features,
  layoutPatch,
  themePresetTokens,
  themeKey,
  writeLastPage,
  writeSavedPosition,
  booted,
});
const {
  reader: readerRef,
  readerEpoch,
  bookVersion,
  currentDocument,
  documentStats,
  measureContext,
  pageMainSize,
  bottomSlack,
  remeasure,
  scheduleRemeasure,
  clearRemeasureTimer,
  createReader,
  attachPageTracking,
  detachPageTracking,
  onReadingPosition,
  switchTheme,
} = reader;
remeasureBound = scheduleRemeasure;

/* 编辑会话：编辑 ↔ 回写预览、脏标记 + 自动保存、启动草稿与文档导入 */
const {
  mode,
  bookEditor,
  btEditorRef,
  libraryOpen,
  editorReadonly,
  editorVisiblePage,
  editStartPage,
  autosave,
  dirty,
  saveFailed,
  saveStatusText,
  saveNow,
  readDraft,
  onLibraryBook,
  resetSample,
  onImported,
  toggleEditMode,
  slotBinding,
  captureSlotBinding,
  inspectorBinding,
  teardown,
} = useEditSession({
  reader: readerRef,
  bookVersion,
  styleApi,
  currentBookId,
  scheduleRemeasure,
  pushToast,
});

/* 视图模式三态循环与流式回落（viewMode 源状态在 App 持有） */
const {
  effectiveViewMode,
  modeFallbackHint,
  flowSupported,
  cycleViewMode,
  viewModeLabel,
  onModeFallback,
} = useViewMode({
  viewMode,
  verticalRail: layout.verticalRail,
  facsimilePreset: layout.facsimilePreset,
});

/* 编辑态缩放（透传 BtEditor.scale） */
const { editorScale, zoomStep, fitEditorWidth } = useEditorZoom({
  railLayout: layout.railLayout,
  effectiveLayout: layout.effectiveLayout,
  stageSize,
});

/* 句读 / 专名建议（K3）：建议落到编辑器事务，单事务、可撤销 */
const {
  suggestionApi,
  suggestionFilter,
  setSuggestionOverride,
  onAcceptSuggestions,
  onRejectSuggestions,
  onCommitSuggestions,
} = useSuggestions({ bookEditor, slotBinding, bookVersion, pushToast });

/* 书名 / 元数据派生与写回 */
const { infoEditable, currentMetadata, bookTitle, onMetadataSave } = useBookMeta({
  mode,
  bookEditor,
  reader: readerRef,
  bookVersion,
});

/* 导出 / 打印（EPUB · PDF）：与屏幕预览同源消费 layout / reader */
const { pdfExporting, pdfPagedMode, compareOpen, onExportEpub, onExportPdf } = useExport({
  layout,
  reader,
  pushToast,
});

/* 左栏 tab / 弹窗开合 / 属性栏折叠（inspectorCollapsed 源状态在 App 持有） */
const {
  activeTab,
  toggleTab,
  openMobileTab,
  openMobileInspector,
  onMobileAction,
  activeTabLabel,
  settingsOpen,
  infoOpen,
  closeSettings,
  toggleInspector,
  asideVisible,
} = useAsideTabs({
  styleApi,
  mobileAsideOpen,
  mobileMenuOpen,
  mobileInspectorOpen,
  inspectorCollapsed,
  persistSettingsSnapshot,
});

/* 全局键盘 / 可见性 / 卸载守卫（监听注册 / 清理在本文件的挂载钩子） */
const {
  onKeydown,
  onVisibilityChange,
  onPageHide,
  onPageShow,
  onWindowBlur,
  onBeforeUnload,
} = useAppLifecycle({
  mode,
  infoOpen,
  settingsOpen,
  reader: readerRef,
  saveNow,
  closeSettings,
  autosave,
  dirty,
  scheduleRemeasure,
});


/* 目录面板偏好（展开集合 / 侧栏宽度）：库内不写存储，宿主落到 localStorage */
const {
  width: tocWidth,
  expandedKeys: tocExpandedKeys,
  setExpandedKeys: setTocExpandedKeys,
  resetWidth: resetTocWidth,
} = useTocPrefs();

/**
 * 目录点击：阅读态经 BtToc 内置的 reader.goToNode 跳页（Reader 即当前可见视图）；
 * 编辑态主区是 BtEditor（Reader 隐藏），需把目录项导向编辑器——否则点目录「无反应」。
 * 节点存在才跳转（nodeId 为 undefined 时跳过）。
 */
function onTocSelect(item: OutlineItem): void {
  if (mode.value === 'edit' && btEditorRef.value !== null) {
    btEditorRef.value.goToNode(item.nodeId ?? '');
  }
  // H5（A4）：抽屉里点完条目就收起，把整屏还给正文
  if (mobileAsideOpen.value) mobileAsideOpen.value = false;
}


/** 启动恢复：设置快照 + 草稿内容回灌并刷新书本 + 回跳上次阅读页；就绪后置 booted */
async function bootstrap(): Promise<void> {
  try {
    const last = readLastPage();
    const snapshotValue = readSettingsSnapshot();
    if (snapshotValue !== null) applySettingsSnapshot(snapshotValue);
    // 恢复锚点阅读位置（scroll-flow 模式据此回到原句；旧页码键仍作回退）
    savedPosition.value = readSavedPosition();
    const draft = await readDraft();
    // 按恢复后的版式重建 Reader（初次创建仍是默认主题基准）并载入草稿内容
    readerRef.value = createReader(
      effectiveLayout.value,
      draft ?? readerRef.value.document ?? lunyuDocument,
    );
    // 立即按实测重排，让恢复页码落在真实页数口径上（与编辑 / 导出同源）
    remeasure();
    const target = Math.min(last, Math.max(0, readerRef.value.totalPages - 1));
    if (target > 0) readerRef.value.goToPage(target);
    // 页数变少被限幅时回写，避免下次启动重复越界钳位
    writeLastPage(target);
  } finally {
    booted.value = true;
    // 恢复完成后才开始连续落盘，避免中间态覆盖保存值
    attachPageTracking();
  }
}

/**
 * 旋转 / 跨断点触发重排（D7）
 *
 * 只认「方向翻转」与「跨断点」两个语义信号，而不是任意 resize：软键盘弹出
 * （`interactive-widget=resizes-content`）只改高度、不改宽度，方向与断点都不变，
 * 因此不会被误判为旋转；重排本身再走 120ms 去抖（`scheduleRemeasure`）。
 */
watch([breakpoint.portrait, mobileShell], scheduleRemeasure);

onMounted(async () => {
  window.addEventListener('keydown', onKeydown);
  window.addEventListener('beforeunload', onBeforeUnload);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);
  window.addEventListener('blur', onWindowBlur);
  document.addEventListener('visibilitychange', onVisibilityChange);
  // 开发期性能探针：控制台用 __btPerf.report() 看「重排 vs 落盘」耗时分布
  if (import.meta.env.DEV) perfProbe = installPerfProbe();
  // 恢复上次会话内容，据此确定本书 id（草稿若是导入的书，沿用其设置作用域，避免混用）
  const draft = await readDraft();
  const initialDoc = draft ?? readerRef.value.document ?? lunyuDocument;
  currentBookId.value = bookIdFromTitle(initialDoc.metadata.title);
  // 载入已保存的样式设置（本书作用域 → 全局 → 旧版迁移），加载完成后才允许落盘
  void styleApi.load().then(() => {
    scheduleRemeasure();
  });
  // 启动恢复上次会话（草稿内容 + 页码），就绪后视图才渲染
  void bootstrap();
  // 初次量尺（等挂载后布局完成）；字体就绪后再测一次（Web 字体影响行高）
  void nextTick(remeasure);
  if (typeof document !== 'undefined' && document.fonts?.ready !== undefined) {
    document.fonts.ready.then(() => remeasure()).catch(() => undefined);
  }
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  window.removeEventListener('beforeunload', onBeforeUnload);
  window.removeEventListener('pagehide', onPageHide);
  window.removeEventListener('pageshow', onPageShow);
  window.removeEventListener('blur', onWindowBlur);
  document.removeEventListener('visibilitychange', onVisibilityChange);
  clearRemeasureTimer();
  perfProbe?.stop();
  perfProbe = null;
  // 退订页态（实例重建时内部已自动换绑，这里做最终清理）
  detachPageTracking();
  // 编辑器订阅与自动保存落盘、关库统一在编辑会话的 teardown 内
  teardown();
  // 释放量尺工作表
  disposeMeasureSheet();
});

/** 开发期性能探针句柄（生产环境不安装，恒为 null） */
let perfProbe: PerfProbe | null = null;
</script>

<template>
  <div
    class="app"
    :class="{
      'app--night': night,
      'app--rail': railLayout,
      'app--mobile': mobileShell,
    }"
    :data-layout="mobileShell ? 'mobile' : 'desktop'"
  >
    <AppTopBar
      v-model:info-open="infoOpen"
      v-model:library-open="libraryOpen"
      v-model:settings-open="settingsOpen"
      v-model:pdf-paged-mode="pdfPagedMode"
      v-model:mobile-menu-open="mobileMenuOpen"
      :mobile-shell="mobileShell"
      :mode="mode"
      :book-title="bookTitle"
      :dirty="dirty"
      :save-failed="saveFailed"
      :save-status-text="saveStatusText"
      :theme-key="themeKey"
      :active-tab="activeTab"
      :pdf-exporting="pdfExporting"
      :switch-theme="switchTheme"
      :toggle-edit-mode="toggleEditMode"
      :toggle-tab="toggleTab"
      :on-export-epub="onExportEpub"
      :on-export-pdf="onExportPdf"
    />

    <!--
      直排编辑态设置列组：编辑工具条的三行 → 第二 / 三 / 四列（属性栏已移出，
      独立为状态栏左侧的附加列；横排时工具条在画布上方，故直排时从原位移入此处）。
      列序自左向右对偶横排行序自上而下：顶栏 → 工具条三行 → 属性栏 → 状态栏。
    -->
    <div v-if="railLayout && mode === 'edit' && inspectorBinding" class="app__rail">
      <template v-if="mode === 'edit' && inspectorBinding">
        <EditorToolbar
          :binding="inspectorBinding"
          :readonly="editorReadonly"
          :named-styles="namedStyles.styles"
          @toggle-readonly="styleApi.patchEditingDirect({ readonly: !editing.readonly })"
          @reset="resetSample"
        />
      </template>
    </div>

    <div class="app__body" :style="{ '--bt-aside-width': `${tocWidth}px` }">
      <!-- 桌面：左栏常驻；H5 同一份内容收进左抽屉（A1 / A4） -->
      <aside v-if="!mobileShell" v-show="asideVisible" class="app__aside">
        <AsidePanels
          :tab="activeTab"
          :reader="readerRef"
          :document="readerRef.document ?? lunyuDocument"
          :book-id="currentBookId"
          :mode="mode"
          :theme-key="themeKey"
          :reader-epoch="readerEpoch"
          :expanded-keys="tocExpandedKeys"
          :suggestions-api="suggestionApi"
          @close="activeTab = null"
          @imported="onImported"
          @update:expanded-keys="setTocExpandedKeys"
          @select="onTocSelect"
          @accept="onAcceptSuggestions"
          @reject="onRejectSuggestions"
          @commit="onCommitSuggestions"
          @override="setSuggestionOverride"
          @update:filter="suggestionFilter = $event"
        />
      </aside>
      <BtSidebarResizer
        v-if="!mobileShell"
        v-show="asideVisible"
        v-model="tocWidth"
        class="app__aside-resizer"
        side="start"
        label="调整目录宽度"
        @reset="resetTocWidth"
      />

      <main class="app__main">
        <!-- 流式阅读不被当前版式支持时的回落说明条（可关闭，不使用弹窗） -->
        <div v-if="booted && mode === 'read' && effectiveViewMode !== viewMode" class="app__mode-hint">
          <span>{{ modeFallbackHint || '当前版式暂不支持流式阅读，已切换为分页阅读。' }}</span>
          <button type="button" class="app__mode-hint-close" @click="modeFallbackHint = ''">知道了</button>
        </div>
        <div ref="stageEl" class="app__stage" :class="{ 'app__stage--read': mode === 'read' }">
          <BtBookView
            v-if="booted && mode === 'read'"
            :key="`${themeKey}-${readerEpoch}`"
            :reader="readerRef"
            :tokens="tokens"
            :font-token="activeFontToken"
            :features="features"
            :named-styles="namedStyles"
            :mode="effectiveViewMode"
            :font-size="fontSizeNum"
            :page-transition="pageTransition"
            :initial-position="savedPosition"
            @update:font-size="onFontSizeUpdate"
            @update:position="onReadingPosition"
            @mode-fallback="onModeFallback"
          />
          <BtEditor
            v-else-if="booted && bookEditor"
            ref="btEditorRef"
            class="app__editor"
            :editor="bookEditor"
            :tokens="tokens"
            :options="effectiveLayout"
            :font-token="activeFontToken"
            :features="features"
            :named-styles="namedStyles"
            :pagination="editing.pagination"
            :loading="true"
            :page-main-size="pageMainSize"
            :bottom-slack="bottomSlack"
            :measure="measureContext"
            :editable="!editorReadonly"
            :scale="editorScale"
            :initial-page="editStartPage"
            @update:visible-page="editorVisiblePage = $event"
          >
            <template #default="slotProps">
              <EditorToolbar
                v-if="!railLayout"
                :binding="captureSlotBinding(slotProps)"
                :readonly="editorReadonly"
                :named-styles="namedStyles.styles"
                @toggle-readonly="styleApi.patchEditingDirect({ readonly: !editing.readonly })"
                @reset="resetSample"
              />
              <!--
                直排：工具条改在左侧设置列渲染（见 .app__rail），但 binding 只能经 BtEditor
                默认插槽作用域回传 → 此处留一个零尺捕获锚点，属性求值时顺带完成捕获。
              -->
              <span
                v-else
                class="app__binding-anchor"
                aria-hidden="true"
                :data-captured="captureSlotBinding(slotProps).version.value"
              />
            </template>
          </BtEditor>
        </div>

        <!-- 编辑态右栏：属性检视器（桌面横排置右且可折叠；直排移入左侧设置列；H5 走底部 sheet） -->
        <aside
          v-if="!railLayout && !mobileShell && mode === 'edit' && inspectorBinding"
          class="app__inspector"
          :class="{ 'app__inspector--collapsed': inspectorCollapsed }"
        >
          <button
            type="button"
            class="app__inspector__toggle"
            :title="inspectorCollapsed ? '展开属性栏' : '折叠属性栏'"
            @click="toggleInspector"
          >
            {{ inspectorCollapsed ? '«' : '»' }}
          </button>
          <AttrInspector
            v-show="!inspectorCollapsed"
            :binding="inspectorBinding"
            :named-styles="namedStyles.styles"
          />
        </aside>
      </main>
    </div>

    <!--
      直排列序（自左向右）：顶栏 → 工具条三行 → 属性栏 → 状态栏 → 主区；
      状态栏为第五列、紧邻书页（grid 定位摆放，横排时源序即视觉序）。
    -->
    <aside
      v-if="railLayout && mode === 'edit' && inspectorBinding"
      class="app__inspector app__inspector--rail"
      :class="{ 'app__inspector--collapsed': inspectorCollapsed }"
    >
      <button
        type="button"
        class="app__inspector__toggle"
        :title="inspectorCollapsed ? '展开属性栏' : '折叠属性栏'"
        @click="toggleInspector"
      >
        {{ inspectorCollapsed ? '展开' : '折叠' }}
      </button>
      <AttrInspector
        v-show="!inspectorCollapsed"
        :binding="inspectorBinding"
        :named-styles="namedStyles.styles"
      />
    </aside>

    <AppStatusBar
      v-if="booted"
      v-model:settings-open="settingsOpen"
      v-model:compare-open="compareOpen"
      v-model:editor-scale="editorScale"
      :mobile-shell="mobileShell"
      :mode="mode"
      :theme-key="themeKey"
      :reader-epoch="readerEpoch"
      :reader="readerRef"
      :editor-visible-page="editorVisiblePage"
      :mobile-aside-open="mobileAsideOpen"
      :mobile-inspector-open="mobileInspectorOpen"
      :stats="documentStats.stats.value"
      :inspector-binding="inspectorBinding"
      :view-mode="viewMode"
      :flow-supported="flowSupported"
      :view-mode-label="viewModeLabel"
      :rail-layout="railLayout"
      :open-mobile-tab="openMobileTab"
      :open-mobile-inspector="openMobileInspector"
      :toggle-edit-mode="toggleEditMode"
      :cycle-view-mode="cycleViewMode"
      :zoom-step="zoomStep"
      :fit-editor-width="fitEditorWidth"
    />

    <!-- H5（A1 / A4）：目录 / 搜索 / 书签 / 导入 / 句读收进左抽屉，与桌面侧栏同一份内容 -->
    <BtDrawer
      v-if="mobileShell"
      v-model:open="mobileAsideOpen"
      side="start"
      :title="activeTabLabel"
      width="min(86vw, 340px)"
    >
      <AsidePanels
        :tab="activeTab"
        :reader="readerRef"
        :document="readerRef.document ?? lunyuDocument"
        :book-id="currentBookId"
        :mode="mode"
        :theme-key="themeKey"
        :reader-epoch="readerEpoch"
        :expanded-keys="tocExpandedKeys"
        :suggestions-api="suggestionApi"
        @close="mobileAsideOpen = false"
        @imported="onImported"
        @update:expanded-keys="setTocExpandedKeys"
        @select="onTocSelect"
        @accept="onAcceptSuggestions"
        @reject="onRejectSuggestions"
        @commit="onCommitSuggestions"
        @override="setSuggestionOverride"
        @update:filter="suggestionFilter = $event"
      />
    </BtDrawer>

    <!-- H5（B5）：编辑态属性检视器——底部可拖拽 sheet（半屏 / 全屏两档吸附） -->
    <MobileInspectorSheet
      v-if="mobileShell && mode === 'edit' && inspectorBinding"
      v-model:open="mobileInspectorOpen"
      :binding="inspectorBinding"
      :named-styles="namedStyles.styles"
    />

    <!-- H5（A1 / A6）：更多菜单 sheet——全局动作与底栏次要控件 -->
    <MobileMoreSheet
      v-if="mobileShell"
      v-model:open="mobileMenuOpen"
      v-model:night="night"
      v-model:library-open="libraryOpen"
      v-model:settings-open="settingsOpen"
      v-model:info-open="infoOpen"
      v-model:pdf-paged-mode="pdfPagedMode"
      v-model:compare-open="compareOpen"
      v-model:editor-scale="editorScale"
      :mode="mode"
      :active-tab="activeTab"
      :theme-key="themeKey"
      :ui-skin="uiSkin"
      :pdf-exporting="pdfExporting"
      :view-mode="viewMode"
      :flow-supported="flowSupported"
      :view-mode-label="viewModeLabel"
      :rail-layout="railLayout"
      :open-mobile-tab="openMobileTab"
      :toggle-edit-mode="toggleEditMode"
      :on-mobile-action="onMobileAction"
      :switch-theme="switchTheme"
      :set-ui-skin="setUiSkin"
      :on-export-epub="onExportEpub"
      :on-export-pdf="onExportPdf"
      :cycle-view-mode="cycleViewMode"
      :zoom-step="zoomStep"
      :fit-editor-width="fitEditorWidth"
    />

    <SettingsPanel
      v-if="settingsOpen"
      :api="styleApi"
      :layout="panelLayout"
      :tokens="panelTokens"
      :theme-base-tokens="themeBaseTokens"
      :document="readerRef.document ?? lunyuDocument"
      :night="night"
      :page-transition="pageTransition"
      :ui-skin="uiSkin"
      :ui-density="uiDensity"
      :ui-motion="uiMotion"
      @update:night="night = $event; persistSettingsSnapshot()"
      @update:page-transition="pageTransition = $event; persistSettingsSnapshot()"
      @update:ui-skin="setUiSkin($event)"
      @update:ui-density="uiDensity = $event"
      @update:ui-motion="uiMotion = $event"
      @apply-theme-tokens="onApplyThemeTokens"
      @close="closeSettings"
    />

    <BookInfoDialog
      v-if="infoOpen"
      :metadata="currentMetadata"
      :editable="infoEditable"
      @save="onMetadataSave"
      @close="infoOpen = false"
    />

    <LibraryDrawer
      v-model:open="libraryOpen"
      :document="currentDocument"
      :editor="bookEditor"
      @open-book="onLibraryBook"
      @notify="(message) => pushToast(message, 'info')"
    />

    <AppToast :items="toasts" @dismiss="dismissToast" />

    <!-- D5 双页对照：当前文档左右对页（同书对照）。接入第二份文稿可比对底本 / 校本 -->
    <div v-if="compareOpen" class="app__compare-overlay">
      <div class="app__compare-bar">
        <span class="app__compare-title">双页对照（当前文档左右对页）</span>
        <button type="button" class="app__compare-close" @click="compareOpen = false">关闭</button>
      </div>
      <div class="app__compare-body">
        <BtCompareView
          :left="readerRef"
          mode="page"
          :page-transition="pageTransition"
        />
      </div>
    </div>
  </div>
</template>

<style scoped src="./styles/app-shell.css"></style>

<style scoped src="./styles/app-vertical-rail.css"></style>

<style scoped src="./styles/app-mobile-skeleton.css"></style>

