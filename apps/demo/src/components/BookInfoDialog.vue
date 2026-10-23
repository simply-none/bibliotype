<script setup lang="ts">
/**
 * 书籍信息弹窗（Demo 组件，查看 / 编辑双态外壳）
 *
 * 只做组装：遮罩 / 卡片 / 头部动作 / 查看态与编辑态切换。
 * 查看态渲染 `BookInfoView`，编辑态渲染 `BookInfoEditForm`；草稿状态与元数据映射
 * 由 `use-metadata-draft` 承载，导出文本生成由 `catalog-export` 纯函数提供。
 * 保存时向父级 emit('save', patch)（顶层字段补丁，留空即清空；title 空则不改）。
 * 遮罩点击 / 关闭按钮关闭；编辑态下点遮罩不关闭（防误丢改动）。
 */
import { computed } from 'vue';
import { type BookMetadata } from '@bibliotype/core';
import { BT_BREAKPOINTS, useBreakpoint } from '@bibliotype/vue';
import { safeFilename, toCnmarcText, toDublinCoreJson } from '../catalog-export.js';
import { useMetadataDraft } from '../composables/use-metadata-draft.js';
import AppIcon from './AppIcon.vue';
import BookInfoEditForm from './BookInfoEditForm.vue';
import BookInfoView from './BookInfoView.vue';

const props = defineProps<{ metadata: BookMetadata; editable?: boolean }>();
const emit = defineEmits<{
  close: [];
  save: [patch: Partial<BookMetadata>];
}>();

/**
 * H5 断点（C2）：窄屏模态转全屏页
 *
 * 与样式表的 `@media (max-width: 767px)` 同口径，另保留可断言的类名 / data 钩子
 * ——happy-dom 不执行媒体查询，测试靠钩子判断布局分支。
 */
const breakpoint = useBreakpoint();
const mobileLayout = computed(() => breakpoint.width.value < BT_BREAKPOINTS.md);

const { editing, draft, subdivisionOptions, startEdit, cancelEdit, save } = useMetadataDraft({
  metadata: () => props.metadata,
  onSave: (patch) => emit('save', patch),
});

/** 触发文本下载（纯宿主行为，库内不写文件） */
function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** 导出都柏林核心 JSON */
function exportDublinCore(): void {
  downloadText(
    `${safeFilename(props.metadata.title)}-dc.json`,
    toDublinCoreJson(props.metadata),
    'application/json',
  );
}

/** 导出 CNMARC 字段行文本 */
function exportCnmarc(): void {
  downloadText(`${safeFilename(props.metadata.title)}-cnmarc.txt`, toCnmarcText(props.metadata), 'text/plain');
}
</script>

<template>
  <div
    class="dialog"
    :class="{ 'dialog--mobile': mobileLayout }"
    role="dialog"
    aria-modal="true"
    :data-mobile="mobileLayout ? 'true' : 'false'"
    @click.self="editing ? undefined : emit('close')"
  >
    <div class="dialog__panel">
      <header class="dialog__header">
        <!-- 关闭：桌面在末尾（右上 ×），H5 换到左侧改返回箭头；可访问名不变 -->
        <button type="button" class="dialog__close" aria-label="关闭" @click="emit('close')">
          <AppIcon class="dialog__close-back" name="arrow-left" :size="20" />
          <span class="dialog__close-cross" aria-hidden="true">×</span>
        </button>
        <h2 class="dialog__title">书籍信息</h2>
        <div class="dialog__header-actions">
          <template v-if="!editing">
            <button type="button" class="dialog__action" @click="exportDublinCore">
              导出 DC
            </button>
            <button type="button" class="dialog__action" @click="exportCnmarc">
              导出 MARC
            </button>
          </template>
          <button
            v-if="editable && !editing"
            type="button"
            class="dialog__action"
            @click="startEdit"
          >
            编辑
          </button>
          <template v-if="editing">
            <button type="button" class="dialog__action" @click="cancelEdit">取消</button>
            <button type="button" class="dialog__action dialog__action--primary" @click="save">
              保存
            </button>
          </template>
        </div>
      </header>

      <BookInfoView v-if="!editing" :metadata="metadata" />
      <BookInfoEditForm v-else :draft="draft" :division-options="subdivisionOptions" />
    </div>
  </div>
</template>

<style scoped>
/* 遮罩：与 sheet / 抽屉同层级与同遮罩色，保证浮层之间不打架 */
.dialog {
  position: fixed;
  inset: 0;
  z-index: var(--ui-z-sheet, 40);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--ui-space-6, 20px);
  background: rgb(18 16 12 / 44%);
  backdrop-filter: blur(3px);
}

.dialog__panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 560px;
  max-height: 80vh;
  overflow: hidden;
  color: var(--ui-text, #3c3a34);
  background: var(--ui-surface-raised, #faf8f4);
  border: var(--ui-border-width, 1px) solid var(--ui-border, #e2ddd2);
  border-radius: var(--ui-radius-lg, 16px);
  box-shadow: var(--ui-shadow-3, 0 14px 40px rgb(0 0 0 / 20%));
}

.dialog__header {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--ui-space-2, 6px);
  padding: var(--ui-space-3, 8px) var(--ui-space-4, 12px);
  border-block-end: 1px solid var(--ui-divider, #d8d2c4);
  background: var(--ui-surface, #f4f0e8);
}

.dialog__title {
  flex: 1;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  font-size: var(--ui-font-lg, 15px);
  font-weight: 600;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.dialog__header-actions {
  display: flex;
  align-items: center;
  gap: var(--ui-space-1, 4px);
}

.dialog__action {
  padding: 5px 12px;
  min-height: 32px;
  font-size: var(--ui-font-md, 13px);
  color: var(--ui-text, #3c3a34);
  background: var(--ui-surface-raised, #faf8f4);
  border: var(--ui-border-width, 1px) solid var(--ui-border, #e2ddd2);
  border-radius: var(--ui-radius-pill, 999px);
  cursor: pointer;
  transition:
    background var(--ui-dur-fast, 120ms) var(--ui-ease, ease),
    color var(--ui-dur-fast, 120ms) var(--ui-ease, ease),
    border-color var(--ui-dur-fast, 120ms) var(--ui-ease, ease);
}

.dialog__action:hover {
  border-color: var(--ui-accent, #8c5a2b);
  color: var(--ui-accent, #8c5a2b);
}

.dialog__action--primary {
  color: var(--ui-on-accent, #fff);
  background: var(--ui-accent, #8c5a2b);
  border-color: var(--ui-accent, #8c5a2b);
}

.dialog__action--primary:hover {
  color: var(--ui-on-accent, #fff);
  background: var(--ui-accent-strong, #734721);
}

/* 关闭：桌面排在末尾（右上角 ×），H5 靠到左侧 */
.dialog__close {
  order: 3;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  font-size: 18px;
  line-height: 1;
  color: var(--ui-text-muted, #7f7a6d);
  background: none;
  border: 0;
  border-radius: var(--ui-radius-sm, 8px);
  cursor: pointer;
  transition:
    background var(--ui-dur-fast, 120ms) var(--ui-ease, ease),
    color var(--ui-dur-fast, 120ms) var(--ui-ease, ease);
}

.dialog__close:hover {
  color: var(--ui-accent, #8c5a2b);
  background: var(--ui-surface-sunken, #e8e1d3);
}

/* 返回箭头只在 H5 出现 */
.dialog__close-back {
  display: none;
}

/*
 * H5（C2 + 美化 P2）：窄屏模态转全屏页
 *
 * 遮罩去内边距、面板撑满视口并去圆角；标题栏走三列网格（左 44px 返回、
 * 中标题真居中、右 44px 占位），动作组整行换到第二行横向滑动，
 * 避免 375px 下四个胶囊按钮挤成一堆。
 */
@media (max-width: 767px) {
  .dialog {
    align-items: stretch;
    padding: 0;
  }

  .dialog__panel {
    max-width: none;
    max-height: none;
    height: 100%;
    border: none;
    border-radius: 0;
    box-shadow: none;
    padding-block-end: env(safe-area-inset-bottom, 0px);
  }

  .dialog__header {
    display: grid;
    grid-template-columns: var(--bt-touch-target, 44px) 1fr var(--bt-touch-target, 44px);
    align-items: center;
    gap: var(--ui-space-1, 4px) var(--ui-space-2, 6px);
    min-height: 56px;
    padding: var(--ui-space-2, 6px) var(--ui-space-3, 8px);
    padding-block-start: calc(var(--ui-space-2, 6px) + var(--bt-safe-top, 0px));
  }

  .dialog__close {
    grid-column: 1;
    grid-row: 1;
    order: 0;
    width: var(--bt-touch-target, 44px);
    height: var(--bt-touch-target, 44px);
  }

  .dialog__close-back {
    display: block;
  }

  .dialog__close-cross {
    display: none;
  }

  .dialog__title {
    grid-column: 2;
    grid-row: 1;
    flex: none;
    text-align: center;
  }

  .dialog__header-actions {
    grid-column: 1 / -1;
    grid-row: 2;
    justify-content: flex-end;
    padding-block-start: var(--ui-space-1, 4px);
    overflow-x: auto;
    overscroll-behavior-x: contain;
  }

  .dialog__action {
    min-height: 36px;
    white-space: nowrap;
  }
}
</style>
