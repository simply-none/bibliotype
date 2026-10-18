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
.panel {
  padding: 10px 12px 14px;
  border-block-end: 1px solid var(--demo-border, #e2ddd2);
}

.panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-block-end: 8px;
}

.panel__title {
  margin: 0;
  font-size: 13px;
  letter-spacing: 0.2em;
  color: var(--demo-text, #3c3a34);
}

.panel__searchbar {
  display: flex;
  gap: 6px;
}

.panel__input {
  flex: 1;
  min-width: 0;
  padding: 5px 8px;
  font-size: 13px;
  color: inherit;
  background: var(--demo-control, #fbf9f4);
  border: 1px solid var(--demo-control-border, #d8d2c4);
  border-radius: 4px;
}

.panel__submit {
  flex: none;
  padding: 5px 10px;
  font-size: 12px;
  color: #fff;
  background: var(--demo-accent, #8c5a2b);
  border: 0;
  border-radius: 4px;
  cursor: pointer;
}

.panel__empty,
.panel__count {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--demo-muted, #8a8578);
}

.panel__list {
  list-style: none;
  margin: 6px 0 0;
  padding: 0;
}

.panel__item + .panel__item {
  margin-block-start: 4px;
}

.panel__result {
  display: block;
  width: 100%;
  padding: 6px 8px;
  font: inherit;
  color: inherit;
  text-align: start;
  background: none;
  border: 0;
  border-radius: 4px;
  cursor: pointer;
}

.panel__result:hover {
  background: rgba(127, 127, 127, 0.12);
}

.panel__excerpt {
  display: block;
  font-size: 12.5px;
  line-height: 1.6;
}

.panel__hit {
  padding: 0 1px;
  color: inherit;
  background: rgba(201, 154, 91, 0.4);
  border-radius: 2px;
}

.panel__meta {
  display: block;
  margin-block-start: 2px;
  font-size: 11px;
  color: var(--demo-muted, #8a8578);
}

.panel__clear {
  display: block;
  margin: 8px auto 0;
  padding: 3px 10px;
  font-size: 12px;
  color: var(--demo-muted, #8a8578);
  background: none;
  border: 1px solid var(--demo-control-border, #d8d2c4);
  border-radius: 4px;
  cursor: pointer;
}

.panel__clear:hover {
  color: var(--demo-accent, #8c5a2b);
  border-color: var(--demo-accent, #8c5a2b);
}
</style>
