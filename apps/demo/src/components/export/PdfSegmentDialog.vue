<template>
  <div
    v-if="open"
    class="seg-dialog"
    role="dialog"
    aria-modal="true"
    :aria-label="`${title} 分段导出 PDF`"
    @click.self="onMaskClick"
  >
    <div class="seg-dialog__panel">
      <header class="seg-dialog__header">
        <span class="seg-dialog__title">{{ title }} · 分段导出 PDF（矢量）</span>
        <button
          v-if="phase !== 'running'"
          type="button"
          class="seg-dialog__close"
          aria-label="关闭"
          @click="close"
        >
          ✕
        </button>
      </header>

      <!-- 设置阶段：每卷页数 + 分段区域预览 -->
      <div v-if="phase === 'setup'" class="seg-dialog__body">
        <label class="seg-dialog__field">
          <span class="seg-dialog__field-label">每卷页数（100–2000）</span>
          <input
            v-model.number="segmentPagesInput"
            class="seg-dialog__input"
            type="number"
            min="100"
            max="2000"
            step="50"
          />
        </label>
        <p class="seg-dialog__hint">
          共 {{ totalPages }} 页，将分为 {{ plan.length }} 个 PDF 文件逐卷导出（每卷独立落盘，互不影响）。
        </p>
        <div class="seg-dialog__plan">
          <div v-for="item in plan" :key="item.index" class="seg-dialog__plan-row">
            <span class="seg-dialog__plan-name">第 {{ String(item.index).padStart(3, '0') }} 卷</span>
            <span class="seg-dialog__plan-pages">页 {{ item.from + 1 }}–{{ item.to + 1 }}</span>
            <span class="seg-dialog__plan-file">→ {{ filenameOf(item.index) }}</span>
          </div>
        </div>
        <p v-if="lastError !== ''" class="seg-dialog__error">{{ lastError }}</p>
        <button
          type="button"
          class="seg-dialog__confirm"
          :disabled="runner === null"
          @click="startExport"
        >
          确认并开始导出
        </button>
      </div>

      <!-- 导出中 / 完成：逐段状态 -->
      <div v-else class="seg-dialog__body">
        <p v-if="upload !== null" class="seg-dialog__upload">
          上传图片资源 {{ upload.done }}/{{ upload.total }}…
        </p>
        <div class="seg-dialog__segments">
          <div
            v-for="segment in segments"
            :key="segment.index"
            class="seg-dialog__segment"
            :data-status="segment.status"
          >
            <span class="seg-dialog__segment-name">{{ segment.filename }}</span>
            <span class="seg-dialog__segment-pages">页 {{ segment.from + 1 }}–{{ segment.to + 1 }}</span>
            <span class="seg-dialog__segment-status">{{ statusLabel(segment.status) }}</span>
            <span v-if="segment.path !== undefined" class="seg-dialog__segment-path" :title="segment.path">
              {{ segment.path }}
            </span>
            <span v-if="segment.error !== undefined" class="seg-dialog__segment-path" :title="segment.error">
              {{ segment.error }}
            </span>
          </div>
        </div>
        <p v-if="phase === 'done'" class="seg-dialog__hint">
          {{ failedCount > 0 ? `有 ${failedCount} 段导出失败，已完成的文件不受影响。` : '全部分段导出完成。' }}
        </p>
        <button
          v-if="phase === 'running'"
          type="button"
          class="seg-dialog__stop"
          @click="stop"
        >
          停止导出（已完成分段保留）
        </button>
        <button
          v-if="phase === 'done'"
          type="button"
          class="seg-dialog__confirm"
          @click="close"
        >
          关闭
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 分段导出 PDF 弹窗（桌面宿主）
 *
 * 「导出 PDF」在桌面宿主下的交互：先设置每卷页数并预览分段区域（确认前可调），
 * 确认后**弹窗停留在本页**逐段导出——每段经宿主矢量打印独立落盘为
 * `书名_00x.pdf`（不合并单文件），段状态实时展示；可随时「停止导出」，
 * 已完成分段保留。全部结束（或失败停止）后显示统计并允许关闭。
 *
 * 导出执行由 `PdfSegmentedRunner`（use-export 导出的宿主会话协议封装）承担，
 * 本组件只管交互状态机：setup → running → done。分段方案计算与弹窗共用
 * `buildSegmentPlan`（与实际导出同源）。
 */
import { computed, ref, watch } from 'vue';
import {
  buildSegmentPlan,
  type PdfSegmentedRunner,
} from '../../composables/use-export.js';

/** 单段导出状态 */
type SegmentStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

/** 单段状态条目 */
interface SegmentState {
  /** 卷序号（1 起） */
  index: number;
  /** 页区间（0 起含端点） */
  from: number;
  to: number;
  filename: string;
  status: SegmentStatus;
  path?: string;
  error?: string;
}

const props = defineProps<{
  /** 弹窗打开状态（配合 update:open） */
  open: boolean;
  /** 书名（文件名前缀与标题） */
  title: string;
  /** 预览总页数（弹窗打开时的预估；确认后以宿主预分页返回值为准） */
  totalPages: number;
  /** 分段导出执行器（null = 不可用） */
  runner: PdfSegmentedRunner | null;
  /** 缺省每卷页数（缺省 500） */
  defaultSegmentPages?: number;
}>();

const emit = defineEmits<{ 'update:open': [value: boolean] }>();

const phase = ref<'setup' | 'running' | 'done'>('setup');
const segmentPagesInput = ref(props.defaultSegmentPages ?? 500);
const upload = ref<{ done: number; total: number } | null>(null);
const segments = ref<SegmentState[]>([]);
const cancelled = ref(false);
const lastError = ref('');

/** 设置态的分段区域预览 */
const plan = computed(() => buildSegmentPlan(props.totalPages, segmentPagesInput.value));
const failedCount = computed(() => segments.value.filter((s) => s.status === 'failed').length);

/** 状态中文文案 */
function statusLabel(status: SegmentStatus): string {
  switch (status) {
    case 'pending':
      return '未导出';
    case 'running':
      return '导出中…';
    case 'done':
      return '已完成';
    case 'failed':
      return '失败';
    case 'skipped':
      return '已跳过';
  }
}

/** 分段文件名（书名_00x.pdf） */
function filenameOf(index: number): string {
  return `${props.title}_${String(index).padStart(3, '0')}.pdf`;
}

/** 重置状态（打开弹窗时） */
watch(
  () => props.open,
  (open) => {
    if (open) {
      phase.value = 'setup';
      segmentPagesInput.value = props.defaultSegmentPages ?? 500;
      segments.value = [];
      upload.value = null;
      cancelled.value = false;
      lastError.value = '';
    }
  },
);

function close(): void {
  emit('update:open', false);
}

/** 运行中不点遮罩关闭（需求：停留在该页等待全部导出）；其余阶段可关 */
function onMaskClick(): void {
  if (phase.value !== 'running') close();
}

/** 用户停止：当前段完成后不再开始新段，已完成分段保留 */
function stop(): void {
  cancelled.value = true;
}

/** 确认并开始：会话（去重上传 + 预分页）→ 逐段导出 */
async function startExport(): Promise<void> {
  const runner = props.runner;
  if (runner === null) return;
  const size = Math.min(2000, Math.max(100, Math.round(segmentPagesInput.value) || 500));
  lastError.value = '';
  phase.value = 'running';
  upload.value = { done: 0, total: 0 };
  try {
    const started = await runner.start((done, total) => {
      upload.value = { done, total };
    });
    /* 浏览器实现不预分页（start 返回 0）：回退用弹窗打开时的预览页数 */
    const pageCount = started.pageCount > 0 ? started.pageCount : props.totalPages;
    segments.value = buildSegmentPlan(pageCount, size).map((item, idx) => ({
      index: item.index,
      from: item.from,
      to: item.to,
      filename: `${props.title}_${String(idx + 1).padStart(3, '0')}.pdf`,
      status: 'pending' as const,
    }));
    for (const segment of segments.value) {
      if (cancelled.value) {
        segment.status = 'skipped';
        continue;
      }
      segment.status = 'running';
      try {
        segment.path = await runner.exportSegment(segment.from, segment.to, segment.filename);
        segment.status = 'done';
      } catch (error) {
        segment.status = 'failed';
        segment.error = error instanceof Error ? error.message : String(error);
        break; // 失败即停：已完成分段保留，未导出分段保持「未导出」
      }
    }
  } catch (error) {
    /* 会话 / 上传 / 预分页失败：显示错误（弹窗不关闭，便于修正后重试） */
    lastError.value = error instanceof Error ? error.message : String(error);
  } finally {
    upload.value = null;
    if (phase.value === 'running') phase.value = 'done';
  }
}
</script>

<style scoped>
.seg-dialog {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: grid;
  place-items: center;
}

.seg-dialog__mask {
  position: absolute;
  inset: 0;
  background: rgb(0 0 0 / 45%);
}

.seg-dialog__panel {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: min(560px, 92vw);
  max-height: 86vh;
  padding: 16px;
  border-radius: 12px;
  background: var(--bt-surface, #fbf9f4);
  box-shadow: 0 12px 40px rgb(0 0 0 / 30%);
  overflow: hidden;
}

.seg-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.seg-dialog__title {
  font-weight: 600;
  font-size: 15px;
}

.seg-dialog__close {
  border: none;
  background: transparent;
  font-size: 16px;
  cursor: pointer;
  color: inherit;
}

.seg-dialog__body {
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.seg-dialog__field {
  display: flex;
  align-items: center;
  gap: 10px;
}

.seg-dialog__field-label {
  font-size: 13px;
  white-space: nowrap;
}

.seg-dialog__input {
  width: 120px;
  padding: 6px 8px;
  border: 1px solid rgb(0 0 0 / 20%);
  border-radius: 6px;
  font: inherit;
}

.seg-dialog__hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: rgb(0 0 0 / 60%);
}

.seg-dialog__plan,
.seg-dialog__segments {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 40vh;
  overflow-y: auto;
  padding: 8px;
  border: 1px solid rgb(0 0 0 / 10%);
  border-radius: 8px;
}

.seg-dialog__plan-row,
.seg-dialog__segment {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  line-height: 1.8;
}

.seg-dialog__plan-name,
.seg-dialog__segment-name {
  font-weight: 600;
  white-space: nowrap;
}

.seg-dialog__plan-pages,
.seg-dialog__segment-pages {
  color: rgb(0 0 0 / 60%);
  white-space: nowrap;
}

.seg-dialog__plan-file,
.seg-dialog__segment-path {
  overflow: hidden;
  color: rgb(0 0 0 / 45%);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.seg-dialog__segment[data-status='running'] .seg-dialog__segment-status {
  font-weight: 600;
}

.seg-dialog__segment[data-status='done'] .seg-dialog__segment-status {
  color: #2e7d32;
}

.seg-dialog__segment[data-status='failed'] .seg-dialog__segment-status {
  color: #c62828;
}

.seg-dialog__segment-status {
  margin-left: auto;
  white-space: nowrap;
}

.seg-dialog__error {
  margin: 0;
  color: #c62828;
  font-size: 12px;
  line-height: 1.6;
}

.seg-dialog__confirm,
.seg-dialog__stop {
  align-self: flex-end;
  padding: 8px 18px;
  border: none;
  border-radius: 8px;
  font: inherit;
  cursor: pointer;
}

.seg-dialog__confirm {
  background: var(--bt-accent, #8c5a2b);
  color: #fff;
}

.seg-dialog__confirm:disabled {
  opacity: 0.5;
  cursor: default;
}

.seg-dialog__stop {
  align-self: center;
  background: rgb(0 0 0 / 8%);
  color: inherit;
}
</style>
