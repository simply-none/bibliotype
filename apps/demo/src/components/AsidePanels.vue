<script setup lang="ts">
/**
 * 左栏面板组（目录 / 搜索 / 书签 / 导入 / 句读建议）
 *
 * 一份内容两处复用：桌面态嵌在 `.app__aside` 常驻侧栏，H5 态嵌进 `BtDrawer`
 * 左抽屉（A1 / A4）。App 只负责布局骨架与开关，面板编排收敛在此处，
 * 避免两套模板随改造各自漂移。
 *
 * 面板顺序与顶栏 tab 一致，`tab` 为 null 时整体不渲染；目录用 `v-show` 保留
 * 滚动位置与展开态，其余面板按需挂载（进入即重建，取最新 Reader 数据）。
 */
import {
  BtAnnotationSuggestions,
  BtToc,
  type SuggestionFilter,
  type SuggestionOverride,
  type UseAnnotationSuggestions,
} from '@bibliotype/vue';
import type { BookDocument } from '@bibliotype/core';
import type { OutlineItem, Reader } from '@bibliotype/reader';
import AnnotationPanel from './AnnotationPanel.vue';
import ImportPanel from './ImportPanel.vue';
import SearchPanel from './SearchPanel.vue';

/** 面板标识（与顶栏 tab 同集合） */
type AsideTabKey = 'toc' | 'search' | 'bookmarks' | 'import' | 'suggestions';

defineProps<{
  /** 当前面板（null = 无） */
  tab: AsideTabKey | null;
  /** 阅读器实例 */
  reader: Reader;
  /** 当前文档（标注锚点 / 目录分组） */
  document: BookDocument;
  /** 图书标识（标注存储键） */
  bookId: string;
  /** 当前模式（句读面板仅编辑态可用） */
  mode: 'read' | 'edit';
  /** 主题键（面板随主题 / Reader 代际重建） */
  themeKey: string;
  /** Reader 代际（重建时强制重挂载面板） */
  readerEpoch: number;
  /** 目录展开集合（未受控时缺省，BtToc 走内部折叠状态） */
  expandedKeys?: readonly string[];
  /** 句读 / 专名审阅状态（整个组合式对象，含可写 filter ref） */
  suggestionsApi: UseAnnotationSuggestions;
}>();

const emit = defineEmits<{
  /** 面板请求关闭 */
  close: [];
  /** 导入完成 */
  imported: [document: BookDocument];
  /** 目录展开集合变化 */
  'update:expandedKeys': [keys: string[]];
  /** 目录跳转 */
  select: [item: OutlineItem];
  /** 接受建议 */
  accept: [ids: readonly string[]];
  /** 拒绝建议 */
  reject: [ids: readonly string[]];
  /** 采纳为标点 */
  commit: [ids: readonly string[]];
  /** 改类 / 改标点 */
  override: [id: string, patch: SuggestionOverride];
  /** 类别过滤变化 */
  'update:filter': [value: SuggestionFilter];
}>();

/** 写回类别过滤（子面板 v-model:filter 的落点） */
function onFilterChange(value: SuggestionFilter): void {
  emit('update:filter', value);
}
</script>

<template>
  <SearchPanel
    v-if="tab === 'search'"
    :key="`search-${themeKey}-${readerEpoch}`"
    :reader="reader"
    @close="emit('close')"
  />
  <AnnotationPanel
    v-if="tab === 'bookmarks'"
    :key="`annotation-${themeKey}-${readerEpoch}`"
    :reader="reader"
    :document="document"
    :book-id="bookId"
    @close="emit('close')"
  />
  <ImportPanel v-if="tab === 'import'" @close="emit('close')" @imported="emit('imported', $event)" />
  <div v-show="tab === 'toc'" class="aside-panels__toc">
    <BtToc
      :key="`toc-${themeKey}-${readerEpoch}`"
      :reader="reader"
      :expanded-keys="expandedKeys"
      @update:expanded-keys="emit('update:expandedKeys', $event)"
      @select="emit('select', $event)"
    />
  </div>
  <!-- 句读 / 专名建议（K3）：编辑模式面板，接受后才写入文档 -->
  <div v-if="tab === 'suggestions'" class="aside-panels__suggestions">
    <p v-if="mode !== 'edit'" class="aside-panels__hint">
      进入编辑模式后，可在此逐条接受句读与专名建议。
    </p>
    <BtAnnotationSuggestions
      v-else
      :suggestions="suggestionsApi.visible.value"
      :counts="suggestionsApi.counts.value"
      :filter="suggestionsApi.filter.value"
      empty-text="当前段落没有待处理建议"
      @update:filter="onFilterChange"
      @accept="emit('accept', $event)"
      @reject="emit('reject', $event)"
      @commit="emit('commit', $event)"
      @override="(id, patch) => emit('override', id, patch)"
    />
  </div>
</template>

<style scoped>
.aside-panels__toc {
  padding: 10px 4px 14px;
}

.aside-panels__suggestions {
  padding: 10px 8px 14px;
}

.aside-panels__hint {
  margin: 0;
  color: var(--demo-text-muted, #6b6b6b);
  font-size: 12px;
  line-height: 1.6;
}
</style>
