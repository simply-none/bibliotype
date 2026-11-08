/**
 * @bibliotype/page-flip 公共导出面
 *
 * 仿真翻页（Page Curl）引擎：WebGL 圆柱卷曲 + 折痕锚定中垂线模型 +
 * 手势状态机（idle/drag/snap），框架无关、零运行时依赖。
 *
 * 模块速览：
 * - FlipController：翻页控制器（挂 canvas 即用）；
 * - GlRenderer：WebGL 渲染适配器（上下文 / 网格 / 绘制 / 上下文丢失恢复）；
 * - curl-model：触点/进度 → 折痕姿态纯函数（含角部书脊锚定约束）；
 * - flip-decisions：抓取区判定 / 松手决策 / 补间时长；
 * - deform：CPU 参照形变（与 shader 同式）；
 * - page-provider + TextureStore：页面位图源与纹理 LRU。
 */
export { FlipController } from './flip-controller.js';
export type { FlipControllerOptions } from './flip-controller.js';

export { GlRenderer } from './gl-renderer.js';

export { InputSource, isTap } from './input.js';
export type { RawPointerEvent, InputSourceHandlers } from './input.js';

export { PageBitmapSource } from './page-provider.js';
export { TextureStore } from './texture-store.js';

export { deformPoint } from './deform.js';
export type { CurlFace, DeformedPoint } from './deform.js';

export {
  clamp,
  clampCornerTouch,
  clampTouch,
  createFoldSession,
  lerp,
  solveFoldPose,
  solveFoldPoseAtProgress,
  smoothstep,
} from './curl-model.js';
export type { FoldSession, FoldSolveInput } from './curl-model.js';

export { decideRelease, resolveGrabZone, snapDurationFor } from './flip-decisions.js';
export type { GrabZone, GrabZoneOptions } from './flip-decisions.js';

export {
  canonicalSize,
  canonicalToScreen,
  frameIndex,
  resolveBindEdge,
  screenToCanonical,
} from './page-frame.js';

export {
  DEFAULT_FLIP_CONFIG,
  type BindEdge,
  type FlipAction,
  type FlipConfig,
  type FlipOrientation,
  type FlipRenderAdapter,
  type FlipSceneState,
  type FoldPose,
  type GrabMode,
  type PageProvider,
  type PageSize,
  type Point,
} from './types.js';

export { multiply, perspective, translateZ } from './mat4.js';
export type { Mat4 } from './mat4.js';

export { FRAGMENT_SHADER, VERTEX_SHADER } from './shaders.js';
