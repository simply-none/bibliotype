<script setup lang="ts">
/**
 * 校勘并排对照（K2）
 *
 * 只做阅读层：按 `pairId` 从 IR 筛出底本 / 校本段落，左右并排（`columns`）
 * 或双页（`facing`），悬浮 / 聚焦一侧时同一配对的两侧同步高亮。
 * 不新建排版内核——分页、注文、样式全部沿用既有 Reader / layout。
 *
 * H5（C5）：窄屏（< md 768px）双栏改上下堆叠，校本栏的分隔线由竖转横，
 * 保证 375px 宽下两侧都完整可读。
 */
import { computed, ref } from 'vue';
import { isTextNode, type BookNode } from '@bibliotype/core';
import { serializeNode } from '@bibliotype/layout/html';
import type { Reader } from '@bibliotype/reader';
import BtSpreadLayout from './BtSpreadLayout.vue';
import { useBreakpoint } from '../use-breakpoint.js';
import { BT_BREAKPOINTS } from '../breakpoints.js';

/** 校勘标记（classical 插件节点，vue 不直接依赖该包，按 IR 类型名识别） */
const COLLATION_MARK = 'collation-mark';

interface CompareSide {
  blockId: string;
  text: string;
  html: string;
}

interface ComparePair {
  pairId: string;
  base?: CompareSide;
  variant?: CompareSide;
}

const props = withDefaults(
  defineProps<{
    /** 阅读器实例（取当前文档） */
    reader: Reader;
    /** 只看某个配对（缺省展示全部配对） */
    pairId?: string;
    /** 并排形态：columns 双栏 / facing 双页 */
    mode?: 'columns' | 'facing';
  }>(),
  { mode: 'columns' },
);

/** 当前高亮配对 */
const activePairId = ref<string | null>(null);

/** 窄屏堆叠（C5） */
const breakpoint = useBreakpoint();
const stacked = computed(() => breakpoint.width.value < BT_BREAKPOINTS.md);

/** 块内是否含指定配对的校勘标记（含角色） */
function markRoleOf(node: BookNode): { pairId: string; role: string | null } | undefined {
  let found: { pairId: string; role: string | null } | undefined;
  const walk = (current: BookNode): void => {
    if (found !== undefined) return;
    if (current.type === COLLATION_MARK) {
      const pairId = current.attrs?.['pairId'];
      if (typeof pairId === 'string' && pairId !== '') {
        const role = current.attrs?.['role'];
        found = { pairId, role: typeof role === 'string' ? role : null };
        return;
      }
    }
    for (const child of current.children ?? []) walk(child);
  };
  walk(node);
  return found;
}

/** 块纯文本 */
function plainText(node: BookNode): string {
  if (isTextNode(node)) return node.text ?? '';
  return (node.children ?? []).map(plainText).join('');
}

/** 全部配对（无配对时按单侧条目兜底展示） */
const pairs = computed<ComparePair[]>(() => {
  const document = props.reader.document;
  if (document === undefined) return [];

  const grouped = new Map<string, ComparePair>();

  const walk = (node: BookNode): void => {
    if (isTextNode(node)) return;
    const mark = markRoleOf(node);
    if (mark !== undefined && (props.pairId === undefined || props.pairId === mark.pairId)) {
      const side: CompareSide = {
        blockId: typeof node.id === 'string' ? node.id : '',
        text: plainText(node).trim(),
        html: serializeNode(node),
      };
      const pair = grouped.get(mark.pairId) ?? { pairId: mark.pairId };
      if (mark.role === 'variant') pair.variant = side;
      else pair.base = side;
      grouped.set(mark.pairId, pair);
      return;
    }
    for (const child of node.children ?? []) walk(child);
  };

  walk(document.root);

  /* 只有一侧时仍展示，便于发现「配了一半」的数据 */
  return [...grouped.values()]
    .filter((pair) => pair.base !== undefined || pair.variant !== undefined)
    .sort((left, right) => left.pairId.localeCompare(right.pairId));
});

/** 当前是否高亮（同一 pairId 两侧同时命中） */
function isLinked(pairId: string): boolean {
  return activePairId.value === pairId;
}

function activate(pairId: string): void {
  activePairId.value = pairId;
}

function deactivate(): void {
  activePairId.value = null;
}

/** 单侧缺内容时的占位（提示配对不完整） */
const EMPTY_SIDE = '（本侧无校勘标记）';
</script>

<template>
  <section
    class="bt-collation-compare"
    :class="{ 'bt-collation-compare--stacked': stacked }"
    :data-mode="mode"
    :data-stacked="stacked ? 'true' : undefined"
    aria-label="校勘对照"
  >
    <div v-if="pairs.length === 0" class="bt-collation-compare__empty">
      当前文档没有可对照的校勘配对。
    </div>
    <article
      v-for="pair in pairs"
      :key="pair.pairId"
      class="bt-collation-compare__pair"
      :class="{ 'is-linked': isLinked(pair.pairId) }"
      :data-pair-id="pair.pairId"
      @mouseenter="activate(pair.pairId)"
      @mouseleave="deactivate"
      @focusin="activate(pair.pairId)"
      @focusout="deactivate"
    >
      <!-- 对页模式：复用双栏 / 对页通用容器（中缝 + 标签），结构容器类与 data-role 不变 -->
      <BtSpreadLayout
        v-if="mode === 'facing'"
        mode="facing"
        left-label="底本"
        right-label="校本"
      >
        <template #left>
          <div class="bt-collation-compare__pane" data-role="base">
            <div v-if="pair.base !== undefined" v-html="pair.base.html"></div>
            <p v-else class="bt-collation-compare__placeholder">{{ EMPTY_SIDE }}</p>
          </div>
        </template>
        <template #right>
          <div class="bt-collation-compare__pane" data-role="variant">
            <div v-if="pair.variant !== undefined" v-html="pair.variant.html"></div>
            <p v-else class="bt-collation-compare__placeholder">{{ EMPTY_SIDE }}</p>
          </div>
        </template>
      </BtSpreadLayout>

      <!-- 并列双栏：保持原有网格布局 -->
      <template v-else>
        <div class="bt-collation-compare__pane" data-role="base">
          <div v-if="pair.base !== undefined" v-html="pair.base.html"></div>
          <p v-else class="bt-collation-compare__placeholder">{{ EMPTY_SIDE }}</p>
        </div>
        <div class="bt-collation-compare__pane" data-role="variant">
          <div v-if="pair.variant !== undefined" v-html="pair.variant.html"></div>
          <p v-else class="bt-collation-compare__placeholder">{{ EMPTY_SIDE }}</p>
        </div>
      </template>
    </article>
  </section>
</template>

<style scoped>
.bt-collation-compare {
  display: flex;
  flex-direction: column;
  gap: 1.2em;
}

.bt-collation-compare__pair {
  padding: 0.6em 0.8em;
  border-radius: 4px;
  transition: background-color 0.15s ease;
}

/* 并列双栏：两栏网格由本组件控制（对页模式改由 BtSpreadLayout 承载） */
.bt-collation-compare[data-mode='columns'] .bt-collation-compare__pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.2em;
}

.bt-collation-compare__pair.is-linked {
  background: rgba(127, 127, 127, 0.12);
}

.bt-collation-compare__pane {
  min-width: 0;
}

.bt-collation-compare__pane[data-role='variant'] {
  border-inline-start: 1px solid currentColor;
  padding-inline-start: 1em;
  opacity: 0.86;
}

/* H5（C5）：窄屏堆叠——双栏改单列，校本栏分隔线由竖转横 */
.bt-collation-compare--stacked .bt-collation-compare__pair {
  grid-template-columns: 1fr;
  gap: 0.8em;
}

.bt-collation-compare--stacked .bt-collation-compare__pane[data-role='variant'] {
  border-inline-start: none;
  border-block-start: 1px solid currentColor;
  padding-inline-start: 0;
  padding-block-start: 0.6em;
}

@media (max-width: 768px) {
  .bt-collation-compare[data-mode='columns'] .bt-collation-compare__pair {
    grid-template-columns: 1fr;
  }
}

.bt-collation-compare__placeholder,
.bt-collation-compare__empty {
  opacity: 0.6;
  font-size: 0.9em;
}
</style>
