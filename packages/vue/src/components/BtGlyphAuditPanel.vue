<script setup lang="ts">
/**
 * 缺字审计面板（K6）
 *
 * 展示 `useGlyphAudit()` 的结果：缺字字符、码位、能否 IDS 合成、上下文与
 * IR 路径。纯展示组件，不发命令、不写存储。
 */
import type { GlyphIssue } from '@bibliotype/core';
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    /** 缺字条目 */
    issues: readonly GlyphIssue[];
    /** 标题 */
    title?: string;
    /** 最多展示条数（缺省 40，避免长书卡顿） */
    maxItems?: number;
    /** 空态文案 */
    emptyText?: string;
  }>(),
  {
    title: '缺字检查',
    maxItems: 40,
    emptyText: '当前字体链未发现缺字',
  },
);

const visible = computed(() => props.issues.slice(0, Math.max(0, props.maxItems)));
const hiddenCount = computed(() => Math.max(0, props.issues.length - visible.value.length));
const tofuCount = computed(() => props.issues.filter((item) => item.stage === 'tofu').length);

function stageLabel(stage: GlyphIssue['stage']): string {
  return stage === 'ids' ? '可合成' : '缺字';
}
</script>

<template>
  <section class="bt-glyph-audit" aria-label="缺字审计">
    <header class="bt-glyph-audit__head">
      <span class="bt-glyph-audit__title">{{ props.title }}</span>
      <span v-if="props.issues.length > 0" class="bt-glyph-audit__count">
        {{ props.issues.length }} 处
      </span>
      <span v-else class="bt-glyph-audit__ok">通过</span>
    </header>

    <p v-if="props.issues.length > 0" class="bt-glyph-audit__hint">
      其中 {{ tofuCount }} 处无可回退字形，导出后阅读器会显示豆腐块；可先在字体链补字，
      或为宿主登记 IDS 描述。
    </p>

    <ul v-if="visible.length > 0" class="bt-glyph-audit__list">
      <li v-for="(item, index) in visible" :key="`${item.char}-${index}`" class="bt-glyph-audit__item">
        <span class="bt-glyph-audit__char" aria-hidden="true">{{ item.char }}</span>
        <span class="bt-glyph-audit__code">{{ item.code }}</span>
        <span
          class="bt-glyph-audit__stage"
          :class="`bt-glyph-audit__stage--${item.stage}`"
        >
          {{ stageLabel(item.stage) }}
        </span>
        <span class="bt-glyph-audit__context" :title="item.context">{{ item.context }}</span>
        <span class="bt-glyph-audit__path">位置 {{ item.path || '根' }}</span>
      </li>
    </ul>

    <p v-else class="bt-glyph-audit__empty">{{ props.emptyText }}</p>

    <p v-if="hiddenCount > 0" class="bt-glyph-audit__more">
      另有 {{ hiddenCount }} 处未展示（可在导出报告中查看完整清单）
    </p>
  </section>
</template>

<style scoped>
.bt-glyph-audit {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  border: 1px solid rgba(127, 127, 127, 0.24);
  border-radius: 8px;
  background: var(--bt-color-background, #faf8f4);
  color: var(--bt-color-text, #2c2c2c);
  font-size: 13px;
}

.bt-glyph-audit__head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.bt-glyph-audit__title {
  font-weight: 600;
}

.bt-glyph-audit__count {
  padding: 0 6px;
  border-radius: 9px;
  background: color-mix(in srgb, var(--bt-color-accent, #8c5a2b) 16%, transparent);
  color: var(--bt-color-accent, #8c5a2b);
  font-size: 11px;
  line-height: 18px;
}

.bt-glyph-audit__ok {
  color: var(--bt-color-note-text, #6b6b6b);
  font-size: 12px;
}

.bt-glyph-audit__hint {
  margin: 0;
  color: var(--bt-color-note-text, #6b6b6b);
  font-size: 12px;
  line-height: 1.5;
}

.bt-glyph-audit__list {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin: 0;
  padding: 0;
  max-height: 260px;
  overflow-y: auto;
  list-style: none;
}

.bt-glyph-audit__item {
  display: grid;
  grid-template-columns: auto auto auto minmax(0, 1fr) auto;
  gap: 6px;
  align-items: center;
  padding: 3px 4px;
  border-radius: 4px;
}

.bt-glyph-audit__item:hover {
  background: color-mix(in srgb, var(--bt-color-accent, #8c5a2b) 6%, transparent);
}

.bt-glyph-audit__char {
  min-width: 1.4em;
  font-size: 18px;
  line-height: 1.2;
  text-align: center;
}

.bt-glyph-audit__code {
  color: var(--bt-color-note-text, #6b6b6b);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.bt-glyph-audit__stage {
  padding: 0 5px;
  border-radius: 4px;
  font-size: 11px;
  line-height: 17px;
}

/* 可合成：低对比提示色（不抢注意力，能显示即可） */
.bt-glyph-audit__stage--ids {
  background: color-mix(in srgb, var(--bt-color-note-text, #6b6b6b) 16%, transparent);
  color: var(--bt-color-note-text, #6b6b6b);
}

/* 真缺字：用强调色标出（换主题仍可辨识），不放硬编码红 */
.bt-glyph-audit__stage--tofu {
  background: color-mix(in srgb, var(--bt-color-accent, #8c5a2b) 24%, transparent);
  color: var(--bt-color-accent, #8c5a2b);
  font-weight: 600;
}

.bt-glyph-audit__context {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bt-glyph-audit__path {
  color: var(--bt-color-note-text, #6b6b6b);
  font-size: 11px;
}

.bt-glyph-audit__empty {
  margin: 0;
  padding: 10px 0;
  color: var(--bt-color-note-text, #6b6b6b);
  font-size: 12px;
  text-align: center;
}

.bt-glyph-audit__more {
  margin: 0;
  color: var(--bt-color-note-text, #6b6b6b);
  font-size: 11px;
}
</style>
