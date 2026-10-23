/**
 * 舞台可用尺寸实测（开本自适应的取形来源）
 *
 * 观察 `.app__stage`（阅读 / 编辑共用的舞台元素），扣掉它自身的内边距后给出
 * 「未缩放的可用宽高」。这个值与 `BtBookView` 根元素的 `clientWidth/Height` 同源
 * （根元素 `width/height:100%` 且无内边距），所以 `applyPageSizeMode` 把页框铺到
 * 本盒子时，整页等比缩放系数恰为 1 —— 铺满且不裁切，无需再放开缩放上限。
 *
 * 内边距按 computed style 实取（桌面 20px、H5 骨架 12px），不写死常量：写死会让
 * 自适应页框比真实可用区窄一截，右侧留下一条无法消除的空白。
 */
import { onBeforeUnmount, ref, watch, type Ref } from 'vue';
import type { StageBoxSize } from '@bibliotype/layout';

/** 忽略抖动阈值（px）：亚像素 / 滚动条出现与否的 1~2px 摆动不新建成效布局 */
const MEASURE_EPSILON = 2;

/** 解析 computed style 的长度值（`12px` → 12；非数值按 0） */
function parsePx(raw: string | null): number {
  const num = Number.parseFloat(raw ?? '');
  return Number.isFinite(num) ? num : 0;
}

/** 舞台元素引用与其实测可用尺寸 */
export function useStageSize() {
  /** 舞台元素（模板 `ref="stageEl"` 绑定；阅读 / 编辑共用同一节点） */
  const stageEl = ref<HTMLElement | null>(null);
  /** 可用尺寸（px，已扣内边距）；未挂载 / 不可测量时为 null，交由折算侧回退 */
  const stageSize = ref<StageBoxSize | null>(null);

  let observer: ResizeObserver | undefined;

  /** 重新测量并落值（变化不足阈值时保持旧值，避免无谓重排） */
  function measure(): void {
    const el = stageEl.value;
    if (el === null) {
      stageSize.value = null;
      return;
    }
    const style = window.getComputedStyle(el);
    const width = el.clientWidth - parsePx(style.paddingLeft) - parsePx(style.paddingRight);
    const height = el.clientHeight - parsePx(style.paddingTop) - parsePx(style.paddingBottom);
    const prev = stageSize.value;
    if (
      prev !== null &&
      Math.abs(prev.width - width) < MEASURE_EPSILON &&
      Math.abs(prev.height - height) < MEASURE_EPSILON
    ) {
      return;
    }
    stageSize.value = { width, height };
  }

  /**
   * 元素换绑时重挂观察器
   *
   * 舞台节点在某些切换（模式 / 骨架开合）下会被销毁重建，旧观察器指向已卸载
   * 节点就不再回报尺寸 → 自适应窗口后不再重排，故随 ref 变化重新 observe。
   */
  watch(
    stageEl,
    (el) => {
      observer?.disconnect();
      observer = undefined;
      measure();
      if (el === null || typeof ResizeObserver === 'undefined') return;
      observer = new ResizeObserver(measure);
      observer.observe(el);
    },
    { flush: 'post', immediate: true },
  );

  onBeforeUnmount(() => {
    observer?.disconnect();
    observer = undefined;
  });

  return { stageEl, stageSize } as {
    stageEl: Ref<HTMLElement | null>;
    stageSize: Ref<StageBoxSize | null>;
  };
}
