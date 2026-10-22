<script setup lang="ts">
/**
 * 搜索面板（Demo 组件，左栏 tab 面板）
 *
 * 关键词 → Reader.search 全文检索（逐叶块）；结果展示摘录（命中词高亮）/
 * 页码 / 命中数；点击经 goToNode 跳转所在页。
 * 面板不再自带关闭按钮：开关由左栏 tab 体系承担（再点顶栏「搜索」即收起）。
 */
import { ref } from 'vue';
import type { Reader, ReaderSearchResult } from '@bibliotype/reader';

const props = defineProps<{ reader: Reader }>();
defineEmits<{ close: [] }>();

const query = ref('');
const results = ref<ReaderSearchResult[]>([]);
const searched = ref(false);

/** 执行检索（去空白；空词重置） */
function run(): void {
  const keyword = query.value.trim();
  if (keyword === '') {
    results.value = [];
    searched.value = false;
    return;
  }
  results.value = props.reader.search(keyword);
  searched.value = true;
}

/** 清空输入与结果 */
function clear(): void {
  query.value = '';
  results.value = [];
  searched.value = false;
}

/** 跳转命中块所在页 */
function goTo(result: ReaderSearchResult): void {
  props.reader.goToNode(result.nodeId);
}

/** 摘录分段：命中词高亮（与 Reader.search 同为字面匹配） */
function excerptParts(text: string): ReadonlyArray<{ text: string; hit: boolean }> {
  const keyword = query.value.trim();
  if (keyword === '') return [{ text, hit: false }];
  const parts: Array<{ text: string; hit: boolean }> = [];
  let rest = text;
  for (;;) {
    const index = rest.indexOf(keyword);
    if (index === -1) {
      if (rest !== '') parts.push({ text: rest, hit: false });
      break;
    }
    if (index > 0) parts.push({ text: rest.slice(0, index), hit: false });
    parts.push({ text: keyword, hit: true });
    rest = rest.slice(index + keyword.length);
  }
  return parts;
}
</script>

<template>
  <section class="panel">
    <header class="panel__header">
      <h2 class="panel__title">搜索</h2>
    </header>

    <div class="panel__searchbar">
      <input
        v-model="query"
        type="search"
        class="panel__input"
        placeholder="检索正文（如：君子）"
        @keyup.enter="run"
      />
      <button type="button" class="panel__submit" @click="run">检索</button>
    </div>

    <p v-if="searched && results.length === 0" class="panel__empty">无匹配结果</p>
    <p v-else-if="searched" class="panel__count">
      共 {{ results.length }} 块命中<template v-if="results.length >= 50">（已达上限 50）</template>
    </p>

    <ul class="panel__list">
      <li v-for="result in results" :key="result.nodeId" class="panel__item">
        <button type="button" class="panel__result" @click="goTo(result)">
          <span class="panel__excerpt">
            <template v-for="(part, index) in excerptParts(result.excerpt)" :key="index">
              <mark v-if="part.hit" class="panel__hit">{{ part.text }}</mark>
              <template v-else>{{ part.text }}</template>
            </template>
          </span>
          <span class="panel__meta">
            第 {{ result.pageIndex + 1 }} 页 · 命中 {{ result.matchCount }} 处
          </span>
        </button>
      </li>
    </ul>

    <button
      v-if="searched && results.length > 0"
      type="button"
      class="panel__clear"
      @click="clear"
    >
      清空结果
    </button>
  </section>
</template>

<style scoped>
/*
 * 侧栏面板统一制式（美化 P3）
 *
 * 与设置面板 / 「更多」sheet 同源：输入框 36px（触屏 40px）、按钮胶囊化、
 * 行高 32px、分隔线走 `--ui-divider`；颜色全取 `--ui-*`，切皮肤即跟手。
 */
.panel {
  padding: var(--ui-space-3, 8px) var(--ui-space-4, 12px) var(--ui-space-5, 20px);
  border-block-end: 1px solid var(--ui-divider, #d8d2c4);
}

.panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-block-end: var(--ui-space-3, 8px);
}

.panel__title {
  margin: 0;
  font-size: var(--ui-font-xs, 11px);
  font-weight: 600;
  letter-spacing: 0.18em;
  color: var(--ui-text-muted, #7f7a6d);
}

.panel__searchbar {
  display: flex;
  gap: var(--ui-space-2, 6px);
}

.panel__input {
  flex: 1;
  min-width: 0;
  min-height: 36px;
  padding: 5px var(--ui-space-3, 8px);
  font-size: var(--ui-font-md, 13px);
  color: var(--ui-text, #3c3a34);
  background: var(--ui-surface-raised, #faf8f4);
  border: var(--ui-border-width, 1px) solid var(--ui-border, #e2ddd2);
  border-radius: var(--ui-radius-sm, 8px);
  transition: border-color var(--ui-dur-fast, 120ms) var(--ui-ease, ease);
}

.panel__input:hover {
  border-color: var(--ui-accent, #8c5a2b);
}

.panel__submit {
  flex: none;
  min-height: 36px;
  padding: 5px 14px;
  font-size: var(--ui-font-sm, 12px);
  color: var(--ui-on-accent, #fff);
  background: var(--ui-accent, #8c5a2b);
  border: 0;
  border-radius: var(--ui-radius-pill, 999px);
  cursor: pointer;
  transition: background var(--ui-dur-fast, 120ms) var(--ui-ease, ease);
}

.panel__submit:hover {
  background: var(--ui-accent-strong, #734721);
}

.panel__empty,
.panel__count {
  margin: var(--ui-space-3, 8px) 0 0;
  font-size: var(--ui-font-sm, 12px);
  color: var(--ui-text-muted, #7f7a6d);
}

.panel__list {
  list-style: none;
  margin: var(--ui-space-2, 6px) 0 0;
  padding: 0;
}

.panel__item + .panel__item {
  margin-block-start: 2px;
}

.panel__result {
  display: block;
  width: 100%;
  min-height: 32px;
  padding: 6px var(--ui-space-3, 8px);
  font: inherit;
  color: inherit;
  text-align: start;
  background: none;
  border: 0;
  border-radius: var(--ui-radius-sm, 8px);
  cursor: pointer;
  transition: background var(--ui-dur-fast, 120ms) var(--ui-ease, ease);
}

.panel__result:hover {
  background: var(--ui-accent-weak, rgba(127, 127, 127, 0.12));
}

.panel__excerpt {
  display: block;
  font-size: var(--ui-font-md, 13px);
  line-height: 1.6;
}

/* 命中高亮：用 accent 轻色块，深色皮肤下不会像写死米黄那样刺眼 */
.panel__hit {
  padding: 0 1px;
  color: inherit;
  background: var(--ui-accent-weak, rgba(201, 154, 91, 0.4));
  border-radius: var(--ui-radius-xs, 4px);
}

.panel__meta {
  display: block;
  margin-block-start: 2px;
  font-size: var(--ui-font-xs, 11px);
  color: var(--ui-text-muted, #7f7a6d);
}

.panel__clear {
  display: block;
  margin: var(--ui-space-3, 8px) auto 0;
  padding: 3px 12px;
  min-height: 30px;
  font-size: var(--ui-font-sm, 12px);
  color: var(--ui-text-muted, #7f7a6d);
  background: none;
  border: var(--ui-border-width, 1px) solid var(--ui-border, #e2ddd2);
  border-radius: var(--ui-radius-pill, 999px);
  cursor: pointer;
  transition:
    color var(--ui-dur-fast, 120ms) var(--ui-ease, ease),
    border-color var(--ui-dur-fast, 120ms) var(--ui-ease, ease);
}

.panel__clear:hover {
  color: var(--ui-accent, #8c5a2b);
  border-color: var(--ui-accent, #8c5a2b);
}

/* 触屏：侧栏控件顶到 40 / 44px，避免 320px 宽抽屉里点不准 */
@media (pointer: coarse) {
  .panel__input,
  .panel__submit {
    min-height: 40px;
  }

  .panel__result {
    min-height: 44px;
  }
}
</style>
