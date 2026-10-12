<script setup lang="ts">
/**
 * Demo 主界面（App）
 *
 * - 工具栏：书名 / 主题切换（现代横排 ↔ 古籍直排）/ 目录开关 / 导出 EPUB / 打印 PDF；
 * - 主区：BtBookView（等比缩放自适应）+ 进度条 + BtPager；
 * - 侧栏：BtToc 目录（点击跳转）；
 * - 键盘：← / → 翻页。
 *
 * 主题切换 = 重建 Reader（loadDocument → extractBlocks → paginate 全链路重排），
 * 并以 themeKey 为 key 重建各阅读组件，使其重新绑定事件桥。
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import { DEFAULT_THEME, FONT_TOKENS } from '@bibliotype/core';
import { CLASSICAL_THEME_OVERRIDES } from '@bibliotype/classical';
import {
  CLASSICAL_LAYOUT_OPTIONS,
  DEFAULT_LAYOUT_OPTIONS,
  type LayoutOptions,
} from '@bibliotype/layout';
import { Reader } from '@bibliotype/reader';
import { BtBookView, BtPager, BtToc } from '@bibliotype/vue';
import { exportEpub } from '@bibliotype/exporter-epub';
import { printBook } from '@bibliotype/exporter-pdf';
import ProgressBar from './components/ProgressBar.vue';
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

/** 古籍直排：16 开直排 + 古典令牌覆盖（楷体系字体、无首行缩进、直排策略） */
const CLASSICAL_THEME: ThemeConfig = {
  label: '古籍直排',
  layout: CLASSICAL_LAYOUT_OPTIONS,
  tokens: { ...DEFAULT_THEME, ...CLASSICAL_THEME_OVERRIDES },
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

/* ---------------- Reader（主题切换时重建） ---------------- */

/** 创建已载入样例的 Reader（loadDocument 触发全链路分页） */
function createReader(key: ThemeKey): Reader {
  const reader = new Reader({ layout: THEMES[key].layout });
  reader.loadDocument(lunyuDocument);
  return reader;
}

const reader = shallowRef<Reader>(createReader('modern'));

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

/** 导出 EPUB（按当前主题的布局与令牌） */
function onExportEpub(): void {
  const { layout, tokens, fontToken } = theme.value;
  const bytes = exportEpub(lunyuDocument, { layout, tokens, fontToken });
  download('论语.epub', new Blob([new Uint8Array(bytes)], { type: 'application/epub+zip' }));
}

/** 打印 / 另存 PDF（paged 预分页，与屏幕分页一致） */
function onPrintPdf(): void {
  const { layout, tokens, fontToken } = theme.value;
  printBook(lunyuDocument, { layout, tokens, fontToken, mode: 'paged' });
}

/* ---------------- 目录抽屉与键盘 ---------------- */

const tocOpen = ref(true);

function onKeydown(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
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
  <div class="app">
    <header class="toolbar">
      <div class="toolbar__title">
        <strong>论语</strong>
        <span class="toolbar__hint">bibliotype 阅读 Demo · ←/→ 翻页</span>
      </div>
      <div class="toolbar__actions">
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
        <button type="button" class="toolbar__button" @click="tocOpen = !tocOpen">
          {{ tocOpen ? '收起目录' : '展开目录' }}
        </button>
        <button type="button" class="toolbar__button" @click="onExportEpub">导出 EPUB</button>
        <button type="button" class="toolbar__button" @click="onPrintPdf">打印 PDF</button>
      </div>
    </header>

    <div class="app__body">
      <aside v-show="tocOpen" class="app__aside">
        <BtToc :key="themeKey" :reader="reader" />
      </aside>

      <main class="app__main">
        <div class="app__stage">
          <BtBookView
            :key="themeKey"
            :reader="reader"
            :tokens="theme.tokens"
            :font-token="theme.fontToken"
          />
        </div>
        <footer class="app__footer">
          <ProgressBar :key="themeKey" :reader="reader" />
          <BtPager :key="themeKey" :reader="reader" />
        </footer>
      </main>
    </div>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

/* ---------- 工具栏 ---------- */

.toolbar {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 16px;
  border-block-end: 1px solid #e2ddd2;
  background: #f4f0e8;
}

.toolbar__title {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.toolbar__title strong {
  font-size: 18px;
  letter-spacing: 0.1em;
}

.toolbar__hint {
  font-size: 12px;
  color: #8a8578;
}

.toolbar__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.toolbar__button {
  padding: 6px 12px;
  font-size: 13px;
  color: #3c3a34;
  background: #fbf9f4;
  border: 1px solid #d8d2c4;
  border-radius: 4px;
  cursor: pointer;
}

.toolbar__button:hover {
  border-color: #8c5a2b;
  color: #8c5a2b;
}

.toolbar__button--active {
  color: #fff;
  background: #8c5a2b;
  border-color: #8c5a2b;
}

/* ---------- 主体布局 ---------- */

.app__body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.app__aside {
  flex: none;
  width: 240px;
  overflow-y: auto;
  border-inline-end: 1px solid #e2ddd2;
  background: #faf8f4;
}

.app__main {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  background: #efe9dd;
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
  border-block-start: 1px solid #e2ddd2;
  background: #f4f0e8;
}
</style>
