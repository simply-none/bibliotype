<script setup lang="ts">
/**
 * Demo 主界面（App）
 *
 * - 工具栏：主题切换（现代横排 ↔ 古籍直排）/ 编辑 / 书籍信息 / 搜索 / 书签 / 目录 /
 *   设置 / 导出 EPUB / 打印 PDF；
 * - 左栏：设置面板、搜索面板、书签面板、目录（可分别开关）；
 * - 主区：BtBookView（等比缩放自适应）+ 进度条 + BtPager；编辑态为 BtEditor
 *   （工具条 + 属性检视器，后者跟随选区展示节点 / 标记可编辑属性）；
 * - 键盘：← / → 翻页；Esc 关闭书籍信息弹窗。
 *
 * 版式参数 = 补丁双层：主题预设（基准）+ layoutPatch / tokenPatch（设置面板覆写），
 * 阅读 / 编辑 / 导出共用同一份 effectiveLayout 与 tokens，改一处三端联动；
 * 字号 / 行距变更经双通道联动（tokens 视觉 + repaginate measure 估算），
 * 主题切换重建 Reader 并清空布局补丁（书写方向随主题），字号等个人设置保留。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import {
  COLOR_TOKENS,
  DEFAULT_THEME,
  FONT_SIZE_TOKENS,
  FONT_TOKENS,
  LAYOUT_TOKENS,
  type BookDocument,
  type BookMetadata,
} from '@bibliotype/core';
import { CLASSICAL_THEME_OVERRIDES } from '@bibliotype/classical';
import { buildClassicalEditorSchema } from '@bibliotype/classical/editor';
import { BookEditor, createBookEditorPlugins } from '@bibliotype/editor';
import { IndexedDbAdapter } from '@bibliotype/adapter-indexeddb';
import {
  CLASSICAL_LAYOUT_OPTIONS,
  DEFAULT_LAYOUT_OPTIONS,
  isVerticalMode,
  mergeLayoutOptions,
  resolveContentBox,
  resolvePageMainSize,
  type LayoutOptions,
} from '@bibliotype/layout';
import {
  DEFAULT_MEASURE_CONTEXT,
  Reader,
  type BlockMeasureContext,
} from '@bibliotype/reader';
import { BtBookView, BtEditor, BtPager, BtToc, measurePagination, disposeMeasureSheet } from '@bibliotype/vue';
import { exportEpub } from '@bibliotype/exporter-epub';
import { printBook } from '@bibliotype/exporter-pdf';
import BookInfoDialog from './components/BookInfoDialog.vue';
import AttrInspector from './components/AttrInspector.vue';
import BookmarkPanel from './components/BookmarkPanel.vue';
import EditorToolbar from './components/EditorToolbar.vue';
import ImportPanel from './components/ImportPanel.vue';
import ProgressBar from './components/ProgressBar.vue';
import SearchPanel from './components/SearchPanel.vue';
import SettingsPanel from './components/SettingsPanel.vue';
import { lunyuDocument } from './data/lunyu.js';

/* ---------------- 主题定义 ---------------- */

type ThemeKey = 'modern' | 'classical';

interface ThemeConfig {
  /** 工具栏展示名 */
  label: string;
  /** 布局选项（分区尺寸 / 书写方向 / 页码样式） */
  layout: LayoutOptions;
  /** 主题令牌值表 */
  tokens: Readonly<Record<string, string | undefined>>;
  /** 正文字体令牌键 */
  fontToken: string;
}

/** 现代横排：默认布局 + 默认主题 */
const MODERN_THEME: ThemeConfig = {
  label: '现代横排',
  layout: DEFAULT_LAYOUT_OPTIONS,
  tokens: { ...DEFAULT_THEME },
  fontToken: FONT_TOKENS.BODY,
};

/** 古籍直排：16 开直排 + 古典令牌覆盖（楷体系字体、无首行缩进、版框四周双边） */
const CLASSICAL_THEME: ThemeConfig = {
  label: '古籍直排',
  layout: CLASSICAL_LAYOUT_OPTIONS,
  tokens: {
    ...DEFAULT_THEME,
    ...CLASSICAL_THEME_OVERRIDES,
    'page-border': '3px double #b09a76',
  },
  fontToken: FONT_TOKENS.CLASSICAL_BODY,
};

const THEMES: Record<ThemeKey, ThemeConfig> = {
  modern: MODERN_THEME,
  classical: CLASSICAL_THEME,
};

/** 工具栏按钮列表（key 显式携带，避免模板内索引推断） */
const THEME_ENTRIES: ReadonlyArray<{ key: ThemeKey; config: ThemeConfig }> = [
  { key: 'modern', config: MODERN_THEME },
  { key: 'classical', config: CLASSICAL_THEME },
];

const themeKey = ref<ThemeKey>('modern');
const theme = computed<ThemeConfig>(() => THEMES[themeKey.value]);

/* ---------------- 版式补丁（设置面板覆写主题基准） ---------------- */

/** 布局补丁（含页面尺寸；主题切换时清空） */
const layoutPatch = ref<Partial<LayoutOptions>>({});
/** 令牌补丁（字号 / 行距 / 字体族 / 版式 / 颜色等；跨主题保留） */
const tokenPatch = ref<Record<string, string>>({});

/** 生效布局：主题基准 + 补丁覆写 */
const effectiveLayout = computed<LayoutOptions>(() =>
  mergeLayoutOptions(theme.value.layout, layoutPatch.value),
);

/* ---------------- 排版设置（夜间预设 + 面板补丁） ---------------- */

/** 夜间阅读（仅覆盖阅读区配色令牌，位于令牌链最顶层） */
const night = ref(false);

/** 夜间配色覆盖（正文 / 背景 / 注文 / 强调） */
const NIGHT_COLORS: Readonly<Record<string, string>> = {
  [COLOR_TOKENS.BACKGROUND]: '#171614',
  [COLOR_TOKENS.TEXT]: '#cec9c0',
  [COLOR_TOKENS.NOTE_TEXT]: '#8f897d',
  [COLOR_TOKENS.ACCENT]: '#c99a5b',
};

/** 当前生效令牌：主题基础 + 面板补丁 + 夜间覆盖 */
const tokens = computed<Readonly<Record<string, string | undefined>>>(() => ({
  ...theme.value.tokens,
  ...tokenPatch.value,
  ...(night.value ? NIGHT_COLORS : {}),
}));

/** 解析令牌前导数值（非法回退默认） */
function parseTokenNum(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** 正文字号（px，tokens 视觉 + measure 估算双通道联动） */
const fontSizeNum = computed(() =>
  parseTokenNum(tokens.value[FONT_SIZE_TOKENS.BODY], 16),
);
/** 正文行高（可连续调节） */
const lineHeightNum = computed(() =>
  parseTokenNum(tokens.value[LAYOUT_TOKENS.LINE_HEIGHT], 1.9),
);

/* ---------------- Reader（主题切换时重建） ---------------- */

/**
 * 估算上下文（与字号 / 行距 / 开本联动）
 *
 * 每行字数按页面交叉轴（横排取内容宽 / 直排取内容高）与字号折算，
 * 0.95 为 CJK 字宽近似因子（A5 @16px ≈ 26 字/行，与原默认一致）；
 * 行尺寸（主轴每行）= 字号 × 行距。预览 Reader 与编辑画布共用同一结果。
 */
function typographyMeasure(): Partial<BlockMeasureContext> {
  const box = resolveContentBox(effectiveLayout.value.pageSize, 48, 56);
  const cross = isVerticalMode(effectiveLayout.value.writingMode)
    ? box.height
    : box.width;
  return {
    charsPerLine: Math.max(1, Math.round((cross / fontSizeNum.value) * 0.95)),
    lineSize: Math.round(fontSizeNum.value * lineHeightNum.value),
  };
}

/** 完整估算上下文（传给 BtEditor，与 Reader 内部 { ...DEFAULT, ...measure } 同值） */
const measureContext = computed<BlockMeasureContext>(() => ({
  ...DEFAULT_MEASURE_CONTEXT,
  ...typographyMeasure(),
}));

/** 每页可用主轴尺寸（预览与编辑共用同一口径，保证分页归属一致） */
const pageMainSize = computed(() =>
  resolvePageMainSize(effectiveLayout.value, tokens.value),
);

/**
 * DOM 实测块尺寸（块 id → 主轴尺寸 px）与每行起始字符偏移（块 id → number[]）
 *
 * 由量尺工作表对当前文档逐块实测产出，喂给 Reader（预览逐页）：
 * 尺寸定分页归属，行偏移定跨页块的真实行切片；直排 / 多栏回退估算（空映射）。
 * BtEditor（paged 内核）自带同源量尺，不再消费此映射。
 */
const blockSizes = shallowRef<ReadonlyMap<string, number>>(new Map());
const blockLineOffsets = shallowRef<ReadonlyMap<string, number[]>>(new Map());

/** 重测当前 Reader 文档的块尺寸 / 行边界并重排预览（DOM 实测，需已挂载；布局随补丁同步） */
function remeasure(): void {
  const doc = reader.value.document ?? lunyuDocument;
  const { sizes, lineOffsets } = measurePagination({
    doc,
    options: effectiveLayout.value,
    tokens: tokens.value,
    fontToken: theme.value.fontToken,
    measure: typographyMeasure(),
  });
  blockSizes.value = sizes;
  blockLineOffsets.value = lineOffsets;
  reader.value.repaginate({
    layout: effectiveLayout.value,
    blockSizes: sizes,
    lineOffsets,
    measure: typographyMeasure(),
    pageMainSize: pageMainSize.value,
  });
}

/** 去抖重测（等 DOM / 布局稳定，避免拖动字号 / 开本时频繁量尺） */
let measureTimer: number | undefined;
function scheduleRemeasure(): void {
  if (measureTimer !== undefined) clearTimeout(measureTimer);
  measureTimer = window.setTimeout(() => {
    measureTimer = undefined;
    void nextTick(remeasure);
  }, 120);
}

/** 创建已载入文档的 Reader（loadDocument 触发全链路分页，按当前排版估算） */
function createReader(layout: LayoutOptions, document: BookDocument = lunyuDocument): Reader {
  const r = new Reader({
    layout,
    measure: typographyMeasure(),
    pageMainSize: pageMainSize.value,
    blockSizes: blockSizes.value,
    lineOffsets: blockLineOffsets.value,
  });
  r.loadDocument(document);
  return r;
}

const reader = shallowRef<Reader>(createReader(effectiveLayout.value));

/** 字号 / 行距 / 布局补丁变更：重测块尺寸并原地重排（视觉由 tokens 联动） */
watch([fontSizeNum, lineHeightNum, effectiveLayout], scheduleRemeasure);

/** 设置面板补丁写入（浅合并） */
function onLayoutPatch(patch: Partial<LayoutOptions>): void {
  layoutPatch.value = { ...layoutPatch.value, ...patch };
}

function onTokenPatch(key: string, value: string): void {
  tokenPatch.value = { ...tokenPatch.value, [key]: value };
}

/** 是否存在任何覆写（控制面板「恢复主题预设」可用性） */
const customized = computed(
  () =>
    night.value ||
    Object.keys(layoutPatch.value).length > 0 ||
    Object.keys(tokenPatch.value).length > 0,
);

/** 恢复主题预设：清空全部布局 / 令牌补丁与夜间开关 */
function resetSettings(): void {
  layoutPatch.value = {};
  tokenPatch.value = {};
  night.value = false;
}

function switchTheme(key: ThemeKey): void {
  if (key === themeKey.value) return;
  /* 以当前阅读文档重建 Reader（保留已保存的编辑内容与字号设置），布局补丁随主题重置 */
  const current = reader.value.document ?? lunyuDocument;
  themeKey.value = key;
  layoutPatch.value = {};
  reader.value = createReader(effectiveLayout.value, current);
  // 重建后按新排版重测（直排主题会回退估算，空映射安全）
  scheduleRemeasure();
}

/* ---------------- 编辑模式（编辑 → 回写预览） ---------------- */

/** 当前界面模式：阅读 / 编辑 */
const mode = ref<'read' | 'edit'>('read');

/** 阅读视图模式：单页翻页 / 连续滚动多页 */
const viewMode = ref<'page' | 'scroll'>('page');

/** 编辑器实例（首次进入编辑模式时惰性创建，之后复用） */
const bookEditor = shallowRef<BookEditor | null>(null);

/** 编辑画布是否只读（false 可输入 / true 拒绝输入，仅编辑模式生效） */
const editorReadonly = ref(false);

/* ---------- 编辑态缩放（透传 BtEditor.scale） ---------- */

/** 缩放比例（默认 1） */
const editorScale = ref(1);
/** 编辑舞台元素（用于「适应宽度」测量可用宽） */
const editorStageRef = ref<HTMLElement | null>(null);

/** 缩放步进（限幅 0.2~2，两位小数） */
function zoomStep(delta: number): void {
  const next = Math.round((editorScale.value + delta) * 100) / 100;
  editorScale.value = Math.min(2, Math.max(0.2, next));
}

/** 适应宽度：按舞台可用宽 / 页宽折算缩放（扣除 .app__stage 左右内边距各 20px） */
function fitEditorWidth(): void {
  const el = editorStageRef.value;
  const pageWidth = effectiveLayout.value.pageSize.width;
  if (el === null || pageWidth <= 0) return;
  const available = el.clientWidth - 40;
  const ratio = Math.round((available / pageWidth) * 100) / 100;
  editorScale.value = Math.min(2, Math.max(0.2, ratio));
}

/* ---------- 脏标记 + 自动持久化（IndexedDB 草稿，复用 adapter-indexeddb） ---------- */

/** 草稿存储适配器：本地 IndexedDB 持久化（库 / 仓名与正式文档库区分） */
const draftStore = new IndexedDbAdapter({
  databaseName: 'bibliotype-demo',
  storeName: 'drafts',
});
/** 草稿记录 id（Demo 单文档，固定键） */
const DRAFT_ID = 'current';
/** 自动保存去抖间隔（ms） */
const AUTOSAVE_DELAY = 1500;

/** 是否存在未保存变更（镜像 editor.isDirty，供工具栏展示） */
const dirty = ref(false);
/** 最近一次自动保存时刻（本地时间串；null 表示本次会话未保存过） */
const savedAt = ref<string | null>(null);

/** 编辑器变更取消订阅句柄（卸载时清理） */
let unsubscribeEditor: (() => void) | null = null;
/** 自动保存去抖计时器 */
let autosaveTimer: number | undefined;

/** 立即落盘当前文档并刷新脏基准（IndexedDB 异步写；updatedAt 由适配器内部注入） */
async function persistDraft(): Promise<void> {
  const editor = bookEditor.value;
  if (editor === null) return;
  try {
    await draftStore.save(DRAFT_ID, editor.getDocument());
    editor.markSaved();
  } catch {
    /* 写入失败（配额 / 环境不支持）：忽略，保留脏标记 */
    return;
  }
  dirty.value = false;
  savedAt.value = new Date().toLocaleTimeString();
}

/** 去抖调度自动保存（编辑停止 AUTOSAVE_DELAY 后落盘） */
function scheduleAutosave(): void {
  cancelAutosave();
  autosaveTimer = window.setTimeout(() => {
    autosaveTimer = undefined;
    void persistDraft();
  }, AUTOSAVE_DELAY);
}

/** 取消挂起的自动保存 */
function cancelAutosave(): void {
  if (autosaveTimer !== undefined) {
    clearTimeout(autosaveTimer);
    autosaveTimer = undefined;
  }
}

/** 编辑器变更回调：同步脏标记并在有变更时调度自动保存 */
function onEditorChange(): void {
  const editor = bookEditor.value;
  if (editor === null) return;
  dirty.value = editor.isDirty;
  if (editor.isDirty) {
    scheduleAutosave();
  }
}

/** 读取本地草稿（IndexedDB 异步；无 / 读取失败回 null） */
async function readDraft(): Promise<BookDocument | null> {
  try {
    return (await draftStore.load(DRAFT_ID)) ?? null;
  } catch {
    return null;
  }
}

/** 清除本地草稿（IndexedDB 删除记录） */
async function clearDraft(): Promise<void> {
  try {
    await draftStore.delete(DRAFT_ID);
  } catch {
    /* 忽略 */
  }
}

/** 进入编辑模式：以草稿（若有）或当前阅读文档 + 古籍 schema 创建编辑器（惰性） */
async function enterEdit(): Promise<void> {
  if (bookEditor.value === null) {
    const schema = buildClassicalEditorSchema();
    const draft = await readDraft();
    bookEditor.value = new BookEditor({
      schema,
      document: draft ?? reader.value.document ?? lunyuDocument,
      plugins: createBookEditorPlugins(schema),
    });
    unsubscribeEditor = bookEditor.value.onChange(onEditorChange);
    dirty.value = bookEditor.value.isDirty;
  }
  mode.value = 'edit';
  editorReadonly.value = false;
  // 进编辑前重测（编辑器由当前阅读文档创建，块 id 对齐 → 分页线与预览一致）
  scheduleRemeasure();
}

/** 保存并预览：编辑产物落盘 + 回写 Reader（全链路重排，页码重算）并返回阅读 */
function saveAndPreview(): void {
  const editor = bookEditor.value;
  if (editor === null) return;
  cancelAutosave();
  reader.value.loadDocument(editor.getDocument());
  void persistDraft();
  mode.value = 'read';
  // 文档变更 → 重测新文档块尺寸（旧 id 映射对新文档不适用）
  scheduleRemeasure();
}

/** 还原样册：编辑器内容重置为原始样例并清除草稿 */
function resetSample(): void {
  cancelAutosave();
  bookEditor.value?.loadDocument(lunyuDocument);
  void clearDraft();
  dirty.value = false;
  savedAt.value = null;
}

/** 导入文档：载入阅读预览，若编辑器已建则同步内容（loadDocument 重置脏基准），并落盘草稿 + 重排 */
function onImported(doc: BookDocument): void {
  cancelAutosave();
  reader.value.loadDocument(doc);
  bookEditor.value?.loadDocument(doc);
  dirty.value = bookEditor.value?.isDirty ?? false;
  savedAt.value = null;
  void persistDraft();
  scheduleRemeasure();
  importOpen.value = false;
}

/** 主工具栏「编辑 / 保存并预览」双向切换 */
function toggleEditMode(): void {
  if (mode.value === 'read') {
    void enterEdit();
  } else {
    saveAndPreview();
  }
}

/* ---------------- 导出 / 打印 ---------------- */

/** 触发浏览器下载 */
function download(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** 导出 EPUB（按当前主题、字号行距与配色令牌，所见即所得；含已保存的编辑内容） */
function onExportEpub(): void {
  const { fontToken } = theme.value;
  const layout = effectiveLayout.value;
  const book = reader.value.document ?? lunyuDocument;
  const bytes = exportEpub(book, { layout, tokens: tokens.value, fontToken });
  download('论语.epub', new Blob([new Uint8Array(bytes)], { type: 'application/epub+zip' }));
}

/** 打印 / 另存 PDF（paged 预分页，复用与屏幕同一实测尺寸 / 行边界 / 页主轴，逐页一致；含已保存的编辑内容） */
function onPrintPdf(): void {
  const { fontToken } = theme.value;
  printBook(reader.value.document ?? lunyuDocument, {
    layout: effectiveLayout.value,
    tokens: tokens.value,
    fontToken,
    mode: 'paged',
    pageMainSize: pageMainSize.value,
    context: typographyMeasure(),
    blockSizes: blockSizes.value,
    lineOffsets: blockLineOffsets.value,
  });
}

/* ---------------- 工具栏鼠标交互（横向滚动） ---------------- */

/** 工具栏按钮区（横向滚动容器） */
const toolbarActionsRef = ref<HTMLElement | null>(null);

/** 纵向滚轮转横向滚动：无溢出、或横向手势（deltaX 主导）时不拦截 */
function onToolbarWheel(event: WheelEvent): void {
  const el = toolbarActionsRef.value;
  if (el === null || el.scrollWidth <= el.clientWidth) return;
  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
  /* deltaMode 为「行」时（少数桌面环境）按约一行 16px 折算为像素 */
  const delta = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 16 : event.deltaY;
  el.scrollLeft += delta;
  event.preventDefault();
}

/** 拖动阈值（px）：超过才视为拖动，避免误伤按钮点击 */
const DRAG_THRESHOLD = 5;

/** 按住拖动状态（指针事件：鼠标 / 触控笔 / 触摸通用） */
let drag: { pointerId: number; startX: number; startLeft: number; moved: boolean } | null = null;

/** 拖动结束后的首次点击抑制标记 */
let suppressClick = false;

function removeToolbarDragListeners(): void {
  window.removeEventListener('pointermove', onWindowPointerMove);
  window.removeEventListener('pointerup', onWindowPointerUp);
  window.removeEventListener('pointercancel', onWindowPointerUp);
}

function endToolbarDrag(pointerId: number): void {
  if (drag === null || drag.pointerId !== pointerId) return;
  const moved = drag.moved;
  drag = null;
  toolbarActionsRef.value?.classList.remove('toolbar__actions--dragging');
  removeToolbarDragListeners();
  if (moved) suppressClick = true;
}

function onWindowPointerMove(event: PointerEvent): void {
  const el = toolbarActionsRef.value;
  if (drag === null || el === null || event.pointerId !== drag.pointerId) return;
  const dx = event.clientX - drag.startX;
  if (!drag.moved) {
    if (Math.abs(dx) < DRAG_THRESHOLD) return;
    drag.moved = true;
    el.classList.add('toolbar__actions--dragging');
  }
  el.scrollLeft = drag.startLeft - dx;
}

function onWindowPointerUp(event: PointerEvent): void {
  endToolbarDrag(event.pointerId);
}

/** 按下：记录起点（仅左键、存在横向溢出且不在滚动条区域时进入拖动候选） */
function onToolbarPointerDown(event: PointerEvent): void {
  suppressClick = false;
  const el = toolbarActionsRef.value;
  if (el === null || event.button !== 0 || el.scrollWidth <= el.clientWidth) return;
  if (event.clientY >= el.getBoundingClientRect().top + el.clientHeight) return;
  drag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startLeft: el.scrollLeft,
    moved: false,
  };
  window.addEventListener('pointermove', onWindowPointerMove);
  window.addEventListener('pointerup', onWindowPointerUp);
  window.addEventListener('pointercancel', onWindowPointerUp);
}

/** 拖动后抑制一次点击（捕获阶段拦截，防位移松手误触按钮） */
function onToolbarClickCapture(event: MouseEvent): void {
  if (!suppressClick) return;
  suppressClick = false;
  event.stopPropagation();
  event.preventDefault();
}

/* ---------------- 面板与键盘 ---------------- */

const tocOpen = ref(true);
const searchOpen = ref(false);
const bookmarksOpen = ref(false);
const settingsOpen = ref(false);
const infoOpen = ref(false);
/** 文档导入面板（Markdown / HTML） */
const importOpen = ref(false);
/** 编辑画布分页参考线（设置面板开关） */
const showGuides = ref(true);

/** 信息弹窗可编辑：仅编辑模式下（元数据写入 BookEditor.updateMetadata） */
const infoEditable = computed(() => mode.value === 'edit' && bookEditor.value !== null);

/** 当前元数据：编辑态取编辑器实时快照，阅读态取 Reader 文档（缺省样章） */
const currentMetadata = computed<BookMetadata>(
  () =>
    (mode.value === 'edit' && bookEditor.value !== null
      ? bookEditor.value.getMetadata()
      : reader.value.document?.metadata) ?? lunyuDocument.metadata,
);

/** 元数据保存：写回编辑器（合并补丁 + 自动刷新 updatedAt）；阅读态不可达 */
function onMetadataSave(patch: Partial<BookMetadata>): void {
  bookEditor.value?.updateMetadata(patch);
}

/** 左栏是否有任一区块可见 */
const asideVisible = computed(
  () =>
    settingsOpen.value ||
    searchOpen.value ||
    bookmarksOpen.value ||
    importOpen.value ||
    tocOpen.value,
);

function onKeydown(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
  if (infoOpen.value) {
    if (event.key === 'Escape') infoOpen.value = false;
    return;
  }
  /* 编辑模式：← / → 交由编辑器移动光标，不翻页 */
  if (mode.value === 'edit') return;
  if (event.key === 'ArrowLeft') {
    reader.value.prevPage();
  } else if (event.key === 'ArrowRight') {
    reader.value.nextPage();
  }
}

/** 存在未保存变更时离开页面提示（自动保存去抖窗口内的兜底） */
function onBeforeUnload(event: BeforeUnloadEvent): void {
  if (!dirty.value) return;
  event.preventDefault();
  event.returnValue = '';
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
  window.addEventListener('beforeunload', onBeforeUnload);
  // 初次量尺（等挂载后布局完成）；字体就绪后再测一次（Web 字体影响行高）
  void nextTick(remeasure);
  if (typeof document !== 'undefined' && document.fonts?.ready !== undefined) {
    document.fonts.ready.then(() => remeasure()).catch(() => undefined);
  }
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  window.removeEventListener('beforeunload', onBeforeUnload);
  removeToolbarDragListeners();
  if (measureTimer !== undefined) clearTimeout(measureTimer);
  cancelAutosave();
  unsubscribeEditor?.();
  unsubscribeEditor = null;
  void draftStore.close();
  disposeMeasureSheet();
});
</script>

<template>
  <div class="app" :class="{ 'app--night': night }">
    <header class="toolbar">
      <div class="toolbar__title">
        <strong>论语集解</strong>
        <span class="toolbar__hint">
          {{
            mode === 'edit'
              ? '编辑模式 · 保存后回到阅读（页码重算）'
              : 'bibliotype 阅读 Demo · ←/→ 翻页'
          }}
        </span>
        <span
          v-if="mode === 'edit'"
          class="toolbar__dirty"
          :class="{ 'toolbar__dirty--on': dirty }"
        >
          {{ dirty ? '● 未保存' : savedAt ? `已自动保存 ${savedAt}` : '已保存' }}
        </span>
      </div>
      <div
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
          <button
            type="button"
            class="toolbar__button"
            :class="{ 'toolbar__button--active': mode === 'edit' }"
            @click="toggleEditMode"
          >
            {{ mode === 'edit' ? '保存并预览' : '编辑' }}
          </button>
        </div>
        <div v-if="mode === 'edit'" class="toolbar__group">
          <button type="button" class="toolbar__button" title="缩小" @click="zoomStep(-0.1)">
            −
          </button>
          <span class="toolbar__readout">{{ Math.round(editorScale * 100) }}%</span>
          <button type="button" class="toolbar__button" title="放大" @click="zoomStep(0.1)">+</button>
          <button type="button" class="toolbar__button" title="恢复 100%" @click="editorScale = 1">
            100%
          </button>
          <button type="button" class="toolbar__button" title="按宽度缩放整页" @click="fitEditorWidth">
            适应宽度
          </button>
        </div>
        <div class="toolbar__group">
          <button
            type="button"
            class="toolbar__button"
            :class="{ 'toolbar__button--active': settingsOpen }"
            @click="settingsOpen = !settingsOpen"
          >
            设置
          </button>
          <button type="button" class="toolbar__button" @click="infoOpen = true">
            书籍信息
          </button>
          <button
            type="button"
            class="toolbar__button"
            :class="{ 'toolbar__button--active': searchOpen }"
            @click="searchOpen = !searchOpen"
          >
            搜索
          </button>
          <button
            type="button"
            class="toolbar__button"
            :class="{ 'toolbar__button--active': bookmarksOpen }"
            @click="bookmarksOpen = !bookmarksOpen"
          >
            书签
          </button>
          <button
            type="button"
            class="toolbar__button"
            :class="{ 'toolbar__button--active': importOpen }"
            @click="importOpen = !importOpen"
          >
            导入
          </button>
          <button
            type="button"
            class="toolbar__button"
            :class="{ 'toolbar__button--active': tocOpen }"
            @click="tocOpen = !tocOpen"
          >
            目录
          </button>
        </div>
        <div class="toolbar__group">
          <button type="button" class="toolbar__button" @click="onExportEpub">导出 EPUB</button>
          <button type="button" class="toolbar__button" @click="onPrintPdf">打印 PDF</button>
        </div>
      </div>
    </header>

    <div class="app__body">
      <aside v-show="asideVisible" class="app__aside">
        <SettingsPanel
          v-if="settingsOpen"
          :layout="effectiveLayout"
          :tokens="tokens"
          :pagination="showGuides"
          :night="night"
          :customized="customized"
          @update:layout="onLayoutPatch"
          @update:token="onTokenPatch"
          @update:pagination="showGuides = $event"
          @update:night="night = $event"
          @reset="resetSettings"
          @close="settingsOpen = false"
        />
        <SearchPanel
          v-if="searchOpen"
          :key="`search-${themeKey}`"
          :reader="reader"
          @close="searchOpen = false"
        />
        <BookmarkPanel
          v-if="bookmarksOpen"
          :key="`bookmark-${themeKey}`"
          :reader="reader"
          @close="bookmarksOpen = false"
        />
        <ImportPanel
          v-if="importOpen"
          @close="importOpen = false"
          @imported="onImported"
        />
        <div v-show="tocOpen" class="app__toc">
          <BtToc :key="`toc-${themeKey}`" :reader="reader" />
        </div>
      </aside>

      <main class="app__main">
        <div ref="editorStageRef" class="app__stage">
          <BtBookView
            v-if="mode === 'read'"
            :key="themeKey"
            :reader="reader"
            :tokens="tokens"
            :font-token="theme.fontToken"
            :mode="viewMode"
          />
          <BtEditor
            v-else-if="bookEditor"
            class="app__editor"
            :editor="bookEditor"
            :tokens="tokens"
            :options="effectiveLayout"
            :font-token="theme.fontToken"
            :pagination="showGuides"
            :page-main-size="pageMainSize"
            :measure="measureContext"
            :editable="!editorReadonly"
            :scale="editorScale"
          >
            <template #default="slotProps">
              <EditorToolbar
                :binding="slotProps"
                :readonly="editorReadonly"
                @toggle-readonly="editorReadonly = !editorReadonly"
                @reset="resetSample"
              />
              <AttrInspector :binding="slotProps" />
            </template>
          </BtEditor>
        </div>
        <footer v-if="mode === 'read'" class="app__footer">
          <ProgressBar :key="themeKey" :reader="reader" />
          <BtPager :key="themeKey" :reader="reader" />
          <button
            type="button"
            class="app__view-toggle"
            :title="viewMode === 'page' ? '切换为连续滚动翻页' : '切换为单页翻页'"
            @click="viewMode = viewMode === 'page' ? 'scroll' : 'page'"
          >
            {{ viewMode === 'page' ? '滚动翻页' : '单页翻页' }}
          </button>
        </footer>
      </main>
    </div>

    <BookInfoDialog
      v-if="infoOpen"
      :metadata="currentMetadata"
      :editable="infoEditable"
      @save="onMetadataSave"
      @close="infoOpen = false"
    />
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;

  /* 演示界面配色令牌（夜间经 .app--night 覆盖；阅读区配色走主题令牌） */
  --demo-bg: #efe9dd;
  --demo-panel: #f4f0e8;
  --demo-aside: #faf8f4;
  --demo-border: #e2ddd2;
  --demo-text: #3c3a34;
  --demo-muted: #8a8578;
  --demo-control: #fbf9f4;
  --demo-control-border: #d8d2c4;
  --demo-accent: #8c5a2b;
}

.app--night {
  --demo-bg: #121110;
  --demo-panel: #1d1c1a;
  --demo-aside: #191816;
  --demo-border: #33312d;
  --demo-text: #cfcac2;
  --demo-muted: #8a8578;
  --demo-control: #262421;
  --demo-control-border: #3d3a35;
  --demo-accent: #c99a5b;

  /* 编辑画布纸面（BtEditor 消费的 CSS 变量） */
  --bt-editor-paper: #24231f;
  --bt-editor-ink: #cfcac2;
}

/* ---------- 工具栏 ---------- */

.toolbar {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 16px;
  border-block-end: 1px solid var(--demo-border);
  background: var(--demo-panel);
  color: var(--demo-text);
}

.toolbar__title {
  display: flex;
  flex: none;
  align-items: baseline;
  gap: 10px;
}

.toolbar__title strong {
  font-size: 18px;
  letter-spacing: 0.1em;
}

.toolbar__hint {
  font-size: 12px;
  color: var(--demo-muted);
}

.toolbar__dirty {
  font-size: 12px;
  color: var(--demo-muted);
}

.toolbar__dirty--on {
  color: #c0392b;
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
  gap: 6px;
  white-space: nowrap;
}

.toolbar__readout {
  min-width: 36px;
  font-size: 12px;
  text-align: center;
  color: var(--demo-muted);
}

.toolbar__button {
  flex: none;
  padding: 5px 11px;
  font-size: 13px;
  white-space: nowrap;
  color: var(--demo-text);
  background: var(--demo-control);
  border: 1px solid var(--demo-control-border);
  border-radius: 4px;
  cursor: pointer;
}

.toolbar__button:hover:not(:disabled) {
  border-color: var(--demo-accent);
  color: var(--demo-accent);
}

.toolbar__button:disabled {
  opacity: 0.45;
  cursor: default;
}

.toolbar__button--active {
  color: #fff;
  background: var(--demo-accent);
  border-color: var(--demo-accent);
}

.toolbar__button--active:hover:not(:disabled) {
  color: #fff;
}

/* ---------- 主体布局 ---------- */

.app__body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.app__aside {
  display: flex;
  flex: none;
  flex-direction: column;
  width: 240px;
  overflow-y: auto;
  border-inline-end: 1px solid var(--demo-border);
  background: var(--demo-aside);
  color: var(--demo-text);
}

.app__toc {
  padding: 10px 4px 14px;
}

.app__main {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  background: var(--demo-bg);
}

.app__stage {
  flex: 1;
  min-height: 0;
  padding: 20px;
}

.app__editor {
  height: 100%;
}

.app__footer {
  display: flex;
  flex: none;
  align-items: center;
  gap: 16px;
  padding: 10px 16px;
  border-block-start: 1px solid var(--demo-border);
  background: var(--demo-panel);
  color: var(--demo-text);
}

.app__view-toggle {
  margin-inline-start: auto;
  padding: 4px 14px;
  border: 1px solid currentColor;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  font-size: 14px;
  cursor: pointer;
}
</style>
