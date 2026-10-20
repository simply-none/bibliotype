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
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch, type Ref } from 'vue';
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
  FACSIMILE_BASE_LAYOUT,
  FACSIMILE_PRESETS,
  computeMetricsSignature,
  isVerticalMode,
  mergeLayoutOptions,
  resolvePageCrossSize,
  resolvePageMainSize,
  resolveBottomSlack,
  type BlockAxis,
  type LayoutOptions,
} from '@bibliotype/layout';
import {
  DEFAULT_MEASURE_CONTEXT,
  Reader,
  type BlockMeasureContext,
  type OutlineItem,
} from '@bibliotype/reader';
import { BtBookView, BtEditor, BtPager, BtToc, measurePagination, disposeMeasureSheet, type EditorBinding } from '@bibliotype/vue';
import { exportEpub, type ValidationProblem } from '@bibliotype/exporter-epub';
import {
  createImageBlobRewriter,
  downloadPdf,
  exportPdfBytes,
  printHtml,
  renderPrintHtml,
  type PdfAdapterOptions,
} from '@bibliotype/exporter-pdf';
import AppToast from './components/AppToast.vue';
import BookInfoDialog from './components/BookInfoDialog.vue';
import AttrInspector from './components/AttrInspector.vue';
import BookmarkPanel from './components/BookmarkPanel.vue';
import EditorToolbar from './components/EditorToolbar.vue';
import ImportPanel from './components/ImportPanel.vue';
import ProgressBar from './components/ProgressBar.vue';
import SearchPanel from './components/SearchPanel.vue';
import SettingsPanel from './components/SettingsPanel.vue';
import ToolbarUsageTip from './components/ToolbarUsageTip.vue';
import type { ToolbarUsage } from './components/toolbar-usage.js';
import { useDraftAutosave } from './composables/use-draft-autosave.js';
import { useStyleSettings } from './composables/use-style-settings.js';
import { useToast } from './composables/use-toast.js';
import { installPerfProbe, type PerfProbe } from './composables/use-perf-probe.js';
import { lunyuDocument } from './data/lunyu.js';
import {
  resolveActiveFacsimilePreset,
  resolveActiveFontToken,
  resolveFacsimilePresetTokens,
} from './facsimile-theme.js';

/* ---------------- 主题定义 ---------------- */

type ThemeKey = 'modern' | 'classical' | 'facsimile';

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

/**
 * 古籍仿真直排：与「古籍直排」并列的第三档主题
 *
 * 布局基准取第一个模板（进入即展示第一种模板的样式），令牌与字体由
 * `layout.facsimile.preset` 派生（见下方 facsimilePreset），因此切模板
 * 不会污染令牌补丁，切回「古籍直排」也不残留仿真纸色 / 框色。
 */
const FACSIMILE_THEME: ThemeConfig = {
  label: '古籍仿真直排',
  layout: FACSIMILE_PRESETS[0]?.layout ?? FACSIMILE_BASE_LAYOUT,
  tokens: { ...DEFAULT_THEME },
  fontToken: FONT_TOKENS.CLASSICAL_BODY,
};

const THEMES: Record<ThemeKey, ThemeConfig> = {
  modern: MODERN_THEME,
  classical: CLASSICAL_THEME,
  facsimile: FACSIMILE_THEME,
};

/** 工具栏按钮列表（key 显式携带，避免模板内索引推断） */
const THEME_ENTRIES: ReadonlyArray<{ key: ThemeKey; config: ThemeConfig }> = [
  { key: 'modern', config: MODERN_THEME },
  { key: 'classical', config: CLASSICAL_THEME },
  { key: 'facsimile', config: FACSIMILE_THEME },
];

const themeKey = ref<ThemeKey>('modern');
const theme = computed<ThemeConfig>(() => THEMES[themeKey.value]);

/* ---------------- 版式补丁（设置面板覆写主题基准） ---------------- */

/**
 * 样式设置（三级作用域 + 自动持久化）
 *
 * 布局补丁 / 令牌补丁 / 功能样式 / 命名样式 / 编辑行为统一由它管理：
 * 草稿模式——设置弹窗内改动只写草稿（页面不重排），点「保存」才
 * 烘焙生效并落盘到本书作用域（IndexedDB 优先），下次打开沿用同一套样式。
 *
 * 每本书独立保存：bookId 取自已打开文档的书名（稳定哈希），设置落到
 * `book:<id>`；切书 / 重开各自恢复自己的那份，不再互相覆盖。
 */

/** 字符串哈希（FNV-1a，转 36 进制）：把任意书名（含中文）映射成稳定的作用域键短串 */
function hashString(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** 由书名推导本书设置作用域 id（同名书复用同一份设置；标题缺失回落 'untitled'） */
function bookIdFromTitle(title: string | undefined): string {
  const normalized = (title ?? '').trim();
  return normalized === '' ? 'untitled' : `t${hashString(normalized)}`;
}

/** 《论语》样本书的固定 id（启动默认书） */
const LUNYU_BOOK_ID = bookIdFromTitle(lunyuDocument.metadata.title);
/**
 * 当前书籍 id（响应式）。切书时更新后，样式设置随之切到该书作用域并重新载入应用；
 * 设置面板维持现有草稿模式（改完点「保存」才落盘）。
 */
const currentBookId = ref(LUNYU_BOOK_ID);

const styleApi = useStyleSettings({ bookId: currentBookId, draft: true });
/** 布局补丁（含页面尺寸；主题切换时清空） */
const layoutPatch = styleApi.layoutPatch as Ref<Partial<LayoutOptions>>;
/** 令牌补丁（字号 / 行距 / 字体族 / 版式 / 颜色等） */
const tokenPatch = styleApi.tokenPatch;
/** 功能样式表（按功能粒度的样式覆盖） */
const features = styleApi.features;
/** 命名样式集合 */
const namedStyles = styleApi.namedStyles;
/** 编辑行为设置 */
const editing = styleApi.editing;

/** 生效布局：主题基准 + 补丁覆写 */
const effectiveLayout = computed<LayoutOptions>(() =>
  mergeLayoutOptions(theme.value.layout, layoutPatch.value),
);

/** 当前仿真模板（由 `layout.facsimile.preset` 派生；未启用仿真版式时为 undefined） */
const facsimilePreset = computed(() => resolveActiveFacsimilePreset(effectiveLayout.value));

/** 仿真模板令牌覆盖：只派生、不写入令牌补丁（切主题即消失，不污染古典） */
const facsimilePresetTokens = computed<Readonly<Record<string, string>>>(() =>
  resolveFacsimilePresetTokens(effectiveLayout.value),
);

/** 生效正文字体令牌键：仿真模板优先，其余仍取主题默认 */
const activeFontToken = computed(() =>
  resolveActiveFontToken(effectiveLayout.value, theme.value.fontToken),
);

/**
 * 界面外壳是否转为「左侧竖向设置列」
 *
 * 直排（vertical-rl / vertical-lr）自右向左起读，右缘是首列所在、也是视线落点，
 * 工具栏 / 属性栏放右侧会压住起始列；因此直排时顶栏、编辑工具条、属性栏、状态栏
 * 全部移到书页左侧。转置口径是「行 → 列」：横排的每一行各自变成一条通高竖列，
 * 列与列横向并排，列序自左向右还原横排的行序自上而下——顶栏 → 编辑工具条三行 →
 * 状态栏共五条列带；属性栏（横排在主区右侧、不属五行）为附加列紧随状态栏左侧，
 * 列内项目自上而下、文字竖写。横排保持原有「顶栏 + 画布 + 底栏 + 右栏」结构不变。
 */
const verticalRail = computed(() => isVerticalMode(effectiveLayout.value.writingMode));

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

/**
 * 当前生效令牌：主题基础 → 仿真模板 → 面板补丁 → 夜间覆盖
 *
 * 仿真模板夹在主题与补丁之间：模板给的是「版式基准」，用户的单点微调
 * （tokenPatch）仍然优先；模板令牌不进补丁，因此切主题不会残留。
 */
const tokens = computed<Readonly<Record<string, string | undefined>>>(() => ({
  ...theme.value.tokens,
  ...facsimilePresetTokens.value,
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
 *
 * 交叉轴走 `resolvePageCrossSize`：它会解析 page-margin 令牌、扣掉版框边框，
 * 并在**直排**下扣掉页眉 / 页脚占位（直排时它们吃的是每列行长，不是列数）。
 */
function typographyMeasure(): Partial<BlockMeasureContext> {
  const cross = resolvePageCrossSize(effectiveLayout.value, tokens.value);
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
 * 页底溢出（px）：末行允许伸入下边距的深度（按「不压页码带」截断）
 *
 * 预览 / 编辑画布 / PDF 导出共用本值，三端逐页归属才能一致。
 */
const bottomSlack = computed(() =>
  resolveBottomSlack(effectiveLayout.value, tokens.value, typographyMeasure().lineSize ?? 30),
);

/**
 * DOM 实测块尺寸（块 id → 主轴尺寸 px）与每行起始字符偏移（块 id → number[]）
 *
 * 由量尺工作表对当前文档逐块实测产出，喂给 Reader（预览逐页）：
 * 尺寸定分页归属，行偏移定跨页块的真实行切片；直排 / 多栏回退估算（空映射）。
 * bodySizes（块体高，不含外边距）供 paginate 按体高计「往本页追加一块」的代价，
 * 消除每页虚耗一份块间距造成的页底空白。
 * BtEditor（paged 内核）自带同源量尺，不再消费此映射。
 */
const blockSizes = shallowRef<ReadonlyMap<string, number>>(new Map());
const blockLineOffsets = shallowRef<ReadonlyMap<string, number[]>>(new Map());
const blockLineSizes = shallowRef<ReadonlyMap<string, number>>(new Map());
const blockBodySizes = shallowRef<ReadonlyMap<string, number>>(new Map());
/** 量尺解析出的排文主轴（直排 column），透传给 Reader 的块 axis 标注 */
const blockAxis = shallowRef<BlockAxis>('row');

/** 重测当前 Reader 文档的块尺寸 / 行边界 / 真实行高并重排预览（DOM 实测，需已挂载；布局随补丁同步） */
function remeasure(): void {
  const doc = reader.value.document ?? lunyuDocument;
  const { sizes, lineOffsets, lineSizes, bodySizes, axis } = measurePagination({
    doc,
    options: effectiveLayout.value,
    tokens: tokens.value,
    fontToken: activeFontToken.value,
    measure: typographyMeasure(),
  });
  blockSizes.value = sizes;
  blockLineOffsets.value = lineOffsets;
  blockLineSizes.value = lineSizes;
  blockBodySizes.value = bodySizes;
  blockAxis.value = axis;
  reader.value.repaginate({
    layout: effectiveLayout.value,
    blockSizes: sizes,
    lineOffsets,
    lineSizes,
    bodySizes,
    axis,
    measure: typographyMeasure(),
    pageMainSize: pageMainSize.value,
    bottomSlack: bottomSlack.value,
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

/**
 * Reader 实例代际（每次重建自增）
 *
 * 目录 / 搜索 / 书签 / 翻页 / 进度这些面板在 setup 里一次性订阅 Reader 事件，
 * 换实例不会自动重绑。若 `:key` 只跟主题，则「重建 Reader 但主题没变」（首次进入
 * 按草稿恢复、还原样册等）时面板仍绑在被弃用的初始 Reader 上，显示的是样章数据；
 * 之后任意一次主题切换重挂载，才会绑到真正在用的 Reader —— 目录于是从「正常」
 * 突变为「空白」。所以 key 必须同时随主题与代际变化。
 */
const readerEpoch = ref(0);

/** 创建已载入文档的 Reader（loadDocument 触发全链路分页，按当前排版估算） */
function createReader(layout: LayoutOptions, document: BookDocument = lunyuDocument): Reader {
  const r = new Reader({
    layout,
    measure: typographyMeasure(),
    pageMainSize: pageMainSize.value,
    bottomSlack: bottomSlack.value,
    blockSizes: blockSizes.value,
    lineOffsets: blockLineOffsets.value,
    lineSizes: blockLineSizes.value,
    bodySizes: blockBodySizes.value,
    axis: blockAxis.value,
  });
  r.loadDocument(document);
  readerEpoch.value += 1;
  return r;
}

const reader = shallowRef<Reader>(createReader(effectiveLayout.value));

/**
 * 书籍版本号（文档 / 元数据变更计数）
 *
 * `Reader` 与 `BookEditor` 都是普通类实例（非响应式），同一实例内的
 * `loadDocument` / `updateMetadata` 不会让 computed 失效。凡这类落点手动自增，
 * 供 `currentMetadata` / `bookTitle` 重新取值（顶部书名、书籍信息弹窗都依赖它）。
 */
const bookVersion = ref(0);

/**
 * 阅读预览的排版度量签名
 *
 * 只有「会影响分页结果」的配置变化才重测量尺并重排（字号 / 行距 / 页边距 /
 * 分栏 / 版框 / 功能样式里的度量类声明）；改颜色、线型等纯视觉参数不重排。
 */
const readerMetricsSignature = computed(() =>
  computeMetricsSignature({
    tokens: tokens.value,
    options: effectiveLayout.value,
    features: features.value,
  }),
);

/** 度量签名变化：重测块尺寸并原地重排（视觉由 tokens / 样式表联动） */
watch(readerMetricsSignature, scheduleRemeasure);

/** 是否存在任何覆写（夜间预设 / 布局补丁 / 令牌补丁 / 功能样式） */
const customized = computed(
  () =>
    night.value ||
    styleApi.customized.value ||
    Object.keys(layoutPatch.value).length > 0,
);

/** 恢复全部默认：清空补丁 / 功能样式 / 命名样式 / 夜间，并删除已存样式快照 */
async function resetSettings(): Promise<void> {
  night.value = false;
  await styleApi.resetAll();
  persistSettingsSnapshot();
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

/** 启动恢复完成（草稿内容 + 页码已回灌）；就绪前视图不渲染，避免样章闪烁 */
const booted = ref(false);

/** 阅读视图模式：单页翻页 / 连续滚动多页 */
const viewMode = ref<'page' | 'scroll'>('page');

/** 编辑态右栏属性检视器是否折叠（收成细条只留展开把手；随界面偏好快照持久化） */
const inspectorCollapsed = ref(false);

/** 切换属性栏折叠并落盘 */
function toggleInspector(): void {
  inspectorCollapsed.value = !inspectorCollapsed.value;
  persistSettingsSnapshot();
}

/** 编辑器实例（首次进入编辑模式时惰性创建，之后复用） */
const bookEditor = shallowRef<BookEditor | null>(null);

/** BtEditor 组件实例（编辑态目录跳转等命令入口） */
const btEditorRef = ref<InstanceType<typeof BtEditor> | null>(null);

/** 编辑画布是否只读（false 可输入 / true 拒绝输入，仅编辑模式生效）
 *
 * 单一真相源为 `editing.readonly`（持久化）：设置面板「只读模式」勾选、
 * 工具条「只读」按钮、进编辑时的重置均经 `patchEditing` 落到该字段，
 * 本计算属性只读不写——之前用独立 ref 会导致设置面板勾选完全不生效。 */
const editorReadonly = computed(() => editing.value.readonly === true);

/** 编辑态视口页（PagedCanvas 回写；「保存并预览」时回定位到阅读该页，自 0 起） */
const editorVisiblePage = ref(0);
/** 进编辑时的定位页（阅读模式当前页；BtEditor 首轮分页就绪后滚到此页） */
const editStartPage = ref(0);

/* ---------- 编辑态缩放（透传 BtEditor.scale） ---------- */

/** 缩放比例（默认 1） */
const editorScale = ref(1);
/** 编辑舞台元素（用于「适应宽度 / 适应高度」测量可用尺寸） */
const editorStageRef = ref<HTMLElement | null>(null);

/** 缩放步进（限幅 0.2~2，两位小数） */
function zoomStep(delta: number): void {
  const next = Math.round((editorScale.value + delta) * 100) / 100;
  editorScale.value = Math.min(2, Math.max(0.2, next));
}

/**
 * 适应交叉轴：横排按舞台可用宽 / 页宽折算（适应宽度）；直排页沿水平排列，
 * 受整页高可见约束，改按舞台可用高 / 页高折算（适应高度）。
 * 扣除 .app__stage 对应方向内边距各 20px。
 */
function fitEditorWidth(): void {
  const el = editorStageRef.value;
  const page = effectiveLayout.value.pageSize;
  const crossSize = verticalRail.value ? page.height : page.width;
  if (el === null || crossSize <= 0) return;
  const available = (verticalRail.value ? el.clientHeight : el.clientWidth) - 40;
  const ratio = Math.round((available / crossSize) * 100) / 100;
  editorScale.value = Math.min(2, Math.max(0.2, ratio));
}

/* ---------- 脏标记 + 自动保存（IndexedDB 草稿，复用 adapter-indexeddb） ---------- */

/** 草稿存储适配器：本地 IndexedDB 持久化（库 / 仓名与正式文档库区分） */
const draftStore = new IndexedDbAdapter({
  databaseName: 'bibliotype-demo',
  storeName: 'drafts',
});
/** 草稿记录 id（Demo 单文档，固定键） */
const DRAFT_ID = 'current';

/**
 * 自动保存调度器（策略见 composables/use-draft-autosave）：
 * 节流合并 + 空闲落盘 + 单飞去重——序列化与整本写入都不落在输入帧上。
 */
const autosave = useDraftAutosave({
  editor: () => bookEditor.value,
  store: draftStore,
  id: DRAFT_ID,
});

/** 是否存在未保存变更（镜像 editor.isDirty，供工具栏展示） */
const dirty = autosave.dirty;
/** 最近一次成功落盘时刻（本地时间串；null 表示本次会话未成功落盘过） */
const savedAt = autosave.savedAt;
/** 是否正在落盘（工具栏展示「保存中…」） */
const saving = autosave.saving;
/** 最近一次落盘是否失败（配额 / 环境不支持时保持未保存并重试） */
const saveFailed = autosave.failed;

/** 保存状态文案（失败 > 写入中 > 未保存 > 已保存时刻） */
const saveStatusText = computed<string>(() => {
  if (saveFailed.value) return '保存失败，重试中';
  if (saving.value) return '保存中…';
  if (dirty.value) return '● 未保存';
  return savedAt.value === null ? '已保存' : `已保存 ${savedAt.value}`;
});

/** 编辑器变更取消订阅句柄（卸载时清理） */
let unsubscribeEditor: (() => void) | null = null;

/** 开发期性能探针句柄（生产环境不安装，恒为 null） */
let perfProbe: PerfProbe | null = null;

/** 编辑器变更回调：同步脏标记并调度一轮合并落盘（决策与时限在 autosave 内） */
function onEditorChange(): void {
  autosave.schedule();
}

/** 立即落盘（Ctrl/Cmd+S）：跳过挂起调度，写一轮并刷新状态 */
async function saveNow(): Promise<void> {
  await autosave.flush();
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

/* ---------- 启动恢复上次会话（内容 = 草稿，页码 = localStorage） ---------- */

/** 阅读位置 localStorage 键（页码自 0 起；文档内容草稿在 IndexedDB） */
const LAST_PAGE_KEY = 'bibliotype-demo:last-page';
/** 版式设置快照 localStorage 键（设置面板「保存设置」显式落盘，启动时回灌） */
const SETTINGS_KEY = 'bibliotype-demo:settings';

/** 界面偏好快照：主题键 + 夜间 / 视图模式 / 属性栏折叠 */
interface SettingsSnapshot {
  themeKey: ThemeKey;
  night: boolean;
  viewMode: 'page' | 'scroll';
  /** 编辑态右栏属性检视器折叠（true = 收成细条） */
  inspectorCollapsed: boolean;
}

/** 读取界面偏好快照（非法 / 缺失 → null，逐字段容错回退默认） */
function readSettingsSnapshot(): SettingsSnapshot | null {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<SettingsSnapshot>;
    /* 三档主题；旧快照 / 未知值一律回落 null（再走默认主题） */
    if (
      parsed.themeKey !== 'modern' &&
      parsed.themeKey !== 'classical' &&
      parsed.themeKey !== 'facsimile'
    ) {
      return null;
    }
    return {
      themeKey: parsed.themeKey,
      night: parsed.night === true,
      viewMode: parsed.viewMode === 'scroll' ? 'scroll' : 'page',
      inspectorCollapsed: parsed.inspectorCollapsed === true,
    };
  } catch {
    return null;
  }
}

/**
 * 应用界面偏好快照
 *
 * 注意：**不含**布局 / 令牌补丁 —— 那部分由 `use-style-settings` 管理的
 * 样式快照负责（IndexedDB 本书作用域）。两边各存各的，避免互相覆盖。
 */
function applySettingsSnapshot(snapshot: SettingsSnapshot): void {
  themeKey.value = snapshot.themeKey;
  night.value = snapshot.night;
  viewMode.value = snapshot.viewMode;
  inspectorCollapsed.value = snapshot.inspectorCollapsed;
}

/** 收集当前界面偏好并落盘 */
function persistSettingsSnapshot(): void {
  const snapshot: SettingsSnapshot = {
    themeKey: themeKey.value,
    night: night.value,
    viewMode: viewMode.value,
    inspectorCollapsed: inspectorCollapsed.value,
  };
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(snapshot));
  } catch {
    /* 存储不可用环境忽略 */
  }
}

/**
 * 应用界面偏好（主题 / 夜间 / 视图模式 / 参考线）
 *
 * 改造后版式与功能样式**自动落盘**（`use-style-settings`），不再需要「保存设置」按钮；
 * 分页重算由度量签名变化驱动（见 `readerMetricsSignature`）。
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
  [themeKey, night, viewMode, inspectorCollapsed],
  persistSettingsSnapshot,
);

/** 读取上次保存的页码（非法 / 不可用 → 0） */
function readLastPage(): number {
  try {
    const raw = Number.parseInt(window.localStorage.getItem(LAST_PAGE_KEY) ?? '', 10);
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
  } catch {
    return 0;
  }
}

/** 落盘当前页码（存储不可用环境静默失败） */
function writeLastPage(pageIndex: number): void {
  try {
    window.localStorage.setItem(LAST_PAGE_KEY, String(pageIndex));
  } catch {
    /* 忽略 */
  }
}

/** 页态订阅退订句柄（绑定当前 Reader 实例，实例重建时重挂） */
let unsubscribePage: (() => void) | null = null;

/** 订阅 Reader page:change → 页码持久化（翻页 / 滚动回写 / 目录书签跳转全覆盖） */
function attachPageTracking(): void {
  unsubscribePage?.();
  unsubscribePage = reader.value.events.on('page:change', (payload) => {
    writeLastPage(payload.pageIndex);
  });
}

// 主题切换 / 保存设置等重建 Reader：启动完成后才重新订阅新实例
watch(reader, () => {
  if (booted.value) attachPageTracking();
});

/** 启动恢复：设置快照 + 草稿内容回灌并刷新书本 + 回跳上次阅读页；就绪后置 booted */
async function bootstrap(): Promise<void> {
  try {
    const last = readLastPage();
    const snapshot = readSettingsSnapshot();
    if (snapshot !== null) applySettingsSnapshot(snapshot);
    const draft = await readDraft();
    // 按恢复后的版式重建 Reader（初次创建仍是默认主题基准）并载入草稿内容
    reader.value = createReader(
      effectiveLayout.value,
      draft ?? reader.value.document ?? lunyuDocument,
    );
    // 立即按实测重排，让恢复页码落在真实页数口径上（与编辑 / 导出同源）
    remeasure();
    const target = Math.min(last, Math.max(0, reader.value.totalPages - 1));
    if (target > 0) reader.value.goToPage(target);
    // 页数变少被限幅时回写，避免下次启动重复越界钳位
    writeLastPage(target);
  } finally {
    booted.value = true;
    // 恢复完成后才开始连续落盘，避免中间态覆盖保存值
    attachPageTracking();
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
  styleApi.patchEditingDirect({ readonly: false });
  // 位置记忆：进编辑定位到阅读模式当前页（分页三端同源，页码可直接对齐）
  editStartPage.value = reader.value.currentPage;
  editorVisiblePage.value = editStartPage.value;
  // 进编辑前重测（编辑器由当前阅读文档创建，块 id 对齐 → 分页线与预览一致）
  scheduleRemeasure();
}

/** 保存并预览：编辑产物落盘 + 回写 Reader（全链路重排，页码重算）并返回阅读 */
function saveAndPreview(): void {
  const editor = bookEditor.value;
  if (editor === null) return;
  reader.value.loadDocument(editor.getDocument());
  // 文档（含元数据）变更 → 顶部书名等派生值重新取值
  bookVersion.value += 1;
  // 位置记忆：回定位到编辑退出时的视口页（新文档页数可能变少，限幅后再跳）
  const target = Math.min(editorVisiblePage.value, reader.value.totalPages - 1);
  if (target >= 0) reader.value.goToPage(target);
  // 取消挂起的合并落盘并立即写一轮（不等待：退出编辑的界面响应优先）
  void autosave.flush();
  mode.value = 'read';
  // 文档变更 → 重测新文档块尺寸（旧 id 映射对新文档不适用）
  scheduleRemeasure();
}

/** 还原样册：编辑器内容重置为原始样例并清除草稿 */
async function resetSample(): Promise<void> {
  autosave.reset();
  bookEditor.value?.loadDocument(lunyuDocument);
  void clearDraft();
  // 还原样册 = 回到《论语》，切回其设置作用域并重新载入
  await switchBook(LUNYU_BOOK_ID);
}

/**
 * 切换书籍：先把当前书已提交的配置落盘（flush 用的是切换前的 bookScope），
 * 再切到新书 id 并载入其设置、应用到画布（布局 / 令牌 / 功能样式随之更新）。
 */
async function switchBook(newId: string): Promise<void> {
  await styleApi.flush();
  currentBookId.value = newId;
  await styleApi.load();
  scheduleRemeasure();
}

/**
 * 目录点击：阅读态经 BtToc 内置的 reader.goToNode 跳页（Reader 即当前可见视图）；
 * 编辑态主区是 BtEditor（Reader 隐藏），需把目录项导向编辑器——否则点目录「无反应」。
 * 节点存在才跳转（nodeId 为 undefined 时跳过）。
 */
function onTocSelect(item: OutlineItem): void {
  if (mode.value === 'edit' && btEditorRef.value !== null) {
    btEditorRef.value.goToNode(item.nodeId ?? '');
  }
}

/** 导入文档：载入阅读预览，若编辑器已建则同步内容（loadDocument 重置脏基准），并落盘草稿 + 重排 */
async function onImported(doc: BookDocument): Promise<void> {
  reader.value.loadDocument(doc);
  // 新文档（含元数据）载入 → 顶部书名等派生值重新取值
  bookVersion.value += 1;
  if (bookEditor.value === null) {
    // 编辑器尚未创建（进入编辑模式才惰性创建）：autosave 只能序列化已存在的编辑器，
    // 若此处不落盘，enterEdit 从 IndexedDB 读到的仍是导入前的旧草稿，编辑区标题与正文
    // 会显示成旧书。故导入书直接作为草稿基线写入，确保惰性创建的编辑器载入的是新书。
    dirty.value = false;
    await draftStore.save(DRAFT_ID, doc);
  } else {
    bookEditor.value.loadDocument(doc);
    dirty.value = bookEditor.value.isDirty;
    // 新内容立即落盘（导入即新基线；跳过「无待写」判定）
    void autosave.flush({ force: true });
  }
  // 切到导入书的设置作用域（落盘旧书设置 + 载入新书设置并应用）
  await switchBook(bookIdFromTitle(doc.metadata.title));
  scheduleRemeasure();
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
  const fontToken = activeFontToken.value;
  const layout = effectiveLayout.value;
  const book = reader.value.document ?? lunyuDocument;
  /* 导出前校验（epubcheck 规则子集）：error 级问题在此汇总提示，
     避免「自研阅读器能开、京东读书 / 微信读书打不开」的兼容黑洞。 */
  const problems: ValidationProblem[] = [];
  const bytes = exportEpub(book, {
    layout,
    tokens: tokens.value,
    fontToken,
    features: features.value,
    namedStyles: namedStyles.value,
    onValidation: (list) => {
      problems.push(...list);
    },
  });
  download('论语.epub', new Blob([new Uint8Array(bytes)], { type: 'application/epub+zip' }));
  reportExportProblems(problems);
}

/**
 * 导出校验结果 → 消息条
 *
 * 无问题：一条「已导出 EPUB」成功提示；有问题：按 error / warning 给不同语气，
 * 并把前 3 条明细带进文案（完整清单仍逐条打印到 console）。
 * 不再写顶栏状态行：那条文案会一直挂着，把顶栏挤成两行。
 */
function reportExportProblems(problems: readonly ValidationProblem[]): void {
  if (problems.length === 0) {
    pushToast('已导出 EPUB（校验通过）', 'success');
    return;
  }
  const errors = problems.filter((p) => p.severity === 'error');
  const head = errors.length > 0 ? `导出校验 ${errors.length} 个错误` : '导出校验通过（有警告）';
  const detail = problems
    .slice(0, 3)
    .map((p) => `${p.severity === 'error' ? '✕' : '!'} ${p.message}`)
    .join('；');
  pushToast(
    `${head}：${detail}${problems.length > 3 ? ` 等 ${problems.length} 项` : ''}`,
    errors.length > 0 ? 'error' : 'info',
  );
  for (const p of problems) {
    const line = `[epub-export] ${p.severity} ${p.code}: ${p.message}${p.path !== undefined ? ` (${p.path})` : ''}`;
    if (p.severity === 'error') console.error(line);
    else console.warn(line);
  }
}

/**
 * 宿主注入的 PDF 导出桥（Electron preload 挂载到 window.electronPdf）
 *
 * 契约见 docs/08-export-pdf.md：主进程以离屏窗口加载自包含 HTML 后
 * `webContents.printToPDF()`，经 IPC 回传 PDF 字节。浏览器无此桥。
 */
interface ElectronPdfBridge {
  exportPdf(html: string, options?: PdfAdapterOptions): Promise<Uint8Array>;
}

declare global {
  interface Window {
    electronPdf?: ElectronPdfBridge;
  }
}

/** 宿主 PDF 桥（Electron 注入；浏览器为 undefined → 走降级） */
function getElectronPdfBridge(): ElectronPdfBridge | undefined {
  return typeof window !== 'undefined' ? window.electronPdf : undefined;
}

/**
 * 导出 PDF（替代原「打印 PDF」）
 *
 * 两条路径：
 * - **Electron 宿主**（window.electronPdf）：自包含 HTML（inline 图片）→
 *   宿主 printToPDF → PDF 字节直接下载。秒级、无对话框、矢量文本；
 * - **浏览器降级**：blob 化去重（重复 data URI 归一为 blob URL，HTML 与
 *   解码负担同步大降）→ 隐藏 iframe + window.print()。受 Chromium 打印
 *   管线限制，大书仍需数十秒。
 *
 * 分页模式（pdfPagedMode）：逐页（paged，与屏幕预览逐页同源）/ 连续（auto，更快）。
 */
async function onExportPdf(): Promise<void> {
  const fontToken = activeFontToken.value;
  const book = reader.value.document ?? lunyuDocument;
  const base = {
    layout: effectiveLayout.value,
    tokens: tokens.value,
    fontToken,
    features: features.value,
    namedStyles: namedStyles.value,
    mode: (pdfPagedMode.value ? 'paged' : 'auto') as 'paged' | 'auto',
  };
  /* 逐页模式附带屏幕实测数据（与预览同源）；连续模式由打印引擎分页 */
  const measured =
    base.mode === 'paged'
      ? {
          pageMainSize: pageMainSize.value,
          bottomSlack: bottomSlack.value,
          context: typographyMeasure(),
          blockSizes: blockSizes.value,
          lineOffsets: blockLineOffsets.value,
          lineSizes: blockLineSizes.value,
          bodySizes: blockBodySizes.value,
        }
      : {};

  pdfExporting.value = true;
  try {
    const bridge = getElectronPdfBridge();
    if (bridge !== undefined) {
      /* adapter 路径：自包含 HTML（不传 rewriteSrc，离屏窗口拿不到 blob: URL） */
      const bytes = await exportPdfBytes(book, {
        ...base,
        ...measured,
        adapter: { toPdf: (html, opts) => bridge.exportPdf(html, opts) },
      });
      downloadPdf(bytes, `${book.metadata.title || '书籍'}.pdf`);
      pushToast('已导出 PDF（Electron 打印引擎）', 'success');
      return;
    }

    /* 降级路径：blob 化去重 + iframe 打印 */
    const rewriter = createImageBlobRewriter();
    try {
      const html = renderPrintHtml(book, { ...base, ...measured, rewriteSrc: rewriter.rewrite });
      printHtml(html, { onAfterPrint: () => rewriter.revokeAll() });
      pushToast(
        `已打开打印对话框，请选择「另存为 PDF」；${rewriter.uniqueCount} 张唯一图片已去重，大书需数十秒`,
        'info',
        8000,
      );
    } catch (error) {
      rewriter.revokeAll();
      throw error;
    }
  } catch (error) {
    pushToast(`导出 PDF 失败：${error instanceof Error ? error.message : String(error)}`, 'error');
  } finally {
    pdfExporting.value = false;
  }
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

/** 左栏标签面板（同屏仅一个，参照主流阅读器；null = 整栏收起） */
type AsideTab = 'toc' | 'search' | 'bookmarks' | 'import';

const activeTab = ref<AsideTab | null>('toc');
/** 顶栏 tab 入口（顺序与左栏面板一致） */
const ASIDE_TABS: ReadonlyArray<{ key: AsideTab; label: string }> = [
  { key: 'toc', label: '目录' },
  { key: 'search', label: '搜索' },
  { key: 'bookmarks', label: '书签' },
  { key: 'import', label: '导入' },
];
/** 顶栏 tab 入口：点已开项即收起，否则切换 */
function toggleTab(tab: AsideTab): void {
  activeTab.value = activeTab.value === tab ? null : tab;
}

const settingsOpen = ref(false);
const infoOpen = ref(false);

/** 关闭设置弹窗：未保存的草稿改动直接丢弃（仅「保存」才生效） */
function closeSettings(): void {
  settingsOpen.value = false;
  styleApi.discardDraft();
}

/** 捕获 BtEditor 默认插槽透传的 paged 感知 binding（供右栏属性检视器） */
const slotBinding = shallowRef<EditorBinding | null>(null);
/** 插槽渲染计数（非响应式；仅用于识别「首轮捕获」，避免逐事务重渲染） */
let slotRenderCount = 0;
function captureSlotBinding(binding: EditorBinding): EditorBinding {
  slotRenderCount += 1;
  if (slotBinding.value === null && slotRenderCount === 1) {
    // 首次捕获：同步递增 version 让消费它的 computed 失效（仅在 null→有值时发生一次）
    binding.version.value += 1;
  }
  slotBinding.value = binding;
  return binding;
}

/**
 * 右栏检视器用的 binding
 *
 * 仅「未捕获 → 已捕获」一次切换会重渲染主区（slot 内容随之重建）；
 * 之后逐事务只走 version 自增，由 AttrInspector 内部 computed 自行响应。
 */
const inspectorBinding = computed<EditorBinding | null>(() => {
  if (slotBinding.value === null && mode.value === 'edit') {
    void slotRenderCount; // 占位依赖：首次捕获前的空读不再触发额外逻辑
  }
  return mode.value === 'edit' ? slotBinding.value : null;
});

/* 导出 / 导入等**操作后**的一次性反馈走右下角消息条（composables/use-toast）：
   顶栏只承担书名与常驻状态，不再追加会长期滞留、挤占排版的状态行。 */
const { items: toasts, push: pushToast, dismiss: dismissToast } = useToast();

/*
 * 原先写在顶栏标题旁的用法说明，改挂到对应按钮的悬浮卡片上
 * （顶栏是放书名的，不该长期占着两行操作提示）。
 */

/** 「编辑 / 保存并预览」按钮的悬浮说明（原：编辑模式 · 自动保存 · Ctrl/Cmd+S…） */
const MODE_USAGE: ToolbarUsage = {
  use: '进入编辑模式（分页画布编辑）；再点「保存并预览」回阅读态',
  where: '编辑内容自动存入本地草稿；保存并预览会先落盘再刷新阅读视图',
  key: 'Ctrl/Cmd+S 立即保存',
  limit: '编辑态 ← / → 交给编辑器移动光标，不翻页',
};

/** 「单页翻页 / 滚动翻页」按钮的悬浮说明（原：←/→ 翻页） */
const VIEW_MODE_USAGE: ToolbarUsage = {
  use: '在「单页翻页」与「连续滚动多页」之间切换',
  where: '阅读态用 ← / → 翻页；连续模式也可用滚轮上下浏览',
  key: '← / →',
  limit: '编辑态不生效（方向键归编辑器）',
};

/** PDF 导出是否进行中（按钮置灰 + 文案切换） */
const pdfExporting = ref(false);
/** PDF 分页模式：true = 逐页（paged，与屏幕预览同源）/ false = 连续（auto，更快） */
const pdfPagedMode = ref(true);

/** 信息弹窗可编辑：仅编辑模式下（元数据写入 BookEditor.updateMetadata） */
const infoEditable = computed(() => mode.value === 'edit' && bookEditor.value !== null);

/** 当前元数据：编辑态取编辑器实时快照，阅读态取 Reader 文档（缺省样章） */
const currentMetadata = computed<BookMetadata>(() => {
  /* 显式依赖：实例内部变更不走响应式，靠版本号自增让它失效（见 bookVersion） */
  void bookVersion.value;
  return (
    (mode.value === 'edit' && bookEditor.value !== null
      ? bookEditor.value.getMetadata()
      : reader.value.document?.metadata) ?? lunyuDocument.metadata
  );
});

/** 顶部书名的兜底值（元数据缺失标题时使用） */
const DEFAULT_BOOK_TITLE = '论语集解';

/** 顶部书名：优先书籍元数据标题（编辑态随编辑器实时刷新），缺失 / 空白回退默认 */
const bookTitle = computed<string>(() => {
  const title = currentMetadata.value.title?.trim() ?? '';
  return title === '' ? DEFAULT_BOOK_TITLE : title;
});

/** 元数据保存：写回编辑器（合并补丁 + 自动刷新 updatedAt）；阅读态不可达 */
function onMetadataSave(patch: Partial<BookMetadata>): void {
  bookEditor.value?.updateMetadata(patch);
  // 元数据变更 → 顶部书名 / 书籍信息弹窗重新取值
  bookVersion.value += 1;
}

/** 左栏是否可见（有任一 tab 激活；设置 / 书籍信息为弹窗不占左栏） */
const asideVisible = computed(() => activeTab.value !== null);

function onKeydown(event: KeyboardEvent): void {
  /* 编辑模式 Ctrl/Cmd+S：立即落盘（拦截浏览器「保存网页」默认行为） */
  if (
    mode.value === 'edit' &&
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    event.key.toLowerCase() === 's'
  ) {
    event.preventDefault();
    void saveNow();
    return;
  }
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
  if (infoOpen.value) {
    if (event.key === 'Escape') infoOpen.value = false;
    return;
  }
  /* 设置弹窗为模态：Esc 关闭（丢弃未保存改动），其余按键不外泄（避免背景页被翻页） */
  if (settingsOpen.value) {
    if (event.key === 'Escape') closeSettings();
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

/** 页面转入后台（切标签 / 最小化）：立即落盘，把握住真正能写完的时机 */
function onVisibilityChange(): void {
  if (document.visibilityState === 'hidden') void autosave.flush();
}

/** 存在未保存变更时离开页面提示（并尽力落盘一轮） */
function onBeforeUnload(event: BeforeUnloadEvent): void {
  if (!dirty.value) return;
  void autosave.flush();
  event.preventDefault();
  event.returnValue = '';
}

onMounted(async () => {
  window.addEventListener('keydown', onKeydown);
  window.addEventListener('beforeunload', onBeforeUnload);
  document.addEventListener('visibilitychange', onVisibilityChange);
  // 开发期性能探针：控制台用 __btPerf.report() 看「重排 vs 落盘」耗时分布
  if (import.meta.env.DEV) perfProbe = installPerfProbe();
  // 恢复上次会话内容，据此确定本书 id（草稿若是导入的书，沿用其设置作用域，避免混用）
  const draft = await readDraft();
  const initialDoc = draft ?? reader.value.document ?? lunyuDocument;
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
  document.removeEventListener('visibilitychange', onVisibilityChange);
  removeToolbarDragListeners();
  if (measureTimer !== undefined) clearTimeout(measureTimer);
  perfProbe?.stop();
  perfProbe = null;
  unsubscribeEditor?.();
  unsubscribeEditor = null;
  unsubscribePage?.();
  unsubscribePage = null;
  // 先等在飞落盘结束再关连接（避免关库打断正在提交的事务）
  void autosave
    .dispose()
    .then(() => draftStore.close())
    .catch(() => undefined);
  disposeMeasureSheet();
});
</script>

<template>
  <div
    class="app"
    :class="{
      'app--night': night,
      'app--rail': verticalRail,
    }"
  >
    <header class="toolbar">
      <div class="toolbar__title">
        <button
          type="button"
          class="toolbar__book"
          title="查看书籍信息"
          @click="infoOpen = true"
        >
          <span class="toolbar__book-icon" aria-hidden="true">📖</span>
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
            :class="{ 'toolbar__button--active': settingsOpen }"
            @click="settingsOpen = !settingsOpen"
          >
            设置
          </button>
        </div>
        <div class="toolbar__group">
          <button
            v-for="tab in ASIDE_TABS"
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
            :disabled="pdfExporting"
            @click="onExportPdf"
          >
            {{ pdfExporting ? '导出中…' : '导出 PDF' }}
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
    </header>

    <!--
      直排编辑态设置列组：编辑工具条的三行 → 第二 / 三 / 四列（属性栏已移出，
      独立为状态栏左侧的附加列；横排时工具条在画布上方，故直排时从原位移入此处）。
      列序自左向右对偶横排行序自上而下：顶栏 → 工具条三行 → 属性栏 → 状态栏。
    -->
    <div v-if="verticalRail && mode === 'edit' && inspectorBinding" class="app__rail">
      <template v-if="mode === 'edit' && inspectorBinding">
        <EditorToolbar
          :binding="inspectorBinding"
          :readonly="editorReadonly"
          @toggle-readonly="styleApi.patchEditingDirect({ readonly: !editing.readonly })"
          @reset="resetSample"
        />
      </template>
    </div>

    <div class="app__body">
      <aside v-show="asideVisible" class="app__aside">
        <SearchPanel
          v-if="activeTab === 'search'"
          :key="`search-${themeKey}-${readerEpoch}`"
          :reader="reader"
          @close="activeTab = null"
        />
        <BookmarkPanel
          v-if="activeTab === 'bookmarks'"
          :key="`bookmark-${themeKey}-${readerEpoch}`"
          :reader="reader"
          @close="activeTab = null"
        />
        <ImportPanel
          v-if="activeTab === 'import'"
          @close="activeTab = null"
          @imported="onImported"
        />
        <div v-show="activeTab === 'toc'" class="app__toc">
          <BtToc :key="`toc-${themeKey}-${readerEpoch}`" :reader="reader" @select="onTocSelect" />
        </div>
      </aside>

      <main class="app__main">
        <div ref="editorStageRef" class="app__stage">
          <BtBookView
            v-if="booted && mode === 'read'"
            :key="`${themeKey}-${readerEpoch}`"
            :reader="reader"
            :tokens="tokens"
            :font-token="activeFontToken"
            :features="features"
            :named-styles="namedStyles"
            :mode="viewMode"
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
                v-if="!verticalRail"
                :binding="captureSlotBinding(slotProps)"
                :readonly="editorReadonly"
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

        <!-- 编辑态右栏：属性检视器（横排置右且可折叠为细条；直排时整块已移入左侧设置列） -->
        <aside
          v-if="!verticalRail && mode === 'edit' && inspectorBinding"
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
      v-if="verticalRail && mode === 'edit' && inspectorBinding"
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

    <!-- 底部状态栏：阅读态 = 进度 + 翻页 + 视图切换；编辑态 = 页码读数 + 缩放 -->
    <footer v-if="booted" class="statusbar">
      <template v-if="mode === 'read'">
        <div class="statusbar__cluster">
          <ProgressBar :key="`${themeKey}-${readerEpoch}`" class="statusbar__progress" :reader="reader" />
          <BtPager :key="`${themeKey}-${readerEpoch}`" class="statusbar__pager" :reader="reader" />
        </div>
        <div class="statusbar__cluster">
          <ToolbarUsageTip :usage="VIEW_MODE_USAGE">
            <button
              type="button"
              class="statusbar__button"
              :class="{ 'statusbar__button--on': viewMode === 'scroll' }"
              @click="viewMode = viewMode === 'page' ? 'scroll' : 'page'"
            >
              {{ viewMode === 'page' ? '滚动翻页' : '单页翻页' }}
            </button>
          </ToolbarUsageTip>
        </div>
      </template>
      <template v-else>
        <span class="statusbar__readout">第 {{ editorVisiblePage + 1 }} 页</span>
        <span class="statusbar__spacer" />
        <div class="statusbar__cluster">
          <button
            type="button"
            class="statusbar__button"
            title="缩小"
            @click="zoomStep(-0.1)"
          >
            −
          </button>
          <span class="statusbar__zoom">{{ Math.round(editorScale * 100) }}%</span>
          <button
            type="button"
            class="statusbar__button"
            title="放大"
            @click="zoomStep(0.1)"
          >
            +
          </button>
          <button
            type="button"
            class="statusbar__button"
            title="恢复 100%"
            @click="editorScale = 1"
          >
            100%
          </button>
          <button
            type="button"
            class="statusbar__button"
            :title="verticalRail ? '按高度缩放整页' : '按宽度缩放整页'"
            @click="fitEditorWidth"
          >
            {{ verticalRail ? '适应高度' : '适应宽度' }}
          </button>
        </div>
      </template>
    </footer>

    <SettingsPanel
      v-if="settingsOpen"
      :api="styleApi"
      :layout="effectiveLayout"
      :tokens="tokens"
      :night="night"
      @update:night="night = $event; persistSettingsSnapshot()"
      @close="closeSettings"
    />

    <BookInfoDialog
      v-if="infoOpen"
      :metadata="currentMetadata"
      :editable="infoEditable"
      @save="onMetadataSave"
      @close="infoOpen = false"
    />

    <AppToast :items="toasts" @dismiss="dismissToast" />
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

/* ---------- 顶栏（应用栏） ---------- */

.toolbar {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 7px 16px;
  border-block-end: 1px solid var(--demo-border);
  background: var(--demo-panel);
  color: var(--demo-text);
}

.toolbar__title {
  display: flex;
  flex: none;
  align-items: center;
  gap: 10px;
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
  border-radius: 6px;
  cursor: pointer;
}

.toolbar__book:hover {
  background: rgba(127, 127, 127, 0.12);
  border-color: var(--demo-control-border);
}

.toolbar__book strong {
  font-size: 16px;
  letter-spacing: 0.08em;
}

.toolbar__book-icon {
  font-size: 14px;
  opacity: 0.75;
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

/* 组间分隔线（Word / Chrome 工具栏惯例，替代纯间距） */
.toolbar__group + .toolbar__group {
  padding-inline-start: 12px;
  border-inline-start: 1px solid var(--demo-control-border);
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
  width: 280px;
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
  flex-direction: row;
  min-width: 0;
  background: var(--demo-bg);
}

.app__stage {
  flex: 1;
  min-width: 0;
  min-height: 0;
  padding: 20px;
}

.app__editor {
  height: 100%;
}

/* 编辑态右栏：属性检视器列（与左栏同宽级，纵向流式）；宽度变更带过渡，折叠后只留把手 */
.app__inspector {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: 6px;
  width: 280px;
  overflow-y: auto;
  border-inline-start: 1px solid var(--demo-border);
  background: var(--demo-aside);
  color: var(--demo-text);
  transition: width 0.16s ease;
}

.app__inspector--collapsed {
  width: 30px;
  overflow: hidden;
}

/* 折叠把手：栏首右上角小方块，与控件制式（ghost 按钮）一致 */
.app__inspector__toggle {
  flex: none;
  align-self: flex-start;
  width: 22px;
  height: 22px;
  margin: 4px 4px 0;
  padding: 0;
  border: 1px solid var(--demo-control-border);
  border-radius: 4px;
  background: var(--demo-control);
  color: var(--demo-muted);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
}

.app__inspector__toggle:hover {
  color: var(--demo-accent);
  border-color: var(--demo-accent);
}

/* ---------- 底部状态栏 ---------- */

.statusbar {
  display: flex;
  flex: none;
  align-items: center;
  gap: 14px;
  padding: 5px 16px;
  border-block-start: 1px solid var(--demo-border);
  background: var(--demo-panel);
  color: var(--demo-text);
  font-size: 12px;
}

.statusbar__progress {
  flex: 1;
  min-width: 120px;
}

/* 进度条与翻页读数二选一：状态栏已有页码，隐翻页器文字段 */
.statusbar__pager :deep(.bt-pager__status) {
  display: none;
}

.statusbar__spacer {
  flex: 1;
}

.statusbar__readout {
  flex: none;
  color: var(--demo-muted);
  white-space: nowrap;
}

.statusbar__zoom {
  flex: none;
  min-width: 40px;
  text-align: center;
  color: var(--demo-muted);
  font-variant-numeric: tabular-nums;
}

/* 缩放 / 视图控件分组：平时 contents 对父级 flex 完全透明，直排时才成换行子盒 */
.statusbar__cluster {
  display: contents;
}

.statusbar__button {
  flex: none;
  padding: 2px 10px;
  font-size: 12px;
  color: var(--demo-text);
  background: transparent;
  border: 1px solid var(--demo-control-border);
  border-radius: 4px;
  cursor: pointer;
}

.statusbar__button:hover {
  border-color: var(--demo-accent);
  color: var(--demo-accent);
}

.statusbar__button--on {
  color: var(--demo-accent);
  border-color: var(--demo-accent);
}

/* ---------- 直排：横排的每一「行」转成一条通高竖「列」 ---------- *
 * 横排外壳共五行：顶栏 / 编辑工具条三行 / 状态栏。直排（.app--rail）不改内容，只把这五行
 * 整体旋 90°→ 五条通高竖列横向并排，任何一块都不再上下堆叠；列序自左向右还原横排的
 * 自上而下：①顶栏 → ②③④工具条三行 → ⑤状态栏（属性栏为附加列插在状态栏左侧，
 * 展开查找替换时再在其左侧多一列）。
 * grid 列（物理左 → 右）：编辑态 = 顶栏 | 工具条列组 | 属性栏 | 状态栏 | 主区；
 * 阅读态（无编辑列）= 顶栏 | 状态栏 | 主区。
 *
 * 实现口径：
 * 1. 面板外壳（.toolbar / .app__rail / .editor-toolbar）自身仍是 horizontal-tb 的 flex row，
 *    职责只是「把若干竖列横向并排」；真正的转置下沉到每一「行」级元素（.toolbar__title、
 *    .toolbar__actions、.editor-toolbar__row、.statusbar、.app__inspector--rail），由它们
 *    writing-mode: vertical-rl —— 转置后 flex 的 main axis 变垂直，row 即「自上而下」。
 * 2. 每列固定宽度（对偶于横排每行固定行高），列内项目按内容排，装不下就沿列方向滚动
 *    （对偶于横排行内横向滚动）→ flex-wrap 一律 nowrap，滚动轴是物理纵向 = overflow-y。
 * 3. vertical-rl 下逻辑边映射：block-start = 物理右、block-end = 物理左、
 *    inline-start = 物理上、inline-end = 物理下；组间分隔线（基线写的是逻辑属性）因此
 *    自动从竖线变横线，无需逐处重给；padding 是物理值，需按竖条重给。
 * 4. 例外：原生表单控件（input / select）无法竖写文字，局部回退 horizontal-tb。
 */
.app--rail {
  display: grid;
  /* 各设置列带（宽度 = 各自固定列宽之和）+ 主区吃掉剩余宽度 */
  grid-template-columns: auto auto auto auto minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
}

/* 第五列：状态栏（横排最底一行）紧邻书页左侧 */
.app--rail .statusbar {
  grid-column: 4;
  grid-row: 1;
}

/* 附加列：属性栏（横排在主区右侧，不属五行），置于状态栏左侧 */
.app--rail .app__inspector--rail {
  grid-column: 3;
  grid-row: 1;
}

/* 第二 ~ 四列：编辑工具条三行 */
.app--rail .app__rail {
  grid-column: 2;
  grid-row: 1;
}

/* 第一列：顶栏（书名 + 全局动作） */
.app--rail .toolbar {
  grid-column: 1;
  grid-row: 1;
}

/* 主区（正文 + 目录面板）占满设置列右侧的全部宽高 */
.app--rail .app__body {
  grid-column: 5;
  grid-row: 1;
  min-width: 0;
}

/* 标签面板（目录 / 搜索 / 书签 / 导入）仍在主区内侧向展开：窄窗时收窄，不挤掉书页 */
.app--rail .app__aside {
  width: min(280px, 46%);
}

/* 顶栏外壳：自身不转置，只把「书名列」与「按钮列」横向并排成两条竖列 */
.app--rail .toolbar {
  flex-direction: row;
  align-items: stretch;
  justify-content: flex-start;
  gap: 0;
  min-height: 0;
  padding: 8px 6px;
  overflow: hidden;
  /* 基线 border-block-end（横排底边）→ 与主区的分隔改挂物理右缘 */
  border-block-end: 0;
  border-inline-end: 1px solid var(--demo-border);
}

/* 书名 / 保存状态：一条竖列，自上而下，超长沿列滚动 */
.app--rail .toolbar__title {
  writing-mode: vertical-rl;
  flex: none;
  width: 38px;
  gap: 8px;
  overflow-x: hidden;
  overflow-y: auto;
}

/* 书名 chip 的 padding 同为物理值：竖列里左右 = 竖条宽度，需收窄到 38px 列宽内 */
.app--rail .toolbar__book {
  padding: 4px 6px;
}

.app--rail .toolbar__book strong {
  line-height: 1.7;
  letter-spacing: 0.1em;
}

/* 按钮 padding 是物理值：竖排下左右 = 竖条宽度、上下 = 字距方向留白 */
.app--rail .toolbar__button {
  padding: 8px 4px;
  line-height: 1.5;
  letter-spacing: 0.06em;
}

/* 按钮区：一条竖列，四组自上而下相接（组间基线 border-inline-start 转置后即为横线） */
.app--rail .toolbar__actions {
  writing-mode: vertical-rl;
  flex: none;
  width: 46px;
  flex-direction: row;
  flex-wrap: nowrap;
  align-items: stretch;
  justify-content: flex-start;
  gap: 8px;
  /* block-end = 物理左 → 此处即与书名列的竖分隔线 */
  padding-block-end: 6px;
  border-block-end: 1px solid var(--demo-border);
  overflow-x: hidden;
  overflow-y: auto;
}

/* 基线的首组外边距 auto（横排靠右）转置后会把按钮推向列底 → 归零 */
.app--rail .toolbar__actions > .toolbar__group:first-child {
  margin-inline-start: 0;
}

/* 滚动条从横向改到纵向（基线规则给的是 height） */
.app--rail .toolbar__actions::-webkit-scrollbar {
  width: 6px;
  height: auto;
}

/* 编辑态设置列组外壳：工具条三列 + 查找替换列横向并排（自身不转置；属性栏已独立成 grid 项） */
.app__rail {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  min-height: 0;
  overflow: hidden;
  border-inline-end: 1px solid var(--demo-border);
  background: var(--demo-panel);
  color: var(--demo-text);
  font-size: 12px;
}

/* 工具条外壳：column（横排三行堆叠）→ row（三条竖列并排） */
.app__rail :deep(.editor-toolbar) {
  flex-direction: row;
  align-items: stretch;
  border-block-end: 0;
}

/* 每一行 = 一条通高竖列：固定宽度、向下排、溢出沿列滚动 */
.app__rail :deep(.editor-toolbar__row) {
  writing-mode: vertical-rl;
  flex: none;
  width: 38px;
  padding: 8px 4px;
  overflow-x: hidden;
  overflow-y: auto;
}

/* 行与行的分隔：基线 border-block-start 转置后 = 物理右缘，正好是列间竖线 */
.app__rail :deep(.editor-toolbar__row::-webkit-scrollbar) {
  width: 6px;
  height: auto;
}

.app__rail :deep(.editor-toolbar__button) {
  padding: 8px 3px;
  line-height: 1.5;
  letter-spacing: 0.06em;
}

/* 查找替换面板同样成一条竖列（横排它是画布上方的一条横带） */
.app__rail :deep(.replace) {
  writing-mode: vertical-rl;
  flex: none;
  flex-direction: row;
  align-self: flex-start;
  width: 44px;
  margin-inline-start: 8px;
}

/* 属性栏：横排是主区右侧的一栏 → 直排独立成状态栏左侧的附加竖列 */
.app__inspector--rail {
  writing-mode: vertical-rl;
  flex-direction: row;
  flex: none;
  width: 100px;
  padding: 8px 6px;
  overflow-x: hidden;
  overflow-y: auto;
  border-inline-start: 0;
  background: var(--demo-aside);
  color: var(--demo-text);
  font-size: 12px;
}

.app__inspector--rail.app__inspector--collapsed {
  width: 34px;
  padding: 8px 4px;
}

.app__inspector--rail .app__inspector__toggle {
  width: auto;
  height: auto;
  margin: 0 0 6px;
  padding: 6px 3px;
  font-size: 12px;
}

/* 展开态不占额外位置：折叠只需点把手，直排下隐藏「折叠」按钮（收起态仍显示「展开」） */
.app__inspector--rail:not(.app__inspector--collapsed) .app__inspector__toggle {
  display: none;
}

/* 内部各层基线都是「纵向堆叠」的 column，而转置后 column = 水平→ 需改 row 才仍是向下堆叠 */
.app__inspector--rail :deep(.inspector) {
  flex-direction: row;
  align-items: stretch;
  gap: 8px;
  padding: 4px 0 0;
}

.app__inspector--rail :deep(.inspector__header) {
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  gap: 6px;
  padding-block-end: 0;
  padding-inline-end: 6px;
  border-block-end: 0;
  border-inline-end: 1px solid var(--demo-border);
}

.app__inspector--rail :deep(.inspector__group) {
  flex-direction: row;
  align-items: stretch;
  gap: 6px;
  padding: 6px 8px;
}

.app__inspector--rail :deep(.inspector__field) {
  flex-direction: row;
  align-items: stretch;
  gap: 2px;
}

.app__inspector--rail :deep(.inspector__label),
.app__inspector--rail :deep(.inspector__title),
.app__inspector--rail :deep(.inspector__empty) {
  line-height: 1.6;
  letter-spacing: 0.06em;
}

.app__inspector--rail :deep(.inspector__tag) {
  align-self: center;
  padding: 1px 4px;
}

/* 原生控件不能竖写文字 → 局部回退 horizontal-tb，宽度随列宽自适应 */
.app__inspector--rail :deep(.inspector__input),
.app__inspector--rail :deep(.inspector__field select),
.app__inspector--rail :deep(.inspector__input--num) {
  writing-mode: horizontal-tb;
  width: 100%;
  min-width: 0;
}

/* 状态栏：横排最底一行 → 最左一条通高竖列（进度 / 翻页 / 视图切换自上而下） */
.app--rail .statusbar {
  writing-mode: vertical-rl;
  flex-direction: row;
  flex-wrap: nowrap;
  align-items: center;
  gap: 8px;
  width: 46px;
  padding: 8px 4px;
  overflow-x: hidden;
  overflow-y: auto;
  /* 基线 border-block-start（横排顶边）转置后 = 物理右缘 → 正好是与右侧列带的分隔 */
}

.app--rail .statusbar::-webkit-scrollbar {
  width: 6px;
}

.app--rail .statusbar__spacer {
  display: none;
}

/* 进度条：长度沿列方向给（横排靠 flex: 1 吃掉行宽）；轨道与填充已改用逻辑尺寸→自动转竖 */
.app--rail .statusbar__progress {
  flex: none;
  min-width: 0;
  height: 15vh;
  min-height: 90px;
}

.app--rail .statusbar__zoom {
  min-width: 0;
}

.app--rail .statusbar__button,
.app--rail .statusbar__readout,
.app--rail :deep(.bt-pager__button) {
  padding: 8px 4px;
  line-height: 1.5;
  letter-spacing: 0.06em;
}

.app--rail :deep(.bt-pager) {
  gap: 8px;
}

.app--rail :deep(.progress__text) {
  line-height: 1.6;
}

/* 直排下的 binding 捕获锚点：不可见不占位，仅在属性求值时顺带完成捕获 */
.app__binding-anchor {
  display: none;
}

/* 画布上方原工具条插槽位整体收起（工具条已入左列，display:none 连带去掉 BtEditor 的行间距） */
.app--rail :deep(.bt-editor__toolbar) {
  display: none;
}
</style>
