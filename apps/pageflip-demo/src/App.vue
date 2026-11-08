<script setup lang="ts">
/**
 * 仿真翻页 Demo 壳：全屏舞台（WebGL 画布）+ 底部控制条。
 * 页面内容（三套样张 providers）为 demo 内容层；
 * 引擎与手势由 @bibliotype/page-flip 承担，Vue 接线来自 @bibliotype/vue/pageflip。
 */
import { ref } from 'vue';
import { usePageflip } from '@bibliotype/vue/pageflip';
import { createDemoProviders } from './demo/providers';

const canvasRef = ref<HTMLCanvasElement | null>(null);
const stageRef = ref<HTMLElement | null>(null);

const {
  providers,
  providerKey,
  currentPage,
  pageCount,
  debug,
  fps,
  error,
  autoPlaying,
  switchProvider,
  toggleDebug,
  prev,
  next,
  startAutoPlay,
  stopAutoPlay,
} = usePageflip(canvasRef, stageRef, { providers: createDemoProviders() });
</script>

<template>
  <div class="pf-root">
    <div ref="stageRef" class="pf-stage">
      <canvas ref="canvasRef" class="pf-canvas"></canvas>
      <div v-if="error" class="pf-error">无法初始化：{{ error }}</div>
    </div>

    <div class="pf-bar">
      <div class="pf-chips">
        <button
          v-for="entry in providers"
          :key="entry.key"
          class="pf-chip"
          :class="{ 'pf-chip--active': entry.key === providerKey }"
          type="button"
          @click="switchProvider(entry.key)"
        >
          {{ entry.label }}
        </button>
        <span class="pf-hint">拖拽角/边翻页 · 快甩完成 · 点击边缘 · ← → 键 / 滚轮</span>
      </div>

      <div class="pf-actions">
        <span class="pf-page">{{ currentPage + 1 }} / {{ pageCount }}</span>
        <button class="pf-btn" type="button" title="上一页" @click="prev">‹</button>
        <button
          class="pf-btn"
          type="button"
          :class="{ 'pf-btn--active': autoPlaying }"
          @click="autoPlaying ? stopAutoPlay() : startAutoPlay()"
        >
          {{ autoPlaying ? '停止' : '演示' }}
        </button>
        <button class="pf-btn" type="button" title="下一页" @click="next">›</button>
        <button class="pf-btn" :class="{ 'pf-btn--active': debug }" type="button" @click="toggleDebug">网格</button>
        <span class="pf-fps">{{ fps }} fps</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pf-root {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background:
    radial-gradient(ellipse at 50% 30%, rgba(120, 96, 60, 0.18), transparent 60%),
    linear-gradient(180deg, #26221c 0%, #17140f 100%);
}

.pf-stage {
  position: relative;
  flex: 1;
  min-height: 0;
}

.pf-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  /* 翻页手势完全接管：禁用浏览器默认触摸行为 */
  touch-action: none;
  cursor: grab;
}

.pf-canvas:active {
  cursor: grabbing;
}

.pf-hint {
  color: rgba(235, 220, 190, 0.45);
  font-size: 12px;
  letter-spacing: 0.04em;
  margin-left: 4px;
}

.pf-error {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #e8b0a0;
  font-size: 14px;
}

.pf-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 10px 16px calc(10px + env(safe-area-inset-bottom));
  background: rgba(14, 11, 7, 0.72);
  border-top: 1px solid rgba(214, 190, 138, 0.14);
  backdrop-filter: blur(8px);
}

.pf-chips,
.pf-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pf-chip,
.pf-btn {
  appearance: none;
  border: 1px solid rgba(214, 190, 138, 0.25);
  border-radius: 8px;
  background: transparent;
  color: rgba(235, 220, 190, 0.85);
  font-size: 13px;
  padding: 5px 12px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.pf-chip:hover,
.pf-btn:hover {
  background: rgba(214, 190, 138, 0.12);
}

.pf-chip--active,
.pf-btn--active {
  background: rgba(214, 190, 138, 0.22);
  border-color: rgba(214, 190, 138, 0.55);
}

.pf-page,
.pf-fps {
  color: rgba(235, 220, 190, 0.6);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  min-width: 52px;
  text-align: center;
}

.pf-fps {
  min-width: 46px;
}
</style>
