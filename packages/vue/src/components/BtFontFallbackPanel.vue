<script setup lang="ts">
/**
 * 字体回退链调试面板（BtFontFallbackPanel）
 *
 * 逐字显示「实际命中的字体族」，全链未命中的字标红并给出 Unicode 码位；
 * 私用区字符单独提示（换字体必然错字）。探测走 `document.fonts.check`，
 * 环境不支持时降级为「全部命中」，不会出现整屏假缺字。
 *
 * 面板只读：不做字体加载，也不修改令牌。
 */
import { computed } from 'vue';
import { analyzeGlyphCoverage, type GlyphProbe } from '@bibliotype/core';
import { createFontCheckProbe } from '../font-probe.js';

const props = withDefaults(
  defineProps<{
    /** 待检查文本（可传章节正文；内部按码位去重） */
    text: string;
    /** 字体回退链（CSS `font-family` 顺序） */
    families: readonly string[];
    /** 自定义探测（缺省基于 document.fonts.check） */
    probe?: GlyphProbe;
    /** 最多检查的字符数（防御超长章节；缺省 240） */
    maxChars?: number;
    /** 面板标题 */
    title?: string;
  }>(),
  {
    probe: undefined,
    maxChars: 240,
    title: '字体回退调试',
  },
);

/** 缺省探测惰性创建一次（避免每次重算都重新包一层闭包） */
const defaultProbe = createFontCheckProbe();
const activeProbe = computed<GlyphProbe>(() => props.probe ?? defaultProbe);

const report = computed(() =>
  analyzeGlyphCoverage(props.text.slice(0, props.maxChars), props.families, activeProbe.value),
);

/** 面板上只展示前 20 条缺字码位，避免长列表淹没界面 */
const missingCodes = computed(() => report.value.missing.slice(0, 20));

const summary = computed(() =>
  report.value.total === 0
    ? '没有可检查的字符'
    : `共 ${report.value.total} 字 · 缺 ${report.value.missingCount} 字`,
);
</script>

<template>
  <section class="bt-font-fallback" aria-label="字体回退调试">
    <header class="bt-font-fallback__head">
      <h3 class="bt-font-fallback__title">{{ title }}</h3>
      <span class="bt-font-fallback__summary">{{ summary }}</span>
    </header>

    <p v-if="families.length === 0" class="bt-font-fallback__hint">
      未配置字体回退链：令牌 <code>font-family-body</code> 为空。
    </p>
    <ul v-else class="bt-font-fallback__chain">
      <li v-for="(family, index) in families" :key="`${family}-${index}`" class="bt-font-fallback__family">
        <span class="bt-font-fallback__order">{{ index + 1 }}</span>
        {{ family }}
      </li>
    </ul>

    <ul v-if="report.entries.length > 0" class="bt-font-fallback__grid">
      <li
        v-for="entry in report.entries"
        :key="entry.code"
        class="bt-font-fallback__cell"
        :class="{
          'bt-font-fallback__cell--missing': entry.missing,
          'bt-font-fallback__cell--private': entry.privateUse,
        }"
        :title="`${entry.code}${entry.privateUse ? ' · 私用区' : ''} · ${entry.family ?? '缺字'}`"
      >
        <span class="bt-font-fallback__char">{{ entry.char }}</span>
        <span class="bt-font-fallback__code">{{ entry.code }}</span>
      </li>
    </ul>

    <div v-if="report.missingCount > 0" class="bt-font-fallback__missing" role="alert">
      <p class="bt-font-fallback__missing-title">缺字（浏览器会画空白 / 豆腐块）</p>
      <p class="bt-font-fallback__missing-list">
        <span v-for="entry in missingCodes" :key="entry.code" class="bt-font-fallback__missing-item">
          {{ entry.char }} {{ entry.code }}
        </span>
        <span v-if="report.missingCount > missingCodes.length" class="bt-font-fallback__more">
          等 {{ report.missingCount }} 字
        </span>
      </p>
    </div>
  </section>
</template>

<style scoped>
.bt-font-fallback {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 12px;
  color: var(--bt-color-text, #2c2c2c);
}

.bt-font-fallback__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.bt-font-fallback__title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}

.bt-font-fallback__summary {
  color: var(--bt-color-note-text, #6b6b6b);
}

.bt-font-fallback__hint {
  margin: 0;
  color: #b4553a;
}

.bt-font-fallback__chain {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.bt-font-fallback__family {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px 2px 4px;
  border: 1px solid rgba(127, 127, 127, 0.24);
  border-radius: 999px;
  color: var(--bt-color-note-text, #6b6b6b);
}

.bt-font-fallback__order {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: rgba(127, 127, 127, 0.16);
  font-size: 11px;
}

.bt-font-fallback__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(56px, 1fr));
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.bt-font-fallback__cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 6px 2px;
  border: 1px solid rgba(127, 127, 127, 0.2);
  border-radius: 6px;
  background: rgba(127, 127, 127, 0.04);
}

.bt-font-fallback__cell--missing {
  border-color: #b4553a;
  background: rgba(180, 85, 58, 0.08);
}

.bt-font-fallback__cell--private:not(.bt-font-fallback__cell--missing) {
  border-style: dashed;
  border-color: #c9a227;
}

.bt-font-fallback__char {
  font-size: 18px;
  line-height: 1.2;
}

.bt-font-fallback__code {
  color: var(--bt-color-note-text, #6b6b6b);
  font-family: var(--bt-font-family-mono, ui-monospace, monospace);
  font-size: 10px;
}

.bt-font-fallback__missing {
  padding: 8px 10px;
  border-radius: 6px;
  background: rgba(180, 85, 58, 0.08);
  color: #b4553a;
}

.bt-font-fallback__missing-title {
  margin: 0 0 4px;
  font-weight: 600;
}

.bt-font-fallback__missing-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  margin: 0;
  font-family: var(--bt-font-family-mono, ui-monospace, monospace);
  font-size: 11px;
}

.bt-font-fallback__more {
  opacity: 0.75;
}

/* H5（C2）：全屏模态内控件触控目标 ≥44px */
@media (pointer: coarse) {
  .bt-font-fallback button,
  .bt-font-fallback input,
  .bt-font-fallback select {
    min-height: var(--bt-touch-target, 44px);
  }
}
</style>
