import { beforeAll, describe, expect, it } from 'vitest';
import { FlipController } from '../flip-controller';
import type { FlipRenderAdapter, FlipSceneState, PageProvider, PageSize } from '../types';
import { createStubProvider } from './stub-provider';

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

  function createController(providerOptions?: Parameters<typeof createStubProvider>[0]) {
    const { fakeCanvas, adapter } = createStubs();
    const controller = new FlipController(fakeCanvas, { renderer: adapter });
    controller.setViewport(VIEW.width, VIEW.height, 1);
    const provider: PageProvider = createStubProvider(providerOptions);
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
    advance(controller, 1300); // 补间完成
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
    advance(controller, 1300);
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
    advance(controller, 1300);
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
    advance(controller, 1300); // 回弹补间完成
    expect(controller.currentPage).toBe(0);
    expect(adapter.lastState?.pose).toBeNull();
    controller.destroy();
  });

  it('第 0 页左侧快甩 → 只回弹不翻页', () => {
    const { controller } = createController();
    pointer(controller, 'down', 40, PAGE_Y, 1000);
    pointer(controller, 'move', 200, PAGE_Y, 1060); // 快速甩动
    pointer(controller, 'up', 260, PAGE_Y, 1090);
    advance(controller, 1300);
    expect(controller.currentPage).toBe(0);
    controller.destroy();
  });

  it('末页点击右缘 → 橡皮筋回弹（tap 触发 bounce）', () => {
    const { controller } = createController();
    const total = controller['pageCount']();
    for (let i = 0; i < total - 1; i++) {
      controller.autoFlip('forward');
      advance(controller, 1300);
    }
    pointer(controller, 'down', RIGHT_EDGE_X, PAGE_Y, 5000);
    pointer(controller, 'up', RIGHT_EDGE_X + 2, PAGE_Y, 5120); // 无位移短按
    advance(controller, 150); // bounce 前半段进行中
    expect(controller['session']?.pendingReturn).toBe(true);
    advance(controller, 1300); // 完成前半段 → 转入回弹段
    advance(controller, 1300); // 回弹段完成
    expect(controller.currentPage).toBe(total - 1);
    expect(controller['phase']).toBe('idle');
    controller.destroy();
  });

  it('点击边缘 → 自动翻页', () => {
    const { controller } = createController();
    pointer(controller, 'down', RIGHT_EDGE_X, PAGE_Y, 1000);
    pointer(controller, 'up', RIGHT_EDGE_X + 2, PAGE_Y, 1120); // 无位移的短按
    advance(controller, 1300);
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
    advance(controller, 1300);
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
    advance(controller, 1300);
    expect(controller.currentPage).toBe(1);
    controller.destroy();
  });

  it('中部向右滑动 → 掀回上一页', () => {
    const { controller } = createController();
    controller.autoFlip('forward'); // 先到第 1 页
    advance(controller, 1300);
    expect(controller.currentPage).toBe(1);
    pointer(controller, 'down', 250, 350, 2000);
    pointer(controller, 'move', 280, 350, 2100); // 向右 → backward
    expect(controller['session']?.action).toBe('backward');
    pointer(controller, 'move', 360, 348, 2200);
    pointer(controller, 'up', 365, 348, 2210); // 释放落在采样窗内 → 构成甩动
    advance(controller, 1300);
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
      advance(controller, 1300);
    }
    expect(controller.currentPage).toBe(total - 1);
    controller.autoFlip('forward'); // 边界 → 回弹
    advance(controller, 400); // 前半段
    advance(controller, 1300); // 回弹段
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
    advance(controller, 1300); // 第一段补间完成 → 消费队列
    expect(controller.currentPage).toBe(1);
    expect(controller['phase']).toBe('snap'); // 队列脉冲已接续为新的 snap
    advance(controller, 1300);
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

describe('FlipController 四向装订（bindEdge）', () => {
  const VIEW: PageSize = { width: 500, height: 700 };

  function createControllerWith(options: Parameters<typeof createStubProvider>[0]) {
    const { fakeCanvas, adapter } = createStubs();
    const controller = new FlipController(fakeCanvas, { renderer: adapter });
    controller.setViewport(VIEW.width, VIEW.height, 1);
    const provider: PageProvider = createStubProvider(options);
    controller.setProvider(provider);
    return { controller, adapter };
  }

  it('top 装订：屏幕底缘 = 规范自由边 → 捏底边抓取为 forward（页底边向上翻）', () => {
    // 横页 aspect 1.45：470×324，居中 y ∈ [188, 512]
    const { controller } = createControllerWith({ bindEdge: 'top', aspect: 1.45 });
    pointer(controller, 'down', 250, 504, 1000); // 屏幕底缘中部
    expect(controller['bindEdge']).toBe('top');
    expect(controller['session']?.action).toBe('forward');
    expect(controller['session']?.mode).toBe('edge');
    // 规范空间抓取点在自由边（x = W_c）
    expect(controller['session']?.grab.x).toBeCloseTo(controller['page'].width, 1);
    controller.destroy();
  });

  it('top 装订：屏幕上拖 = forward（规范 x 减小）', () => {
    const { controller } = createControllerWith({ bindEdge: 'top', aspect: 1.45 });
    pointer(controller, 'down', 250, 350, 1000); // 页面中部
    pointer(controller, 'move', 250, 330, 1100); // 上拖 20px
    expect(controller['session']?.inputMode).toBe('swipe');
    expect(controller['session']?.action).toBe('forward');
    pointer(controller, 'move', 250, 260, 1200); // 继续上拖
    expect(controller['pose']?.progress).toBeGreaterThan(0);
    controller.destroy();
  });

  it('bottom 装订：屏幕顶缘 = 规范自由边 → 抓顶边为 forward（页顶边向下翻）', () => {
    const { controller } = createControllerWith({ bindEdge: 'bottom', aspect: 1.45 });
    pointer(controller, 'down', 250, 196, 1000); // 屏幕顶缘中部
    expect(controller['session']?.action).toBe('forward');
    expect(controller['session']?.grab.x).toBeCloseTo(controller['page'].width, 1);
    controller.destroy();
  });

  it('right 装订：屏幕左缘 = 规范自由边 → 捏左缘为 forward（向右掀）', () => {
    const { controller } = createControllerWith({ orientation: 'rtl' });
    pointer(controller, 'down', 40, 350, 1000);
    expect(controller['session']?.action).toBe('forward');
    expect(controller['session']?.grab.x).toBeCloseTo(controller['page'].width, 1);
    controller.destroy();
  });

  it('top 装订键盘轴：↑ = 下一页、↓ = 上一页；bottom 相反', () => {
    const top = createControllerWith({ bindEdge: 'top', aspect: 1.45 });
    expect(top.controller['keyAxisFor']('top')).toEqual({ dir: 'y', sign: 1 });
    expect(top.controller['input']['keyAxis']).toEqual({ dir: 'y', sign: 1 });
    top.controller.destroy();
    const bottom = createControllerWith({ bindEdge: 'bottom', aspect: 1.45 });
    expect(bottom.controller['keyAxisFor']('bottom')).toEqual({ dir: 'y', sign: -1 });
    bottom.controller.destroy();
    const left = createControllerWith({});
    expect(left.controller['keyAxisFor']('left')).toEqual({ dir: 'x', sign: 1 });
    left.controller.destroy();
  });

  it('top 装订下自动翻页到边界：橡皮筋回弹（规范语义不变）', () => {
    const { controller } = createControllerWith({ bindEdge: 'top', aspect: 1.45, pageCount: 2 });
    controller.autoFlip('forward');
    advance(controller, 1300);
    expect(controller.currentPage).toBe(1);
    controller.autoFlip('forward'); // 末页 → 回弹
    expect(controller['session']?.pendingReturn).toBe(true);
    advance(controller, 500);
    advance(controller, 600);
    expect(controller.currentPage).toBe(1);
    controller.destroy();
  });
});

describe('FlipController 双页模式（spread）', () => {
  const VIEW: PageSize = { width: 500, height: 700 };

  function createSpreadController(pageCount = 6) {
    const { fakeCanvas, adapter } = createStubs();
    const controller = new FlipController(fakeCanvas, { renderer: adapter });
    controller.setViewport(VIEW.width, VIEW.height, 1);
    const provider: PageProvider = createStubProvider({ bindEdge: 'left', pageCount });
    controller.setProvider(provider);
    controller.setViewMode('spread');
    // 双页布局：aspect 0.68 → 每面 235×345.6，书脊 x=250，右面 x∈[250,485]
    return { controller, adapter };
  }

  it('分页契约：spread s = [面 2s−1, 面 2s]，封面 spread 左面为空', () => {
    const { controller, adapter } = createSpreadController();
    expect(controller.viewMode).toBe('spread');
    advance(controller, 32);
    expect(adapter.lastState?.spread?.leftPage).toBeNull();
    expect(adapter.lastState?.spread?.rightPage).toBe(0);
    controller.autoFlip('forward');
    advance(controller, 1300);
    expect(controller.currentPage).toBe(1);
    advance(controller, 32);
    expect(adapter.lastState?.spread?.leftPage).toBe(1);
    expect(adapter.lastState?.spread?.rightPage).toBe(2);
    controller.destroy();
  });

  it('右面捏角抓取 = 语义 forward（side right，折痕数学 forward）', () => {
    const { controller } = createSpreadController();
    pointer(controller, 'down', 478, 515, 1000); // 右面右下角
    expect(controller['session']?.side).toBe('right');
    expect(controller['session']?.semanticAction).toBe('forward');
    expect(controller['session']?.action).toBe('forward');
    controller.destroy();
  });

  it('左面捏角抓取 = 语义 backward（side left，折痕数学 forward——书脊居中右翻）', () => {
    const { controller } = createSpreadController();
    controller.autoFlip('forward');
    advance(controller, 1300); // 先到 spread 1（有左面）
    pointer(controller, 'down', 22, 515, 2000); // 左面左下角
    expect(controller['session']?.side).toBe('left');
    expect(controller['session']?.semanticAction).toBe('backward');
    expect(controller['session']?.action).toBe('forward');
    controller.destroy();
  });

  it('左面中部右拖 → backward swipe；右面中部左拖 → forward swipe', () => {
    const { controller } = createSpreadController();
    controller.autoFlip('forward');
    advance(controller, 1300);    pointer(controller, 'down', 130, 350, 2000); // 左面中部
    pointer(controller, 'move', 150, 350, 2100); // 右拖
    expect(controller['session']?.inputMode).toBe('swipe');
    expect(controller['session']?.semanticAction).toBe('backward');
    pointer(controller, 'move', 300, 350, 2150); // drag past spine
    pointer(controller, 'up', 302, 350, 2200);
    advance(controller, 1300);
    expect(controller.currentPage).toBe(0);
    controller.destroy();
  });

  it('spread 末页 forward → 橡皮筋回弹（偶数面数末 spread 左侧孤页可达）', () => {
    const { controller, adapter } = createSpreadController(4); // 4 面 → spreadCount 3（末 spread = [面 3, null]）
    controller.autoFlip('forward');
    advance(controller, 1300);
    expect(controller.currentPage).toBe(1);
    controller.autoFlip('forward');
    advance(controller, 1300);
    // 末 spread：左侧孤页 = 面 3，右面为空
    expect(controller.currentPage).toBe(2);
    expect(adapter.lastState?.spread?.leftPage).toBe(3);
    expect(adapter.lastState?.spread?.rightPage).toBeNull();
    controller.autoFlip('forward'); // 已是末 spread → 回弹
    expect(controller['session']?.pendingReturn).toBe(true);
    advance(controller, 500);
    advance(controller, 600);
    expect(controller.currentPage).toBe(2);
    controller.destroy();
  });

  it('偶数面数（6 面）末面可达：3 次 forward 到末 spread，backward 可翻回', () => {
    const { controller, adapter } = createSpreadController(6);
    controller.autoFlip('forward');
    advance(controller, 1300);
    controller.autoFlip('forward');
    advance(controller, 1300);
    controller.autoFlip('forward');
    advance(controller, 1300);
    expect(controller.currentPage).toBe(3);
    expect(adapter.lastState?.spread?.leftPage).toBe(5);
    expect(adapter.lastState?.spread?.rightPage).toBeNull();
    controller.autoFlip('backward');
    advance(controller, 1300);
    expect(controller.currentPage).toBe(2);
    expect(adapter.lastState?.spread?.leftPage).toBe(3);
    expect(adapter.lastState?.spread?.rightPage).toBe(4);
    controller.destroy();
  });

  it('非 left 装订回退单页（双页仅支持左右对开 LTR）', () => {
    const { fakeCanvas, adapter } = createStubs();
    const controller = new FlipController(fakeCanvas, { renderer: adapter });
    controller.setViewport(VIEW.width, VIEW.height, 1);
    const provider: PageProvider = createStubProvider({ orientation: 'rtl' });
    controller.setProvider(provider);
    controller.setViewMode('spread');
    expect(controller.viewMode).toBe('single');
    controller.destroy();
  });

  it('翻动期间被翻侧保留旧面（淡出层），动画结束才切目标面', () => {
    const { controller, adapter } = createSpreadController();
    controller.autoFlip('forward');
    advance(controller, 1300); // spread 1（左面 = 面 1）
    controller.autoFlip('forward');
    advance(controller, 200); // 动画中段
    expect(adapter.lastState?.spread?.leftPage).toBe(3); // 目标左面（压底）
    expect(adapter.lastState?.spread?.fadingFace).toEqual({ page: 1, side: 'left' }); // 旧左面淡出层
    expect(adapter.lastState?.spread?.rightPage).toBe(4); // 目标右面
    expect(adapter.lastState?.spread?.flipping).toEqual({ page: 2, side: 'right' });
    advance(controller, 1300);
    expect(adapter.lastState?.spread?.leftPage).toBe(3); // 完成后 = 目标左面
    expect(adapter.lastState?.spread?.fadingFace).toBeNull();
    expect(adapter.lastState?.spread?.flipping).toBeNull();
    controller.destroy();
  });

  it('封面 spread 翻页无旧左面 → 淡出层为 null', () => {
    const { controller, adapter } = createSpreadController();
    controller.autoFlip('forward');
    advance(controller, 200);
    expect(adapter.lastState?.spread?.fadingFace).toBeNull(); // 封面 spread 无左面
    advance(controller, 1300);
    controller.destroy();
  });

  it('左面点击（tap）触发语义 backward 而非 forward', () => {
    const { controller } = createSpreadController();
    controller.autoFlip('forward');
    advance(controller, 1300); // spread 1（有左面）
    pointer(controller, 'down', 30, 510, 2000); // 左面左下角
    pointer(controller, 'up', 32, 512, 2100); // 无位移短按
    expect(controller['phase']).toBe('snap');
    expect(controller['session']?.semanticAction).toBe('backward');
    advance(controller, 1300);
    expect(controller.currentPage).toBe(0);
    controller.destroy();
  });
});

describe('FlipController 跳页 / 事件 / 悬停预览 / 纹理容量', () => {
  const VIEW: PageSize = { width: 500, height: 700 };

  function createController(options?: {
    providerOptions?: Parameters<typeof createStubProvider>[0];
    spread?: boolean;
    onFlipStart?: (info: unknown) => void;
    onFlipEnd?: (info: unknown) => void;
  }) {
    const { fakeCanvas, adapter } = createStubs();
    const controller = new FlipController(fakeCanvas, {
      renderer: adapter,
      onFlipStart: options?.onFlipStart as never,
      onFlipEnd: options?.onFlipEnd as never,
    });
    controller.setViewport(VIEW.width, VIEW.height, 1);
    const provider: PageProvider = createStubProvider(options?.providerOptions);
    controller.setProvider(provider);
    if (options?.spread) {
      controller.setViewMode('spread');
    }
    return { controller, adapter, provider };
  }

  it('goToPage：单页跳页 + 越界钳制', () => {
    const { controller } = createController({ providerOptions: { pageCount: 8 } });
    controller.goToPage(4);
    expect(controller.currentPage).toBe(4);
    expect(controller['pose']).toBeNull();
    expect(controller['phase']).toBe('idle');
    controller.goToPage(99);
    expect(controller.currentPage).toBe(7);
    controller.goToPage(-3);
    expect(controller.currentPage).toBe(0);
    controller.destroy();
  });

  it('goToPage：双页跳 spread，中断中的翻页被丢弃', () => {
    const { controller, adapter } = createController({ providerOptions: { pageCount: 8 }, spread: true });
    controller.autoFlip('forward');
    advance(controller, 200); // snap 进行中
    controller.goToPage(3); // spreadCount = 5 → s=3 = [面 5, 面 6]
    expect(controller.currentPage).toBe(3);
    expect(controller['session']).toBeNull();
    advance(controller, 32);
    expect(adapter.lastState?.spread?.leftPage).toBe(5);
    expect(adapter.lastState?.spread?.rightPage).toBe(6);
    controller.destroy();
  });

  it('next / prev 语义化别名', () => {
    const { controller } = createController();
    controller.next();
    advance(controller, 1300);
    expect(controller.currentPage).toBe(1);
    controller.prev();
    advance(controller, 1300);
    expect(controller.currentPage).toBe(0);
    controller.destroy();
  });

  it('onFlipStart / onFlipEnd：完成翻页与回弹分别上报', () => {
    const starts: Array<{ action: string; fromPage: number; toPage: number }> = [];
    const ends: Array<{ action: string; fromPage: number; toPage: number; completed: boolean }> = [];
    const { controller } = createController({
      onFlipStart: (info) => starts.push(info as { action: string; fromPage: number; toPage: number }),
      onFlipEnd: (info) => ends.push(info as { action: string; completed: boolean; fromPage: number; toPage: number }),
    });
    // 快甩完成
    pointer(controller, 'down', 462, 350, 1000);
    pointer(controller, 'move', 362, 350, 1060);
    pointer(controller, 'up', 352, 350, 1110);
    advance(controller, 1300);
    expect(starts.length).toBe(1);
    expect(ends.length).toBe(1);
    expect(ends[0]).toMatchObject({ action: 'forward', fromPage: 0, toPage: 1, completed: true });
    // 边界回弹
    controller.goToPage(5); // 6 页 → 末页
    controller.autoFlip('forward');
    advance(controller, 400);
    advance(controller, 1300); // 去程段完成 → 转入回程段
    advance(controller, 1300); // 回程段完成 → end 上报
    expect(starts.length).toBe(2);
    expect(ends[1]).toMatchObject({ action: 'forward', fromPage: 5, toPage: 5, completed: false });
    controller.destroy();
  });

  it('tap 打断会话 → 上报未完成 end，再由 autoFlip 发起新 start', () => {
    const starts: unknown[] = [];
    const ends: Array<{ completed: boolean }> = [];
    const { controller } = createController({
      onFlipStart: (info) => starts.push(info),
      onFlipEnd: (info) => ends.push(info as { completed: boolean }),
    });
    pointer(controller, 'down', 462, 350, 1000);
    pointer(controller, 'up', 464, 350, 1060); // 无位移短按 → tap → autoFlip
    advance(controller, 1300);
    expect(ends[0]).toMatchObject({ completed: false });
    expect(ends[1]).toMatchObject({ completed: true });
    expect(starts.length).toBe(2);
    expect(controller.currentPage).toBe(1);
    controller.destroy();
  });

  it('悬停预览：接近角部出现轻量预览姿态，离开热区清除；边缘悬停不预览', () => {
    const { controller, adapter } = createController({ providerOptions: { pageCount: 6 } });
    // 角部热区（右上角）→ 预览
    controller['handleHover'](455, 45);
    advance(controller, 32);
    expect(adapter.lastState?.pose).not.toBeNull();
    expect(adapter.lastState?.flippingPage).toBe(0);
    expect(adapter.lastState?.underPage).toBe(1);
    expect(adapter.lastState?.pose?.progress ?? 1).toBeLessThan(0.2);
    // 边缘热区（右缘中部）→ 不掀页预览；单页无中缝，弯折不生效
    controller['handleHover'](462, 350);
    advance(controller, 32);
    expect(adapter.lastState?.pose).toBeNull();
    expect(controller['hover']).toBeNull();
    expect(adapter.lastState?.gutterFlex).toBe(0);
    // 离开热区（页面中部）→ 弯折渐出
    controller['handleHover'](250, 350);
    expect(controller['flexTarget']).toBe(0);
    for (let i = 0; i < 30; i++) advance(controller, 16);
    expect(controller['flexK']).toBe(0);
    expect(adapter.lastState?.gutterFlex).toBe(0);
    // 拖拽会话中悬停被忽略
    controller['handleHover'](455, 45);
    pointer(controller, 'down', 455, 45, 1300);
    controller['handleHover'](450, 45);
    expect(controller['phase']).toBe('drag');
    expect(controller['hover']).toBeNull();
    controller.destroy();
  });

  it('双页悬停预览：左面悬停 = 语义 backward 的预览（折痕数学 forward）', () => {
    const { controller, adapter } = createController({ providerOptions: { pageCount: 6 }, spread: true });
    controller.autoFlip('forward');
    advance(controller, 1300); // spread 1
    controller['handleHover'](22, 515); // 左面左下角（frame right 的自由边）
    advance(controller, 32);
    expect(adapter.lastState?.spread?.flipping).toEqual({ page: 1, side: 'left' });
    // 预览不提前揭示其他页内容：另一侧保持当前面（面 2），无淡出层
    expect(adapter.lastState?.spread?.rightPage).toBe(2);
    expect(adapter.lastState?.spread?.fadingFace).toBeNull();
    expect(adapter.lastState?.pose?.progress ?? 1).toBeLessThan(0.2);
    controller.destroy();
  });

  it('双页悬停预览：封面 spread 左侧保持为空（不提前揭示面 1）', () => {
    const { controller, adapter } = createController({ providerOptions: { pageCount: 6 }, spread: true });
    controller['handleHover'](470, 195); // 右面右上角悬停（s=0 封面 spread，角部热区）
    advance(controller, 32);
    expect(adapter.lastState?.spread?.flipping).toEqual({ page: 0, side: 'right' });
    expect(adapter.lastState?.spread?.leftPage).toBeNull(); // 左侧为空——目标面不提前出现
    expect(adapter.lastState?.spread?.rightPage).toBe(2); // 翻动侧下方揭示目标右面
    controller.destroy();
  });

  it('双页纹理预取：wanted 不超缓存容量，连续帧后 wanted 全部就位（LRU 抖动回归）', () => {
    const { controller } = createController({ providerOptions: { pageCount: 10 }, spread: true });
    controller.goToPage(2); // spread 2：wanted = 面 3,4,5,6,1,2（6 面）< 容量 8
    for (let i = 0; i < 16; i++) {
      advance(controller, 16); // 回填排空
    }
    const cache = controller['textures']!;
    const cached = new Set([...cache['cache'].keys()]);
    for (const index of [1, 2, 3, 4, 5, 6]) {
      expect(cached.has(index)).toBe(true);
    }
    expect(cache['cache'].size).toBeLessThanOrEqual(8);
    controller.destroy();
  });

  it('空闲停帧：干净且静止时帧循环不再自续（rafActive 复位）', () => {
    const { controller } = createController();
    advance(controller, 32);
    expect(controller['rafActive']).toBe(false);
    controller.autoFlip('forward');
    expect(controller['rafActive']).toBe(true); // 会话启动唤醒
    advance(controller, 1300);
    advance(controller, 16);
    expect(controller['rafActive']).toBe(false);
    controller.destroy();
  });
});

describe('FlipController 书脊弯折（边缘悬停）', () => {
  const VIEW: PageSize = { width: 500, height: 700 };

  function createController(options?: { providerOptions?: Parameters<typeof createStubProvider>[0] }) {
    const { fakeCanvas, adapter } = createStubs();
    const controller = new FlipController(fakeCanvas, { renderer: adapter });
    controller.setViewport(VIEW.width, VIEW.height, 1);
    const provider: PageProvider = createStubProvider(options?.providerOptions);
    controller.setProvider(provider);
    return { controller, adapter, provider };
  }

  it('双页边缘悬停：弯折渐入至 1，离开后渐出归零', () => {
    const { controller, adapter } = createController({ providerOptions: { pageCount: 6 } });
    controller.setViewMode('spread');
    controller['handleHover'](470, 350); // 右面右缘中部 → 边缘弯折
    expect(controller['flexTarget']).toBe(1);
    expect(controller['hover']).toBeNull(); // 不掀页
    advance(controller, 32);
    expect(adapter.lastState?.gutterFlex).toBeGreaterThan(0.2);
    for (let i = 0; i < 30; i++) advance(controller, 16); // 渐入完成（指数收敛吸附）
    expect(controller['flexK']).toBe(1);
    expect(adapter.lastState?.gutterFlex).toBe(1);
    // 离开热区 → 渐出归零
    controller['handleHover'](60, 350); // 左面自由边缘（边缘热区，弯折保持）
    expect(controller['flexTarget']).toBe(1);
    controller['handleHover'](250, 350); // 页面中部 → 渐出
    expect(controller['flexTarget']).toBe(0);
    for (let i = 0; i < 30; i++) advance(controller, 16);
    expect(controller['flexK']).toBe(0);
    expect(adapter.lastState?.gutterFlex).toBe(0);
    controller.destroy();
  });

  it('单页模式边缘悬停无书脊弯折（中缝不存在）', () => {
    const { controller, adapter } = createController({ providerOptions: { pageCount: 6 } });
    controller['handleHover'](462, 350); // 右缘（边缘热区）
    expect(controller['flexTarget']).toBe(0); // 单页无中缝：弯折不启动
    advance(controller, 32);
    expect(adapter.lastState?.gutterFlex).toBe(0); // 单页不呈现弯折
    controller.destroy();
  });
});
