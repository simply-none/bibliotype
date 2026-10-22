/**
 * 编辑态缩放（透传 BtEditor.scale）
 *
 * 缩放限幅 0.2~2、两位小数；「适应」按书写方向折算：横排以舞台可用宽 / 页宽
 * （适应宽度），直排页沿水平排列、受整页高可见约束，改按舞台可用高 / 页高
 * （适应高度）。扣除 .app__stage 对应方向内边距各 20px。
 */
import { ref, type ComputedRef } from 'vue';
import type { LayoutOptions } from '@bibliotype/layout';

export interface EditorZoomDeps {
  railLayout: ComputedRef<boolean>;
  effectiveLayout: ComputedRef<LayoutOptions>;
}

/** 编辑画布缩放状态 */
export function useEditorZoom(deps: EditorZoomDeps) {
  /** 缩放比例（默认 1） */
  const editorScale = ref(1);
  /** 编辑舞台元素（用于「适应宽度 / 适应高度」测量可用尺寸） */
  const editorStageRef = ref<HTMLElement | null>(null);

  /** 缩放步进（限幅 0.2~2，两位小数） */
  function zoomStep(delta: number): void {
    const next = Math.round((editorScale.value + delta) * 100) / 100;
    editorScale.value = Math.min(2, Math.max(0.2, next));
  }

  /**
   * 适应交叉轴：横排按舞台可用宽 / 页宽折算（适应宽度）；直排页沿水平排列，
   * 受整页高可见约束，改按舞台可用高 / 页高折算（适应高度）。
   */
  function fitEditorWidth(): void {
    const el = editorStageRef.value;
    const page = deps.effectiveLayout.value.pageSize;
    const crossSize = deps.railLayout.value ? page.height : page.width;
    if (el === null || crossSize <= 0) return;
    const available = (deps.railLayout.value ? el.clientHeight : el.clientWidth) - 40;
    const ratio = Math.round((available / crossSize) * 100) / 100;
    editorScale.value = Math.min(2, Math.max(0.2, ratio));
  }

  return { editorScale, editorStageRef, zoomStep, fitEditorWidth };
}
