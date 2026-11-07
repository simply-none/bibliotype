import { beforeAll, describe, expect, it } from 'vitest';
import { FlipController } from '../engine/flip-controller';
import type { FlipRenderAdapter, FlipSceneState, PageProvider, PageSize } from '../engine/types';
import { createHorizontalTextProvider } from '../demo/providers/text-horizontal';

/** headless document/canvas 桩：PageBitmapSource 需要离屏 2D 画布。 */
beforeAll(() => {
  const fakeGradient = { addColorStop: () => undefined };
  const fakeCtx = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
          return () => fakeGradient;
        }
        if (prop === 'canvas') {
          return { width: 0, height: 0 };
        }
        return () => undefined;
      },
      set() {
        return true;
      },
    }
  );
  (globalThis as Record<string, unknown>).document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => fakeCtx,
    }),
  };
});

/** headless 测试桩：假 canvas + 假 GL + 记录渲染状态的渲染适配器。 */
function createStubs() {
  const fakeCanvas = {
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    setPointerCapture: () => undefined,
  } as unknown as HTMLCanvasElement;

  const fakeGl = {
    createTexture: () => ({}),
    deleteTexture: () => undefined,
    bindTexture: () => undefined,
    texImage2D: () => undefined,
    pixelStorei: () => undefined,
    texParameteri: () => undefined,
    generateMipmap: () => undefined,
  } as unknown as WebGLRenderingContext;

  const adapter = {
    gl: fakeGl,
    isWebGL2: false,
    updateLayout: () => undefined,
    resize: () => undefined,
    render(state: FlipSceneState) {
      adapter.lastState = state;
    },
    dispose: () => undefined,
    lastState: null as FlipSceneState | null,
  } as FlipRenderAdapter & { lastState: FlipSceneState | null };

  return { fakeCanvas, adapter };
}

/** 驱动帧循环推进（绕过真实 rAF 定时）。 */
function advance(controller: FlipController, deltaMs: number): void {
  const now = performance.now() + deltaMs;
  controller['lastFrame'] = now - 16;
  controller['tick'](now);
}

/** 指针事件 + 立即驱动帧循环（姿态在 tick 内解算；move 后多推几帧让低通收敛）。 */
function pointer(controller: FlipController, type: 'down' | 'move' | 'up', x: number, y: number, time: number): void {
  controller['onPointer']({ type, x, y, time });
  const frames = type === 'move' ? 8 : 1;
  for (let i = 0; i < frames; i++) {
    advance(controller, 16);
  }
}

describe('FlipController 状态机（headless）', () => {
  const VIEW: PageSize = { width: 500, height: 700 };

  function createController() {
    const { fakeCanvas, adapter } = createStubs();
    const controller = new FlipController(fakeCanvas, { renderer: adapter });
    controller.setViewport(VIEW.width, VIEW.height, 1);
    const provider: PageProvider = createHorizontalTextProvider();
    controller.setProvider(provider);
    // 布局在 setProvider 内重排；页面尺寸 438×644，居中于 500×700
    return { controller, adapter, provider };
  }

  /** 页面右缘（元素坐标）。页面 x ∈ [31, 469]。 */
  const RIGHT_EDGE_X = 462;
  const PAGE_Y = 350;

  it('慢拖至中段松手 → 回弹，页码不变', () => {
    const { controller, adapter } = createController();
    pointer(controller, 'down', RIGHT_EDGE_X, PAGE_Y, 1000);
    pointer(controller, 'move', RIGHT_EDGE_X - 40, PAGE_Y, 1400);
    pointer(controller, 'move', RIGHT_EDGE_X - 80, PAGE_Y, 1800);
    // 拖拽中应出现翻动姿态
    expect(adapter.lastState?.pose).not.toBeNull();
    pointer(controller, 'up', RIGHT_EDGE_X - 85, PAGE_Y, 1900);
    advance(controller, 900); // 补间完成
    expect(controller.currentPage).toBe(0);
    expect(adapter.lastState?.pose).toBeNull();
    controller.destroy();
  });

  it('快甩 → 完成翻页，页码 +1', () => {
    const { controller, adapter } = createController();
    pointer(controller, 'down', RIGHT_EDGE_X, PAGE_Y, 1000);
    // 120ms 内快速左移（速度 > flickVelocity）
    pointer(controller, 'move', RIGHT_EDGE_X - 100, PAGE_Y, 1060);
    pointer(controller, 'move', RIGHT_EDGE_X - 200, PAGE_Y, 1100);
    pointer(controller, 'up', RIGHT_EDGE_X - 210, PAGE_Y, 1110);
    advance(controller, 900);
    expect(controller.currentPage).toBe(1);
    expect(adapter.lastState?.pose).toBeNull();
    controller.destroy();
  });

  it('拖拽超过中点松手 → 完成翻页', () => {
    const { controller } = createController();
    pointer(controller, 'down', RIGHT_EDGE_X, PAGE_Y, 1000);
    pointer(controller, 'move', RIGHT_EDGE_X - 120, PAGE_Y, 1400);
    pointer(controller, 'move', RIGHT_EDGE_X - 260, PAGE_Y, 1800);
    pointer(controller, 'up', RIGHT_EDGE_X - 265, PAGE_Y, 1850);
    advance(controller, 900);
    expect(controller.currentPage).toBe(1);
    controller.destroy();
  });

  it('第 0 页左侧后翻 → 橡皮筋受限拖拽，页码不变', () => {
    const { controller, adapter } = createController();
    pointer(controller, 'down', 40, PAGE_Y, 1000);
    pointer(controller, 'move', 120, PAGE_Y, 1200);
    // 边界会话存在但进度被 cap 在橡皮筋幅度内
    expect(adapter.lastState?.pose).not.toBeNull();
    expect(controller['session']?.progressCap).toBeLessThan(1);
    expect(controller['pose']?.progress ?? 0).toBeLessThanOrEqual(0.1);
    pointer(controller, 'up', 130, PAGE_Y, 1300);
    advance(controller, 900); // 回弹补间完成
    expect(controller.currentPage).toBe(0);
    expect(adapter.lastState?.pose).toBeNull();
    controller.destroy();
  });

  it('第 0 页左侧快甩 → 只回弹不翻页', () => {
    const { controller } = createController();
    pointer(controller, 'down', 40, PAGE_Y, 1000);
    pointer(controller, 'move', 200, PAGE_Y, 1060); // 快速甩动
    pointer(controller, 'up', 260, PAGE_Y, 1090);
    advance(controller, 900);
    expect(controller.currentPage).toBe(0);
    controller.destroy();
  });

  it('末页点击右缘 → 橡皮筋回弹（tap 触发 bounce）', () => {
    const { controller } = createController();
    const total = controller['pageCount']();
    for (let i = 0; i < total - 1; i++) {
      controller.autoFlip('forward');
      advance(controller, 900);
    }
    pointer(controller, 'down', RIGHT_EDGE_X, PAGE_Y, 5000);
    pointer(controller, 'up', RIGHT_EDGE_X + 2, PAGE_Y, 5120); // 无位移短按
    advance(controller, 150); // bounce 前半段进行中
    expect(controller['session']?.pendingReturn).toBe(true);
    advance(controller, 900); // 完成前半段 → 转入回弹段
    advance(controller, 900); // 回弹段完成
    expect(controller.currentPage).toBe(total - 1);
    expect(controller['phase']).toBe('idle');
    controller.destroy();
  });

  it('点击边缘 → 自动翻页', () => {
    const { controller } = createController();
    pointer(controller, 'down', RIGHT_EDGE_X, PAGE_Y, 1000);
    pointer(controller, 'up', RIGHT_EDGE_X + 2, PAGE_Y, 1120); // 无位移的短按
    advance(controller, 900);
    expect(controller.currentPage).toBe(1);
    controller.destroy();
  });

  it('页面中部滑动 → 按方向提交 swipe 会话并完成翻页', () => {
    const { controller, adapter } = createController();
    // 中部按下（非边缘带），向左滑动
    pointer(controller, 'down', 250, 350, 1000);
    pointer(controller, 'move', 230, 350, 1100); // 提交（位移 ≥ 14px，水平为主）
    expect(controller['session']?.inputMode).toBe('swipe');
    expect(controller['session']?.action).toBe('forward');
    pointer(controller, 'move', 150, 348, 1200);
    expect(adapter.lastState?.pose).not.toBeNull();
    pointer(controller, 'up', 148, 348, 1210); // 释放落在采样窗内 → 构成甩动
    advance(controller, 900);
    expect(controller.currentPage).toBe(1);
    controller.destroy();
  });

  it('提交瞬间继承已滑行程（一次拖到位不回弹）', () => {
    const { controller } = createController();
    pointer(controller, 'down', 300, 350, 1000);
    // 连续 move 拖过提交阈值：progress 立即继承全部行程 ≈ (300−90)/2/438
    pointer(controller, 'move', 200, 349, 1060);
    pointer(controller, 'move', 90, 348, 1120);
    const progress = controller['pose']?.progress ?? 0;
    expect(progress).toBeGreaterThan(0.2); // 0.24，配合甩动速度完成
    pointer(controller, 'up', 88, 348, 1160); // 释放落在采样窗内 → 构成甩动
    advance(controller, 900);
    expect(controller.currentPage).toBe(1);
    controller.destroy();
  });

  it('中部向右滑动 → 掀回上一页', () => {
    const { controller } = createController();
    controller.autoFlip('forward'); // 先到第 1 页
    advance(controller, 900);
    expect(controller.currentPage).toBe(1);
    pointer(controller, 'down', 250, 350, 2000);
    pointer(controller, 'move', 280, 350, 2100); // 向右 → backward
    expect(controller['session']?.action).toBe('backward');
    pointer(controller, 'move', 360, 348, 2200);
    pointer(controller, 'up', 365, 348, 2210); // 释放落在采样窗内 → 构成甩动
    advance(controller, 900);
    expect(controller.currentPage).toBe(0);
    controller.destroy();
  });

  it('中部小幅位移不提交（防误触）', () => {
    const { controller, adapter } = createController();
    pointer(controller, 'down', 250, 350, 1000);
    pointer(controller, 'move', 258, 352, 1100); // < 14px
    expect(controller['session']).toBeNull();
    expect(adapter.lastState?.pose).toBeNull();
    pointer(controller, 'up', 260, 352, 1200);
    expect(controller.currentPage).toBe(0);
    controller.destroy();
  });

  it('autoFlip 到达末页 → 橡皮筋回弹，页码不变', () => {
    const { controller } = createController();
    // 快进到末页
    const total = controller['pageCount']();
    for (let i = 0; i < total - 1; i++) {
      controller.autoFlip('forward');
      advance(controller, 900);
    }
    expect(controller.currentPage).toBe(total - 1);
    controller.autoFlip('forward'); // 边界 → 回弹
    advance(controller, 400); // 前半段
    advance(controller, 900); // 回弹段
    expect(controller.currentPage).toBe(total - 1);
    controller.destroy();
  });

  it('snap 进行中按下可接管为拖拽（连续快翻）', () => {
    const { controller, adapter } = createController();
    controller.autoFlip('forward');
    advance(controller, 200); // snap 进行中
    pointer(controller, 'down', RIGHT_EDGE_X - 120, PAGE_Y, performance.now());
    expect(controller['phase']).toBe('drag');
    expect(adapter.lastState?.pose).not.toBeNull();
    controller.destroy();
  });

  it('snap 期间键盘/滚轮脉冲排队，补间结束后接续翻页', () => {
    const { controller } = createController();
    controller.autoFlip('forward');
    advance(controller, 100); // snap 进行中
    controller.autoFlip('forward'); // 被排队
    expect(controller['queuedPulse']).toBe('forward');
    advance(controller, 900); // 第一段补间完成 → 消费队列
    expect(controller.currentPage).toBe(1);
    expect(controller['phase']).toBe('snap'); // 队列脉冲已接续为新的 snap
    advance(controller, 900);
    expect(controller.currentPage).toBe(2);
    controller.destroy();
  });

  it('debug 赋值即请求重绘（dirty 置位）', () => {
    const { controller } = createController();
    advance(controller, 32); // 清空 dirty
    controller.debug = true;
    expect(controller['dirty']).toBe(true);
    controller.destroy();
  });
});
