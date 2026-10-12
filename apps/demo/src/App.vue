<script setup lang="ts">
/**
 * Demo 主界面（App）
 *
 * - 工具栏：主题切换（现代横排 ↔ 古籍直排）/ 书籍信息 / 搜索 / 书签 / 目录 /
 *   字号 / 行距 / 夜间 / 导出 EPUB / 打印 PDF；
 * - 左栏：搜索面板、书签面板、目录（可分别开关）；
 * - 主区：BtBookView（等比缩放自适应）+ 进度条 + BtPager；
 * - 键盘：← / → 翻页；Esc 关闭书籍信息弹窗。
 *
 * 字号 / 行距 = 双通道联动：tokens（视觉字号行高）+ repaginate measure
 * （分页估算的行尺寸），保证「所见分页」与「所得排版」一致；
 * 主题切换重建 Reader（loadDocument 全链路重排），字号 / 行距变更原地重排。
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import {
  COLOR_TOKENS,
  DEFAULT_THEME,
  FONT_SIZE_TOKENS,
  FONT_TOKENS,
  LAYOUT_TOKENS,
} from '@bibliotype/core';
import { CLASSICAL_THEME_OVERRIDES } from '@bibliotype/classical';
import {
  CLASSICAL_LAYOUT_OPTIONS,
  DEFAULT_LAYOUT_OPTIONS,
  type LayoutOptions,
} from '@bibliotype/layout';
import { Reader, type BlockMeasureContext } from '@bibliotype/reader';
import { BtBookView, BtPager, BtToc } from '@bibliotype/vue';
import { exportEpub } from '@bibliotype/exporter-epub';
import { printBook } from '@bibliotype/exporter-pdf';
import BookInfoDialog from './components/BookInfoDialog.vue';
import BookmarkPanel from './components/BookmarkPanel.vue';
import ProgressBar from './components/ProgressBar.vue';
import SearchPanel from './components/SearchPanel.vue';
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

/* ---------------- 排版设置（字号 / 行距 / 夜间） ---------------- */

const FONT_SIZE_MIN = 12;
const FONT_SIZE_MAX = 24;
const FONT_SIZE_STEP = 2;

/** 正文字号（px，tokens 视觉 + measure 估算联动） */
const fontSize = ref(16);
/** 行距档位 */
const LINE_HEIGHT_STEPS = [1.6, 1.9, 2.2] as const;
type LineHeightStep = (typeof LINE_HEIGHT_STEPS)[number];
const lineHeight = ref<LineHeightStep>(1.9);
/** 夜间阅读（仅覆盖阅读区配色令牌，不动布局） */
const night = ref(false);

/** 夜间配色覆盖（正文 / 背景 / 注文 / 强调） */
const NIGHT_COLORS: Readonly<Record<string, string>> = {
  [COLOR_TOKENS.BACKGROUND]: '#171614',
  [COLOR_TOKENS.TEXT]: '#cec9c0',
  [COLOR_TOKENS.NOTE_TEXT]: '#8f897d',
  [COLOR_TOKENS.ACCENT]: '#c99a5b',
};

/** 当前生效令牌：主题基础 + 字号 / 行距 + 夜间覆盖 */
const tokens = computed<Readonly<Record<string, string | undefined>>>(() => ({
  ...theme.value.tokens,
  [FONT_SIZE_TOKENS.BODY]: `${fontSize.value}px`,
  [LAYOUT_TOKENS.LINE_HEIGHT]: String(lineHeight.value),
  ...(night.value ? NIGHT_COLORS : {}),
}));

/** 字号步进（clamp 到 [12, 24]） */
function stepFont(delta: number): void {
  fontSize.value = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, fontSize.value + delta));
}

/** 行距循环切换（紧凑 1.6 → 标准 1.9 → 宽松 2.2） */
function cycleLineHeight(): void {
  const index = LINE_HEIGHT_STEPS.indexOf(lineHeight.value);
  const next = LINE_HEIGHT_STEPS[(index + 1) % LINE_HEIGHT_STEPS.length];
  if (next !== undefined) lineHeight.value = next;
}

/* ---------------- Reader（主题切换时重建） ---------------- */

/**
 * 估算上下文（与字号 / 行距联动）
 *
 * 基准：16px 字号 × 1.9 行距 ≈ 26 字/行、行尺寸 30px（见 DEFAULT_MEASURE_CONTEXT）；
 * 字号↑ → 每行字数↓；行尺寸 = 字号 × 行距。
 */
function typographyMeasure(): Partial<BlockMeasureContext> {
  return {
    charsPerLine: Math.max(1, Math.round((26 * 16) / fontSize.value)),
    lineSize: Math.round(fontSize.value * lineHeight.value),
  };
}

/** 创建已载入样例的 Reader（loadDocument 触发全链路分页，按当前排版估算） */
function createReader(key: ThemeKey): Reader {
  const reader = new Reader({ layout: THEMES[key].layout, measure: typographyMeasure() });
  reader.loadDocument(lunyuDocument);
  return reader;
}

const reader = shallowRef<Reader>(createReader('modern'));

/** 字号 / 行距变更：原地重排（保持当前页，视觉由 tokens 联动） */
watch([fontSize, lineHeight], () => {
  reader.value.repaginate({ measure: typographyMeasure() });
});

function switchTheme(key: ThemeKey): void {
  if (key === themeKey.value) return;
  themeKey.value = key;
  /* 重建 Reader 验证重排链路；组件以 themeKey 为 key 随之重建 */
  reader.value = createReader(key);
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

/** 导出 EPUB（按当前主题、字号行距与配色令牌，所见即所得） */
function onExportEpub(): void {
  const { layout, fontToken } = theme.value;
  const bytes = exportEpub(lunyuDocument, { layout, tokens: tokens.value, fontToken });
  download('论语.epub', new Blob([new Uint8Array(bytes)], { type: 'application/epub+zip' }));
}

/** 打印 / 另存 PDF（paged 预分页，与屏幕分页一致） */
function onPrintPdf(): void {
  const { layout, fontToken } = theme.value;
  printBook(lunyuDocument, { layout, tokens: tokens.value, fontToken, mode: 'paged' });
}

/* ---------------- 面板与键盘 ---------------- */

const tocOpen = ref(true);
const searchOpen = ref(false);
const bookmarksOpen = ref(false);
const infoOpen = ref(false);

/** 左栏是否有任一区块可见 */
const asideVisible = computed(() => searchOpen.value || bookmarksOpen.value || tocOpen.value);

function onKeydown(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
  if (infoOpen.value) {
    if (event.key === 'Escape') infoOpen.value = false;
    return;
  }
  if (event.key === 'ArrowLeft') {
    reader.value.prevPage();
  } else if (event.key === 'ArrowRight') {
    reader.value.nextPage();
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <div class="app" :class="{ 'app--night': night }">
    <header class="toolbar">
      <div class="toolbar__title">
        <strong>论语集解</strong>
        <span class="toolbar__hint">bibliotype 阅读 Demo · ←/→ 翻页</span>
      </div>
      <div class="toolbar__actions">
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
            :class="{ 'toolbar__button--active': tocOpen }"
            @click="tocOpen = !tocOpen"
          >
            目录
          </button>
        </div>
        <div class="toolbar__group">
          <button
            type="button"
            class="toolbar__button"
            aria-label="减小字号"
            :disabled="fontSize <= FONT_SIZE_MIN"
            @click="stepFont(-FONT_SIZE_STEP)"
          >
            A−
          </button>
          <span class="toolbar__readout">{{ fontSize }}px</span>
          <button
            type="button"
            class="toolbar__button"
            aria-label="增大字号"
            :disabled="fontSize >= FONT_SIZE_MAX"
            @click="stepFont(FONT_SIZE_STEP)"
          >
            A＋
          </button>
          <button type="button" class="toolbar__button" @click="cycleLineHeight">
            行距 {{ lineHeight.toFixed(1) }}
          </button>
          <button
            type="button"
            class="toolbar__button"
            :class="{ 'toolbar__button--active': night }"
            @click="night = !night"
          >
            {{ night ? '日间' : '夜间' }}
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
        <div v-show="tocOpen" class="app__toc">
          <BtToc :key="`toc-${themeKey}`" :reader="reader" />
        </div>
      </aside>

      <main class="app__main">
        <div class="app__stage">
          <BtBookView
            :key="themeKey"
            :reader="reader"
            :tokens="tokens"
            :font-token="theme.fontToken"
          />
        </div>
        <footer class="app__footer">
          <ProgressBar :key="themeKey" :reader="reader" />
          <BtPager :key="themeKey" :reader="reader" />
        </footer>
      </main>
    </div>

    <BookInfoDialog
      v-if="infoOpen"
      :metadata="lunyuDocument.metadata"
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

.toolbar__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px 14px;
}

.toolbar__group {
  display: flex;
  align-items: center;
  gap: 6px;
}

.toolbar__readout {
  min-width: 36px;
  font-size: 12px;
  text-align: center;
  color: var(--demo-muted);
}

.toolbar__button {
  padding: 5px 11px;
  font-size: 13px;
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
</style>
