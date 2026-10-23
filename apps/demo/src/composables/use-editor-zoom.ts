/**
 * 编辑态缩放（透传 BtEditor.scale）
 *
 * 缩放限幅 0.2~2、两位小数；「适应」按书写方向折算：横排以舞台可用宽 / 页宽
 * （适应宽度），直排页沿水平排列、受整页高可见约束，改按舞台可用高 / 页高
 * （适应高度）。可用尺寸直接取 `useStageSize` 的实测盒（已扣舞台内边距），
 * 与阅读侧的开本适配共用同一个量，避免两处各扣各的边距而错位。
 */
import { ref, type ComputedRef, type Ref } from 'vue';
import type { LayoutOptions, StageBoxSize } from '@bibliotype/layout';

export interface EditorZoomDeps {
  railLayout: ComputedRef<boolean>;
  effectiveLayout: ComputedRef<LayoutOptions>;
  /** 舞台实测可用尺寸（px，已扣内边距）；null = 尚未量到，此时不按适应折算 */
  stageSize: Ref<StageBoxSize | null>;
}

/** 编辑画布缩放状态 */
export function useEditorZoom(deps: EditorZoomDeps) {
  /** 缩放比例（默认 1） */
  const editorScale = ref(1);

  /** 缩放步进（限幅 0.2~2，两位小数） */
  function zoomStep(delta: number): void {
    const next = Math.round((editorScale.value + delta) * 100) / 100;
    editorScale.value = Math.min(2, Math.max(0.2, next));
  }

  /**
   * 适应交叉轴：横排按舞台可用宽 / 页宽折算（适应宽度）；直排页沿水平排列，
   * 受整页高可见约束，改按舞台可用高 / 页高折算（适应高度）。
   *
   * 开本适配已把页框铺到舞台盒时，本函数算出的系数天然趋近 1（等价于「已适应」）。
   */
  function fitEditorWidth(): void {
    const size = deps.stageSize.value;
    const page = deps.effectiveLayout.value.pageSize;
    if (size === null) return;
    const vertical = deps.railLayout.value;
    const available = vertical ? size.height : size.width;
    const crossSize = vertical ? page.height : page.width;
    if (available <= 0 || crossSize <= 0) return;
    const ratio = Math.round((available / crossSize) * 100) / 100;
    editorScale.value = Math.min(2, Math.max(0.2, ratio));
  }

  return { editorScale, zoomStep, fitEditorWidth };
}
