/**
 * 翻页控制器：手势状态机 + 渲染调度。
 *
 * 状态：idle（静止）/ drag（拖拽跟随）/ snap（补间：完成翻页或回弹）。
 * - 拖拽：触点一阶低通后实时求解折痕姿态（跟手且无抖动）；
 * - 松手：按「进度阈值 OR 甩动速度」判定完成或回弹，补间可被新手势打断；
 * - 点击边/角、键盘、滚轮 → 自动翻页；边界处做橡皮筋回弹；
 * - 完成 forward：当前页 = 下一页；完成 backward：当前页 = 上一页；
 *   换页瞬间翻动页与下层页几何无缝衔接，无跳变。
 * - 装订侧（bindEdge：left/right/top/bottom）：屏幕 ↔ 规范空间经
 *   page-frame 映射，全部几何与手势在规范空间（书脊恒 x=0）求解——
 *   四向装订共享同一套数学，仅输入映射 / 渲染帧 / 键盘轴随装订侧变化。
 */
import {
  clamp,
  clampTouch,
  createFoldSession,
  smoothstep,
  solveFoldPose,
  type FoldSession,
} from './curl-model';
import { decideRelease, resolveGrabZone, snapDurationFor, type GrabZone } from './flip-decisions';
import { GlRenderer } from './gl-renderer';
import { InputSource, isTap } from './input';
import { canonicalSize, resolveBindEdge, screenToCanonical } from './page-frame';
import { PageBitmapSource } from './page-provider';
import { TextureStore } from './texture-store';
import {
  resolveFlipConfig,
  type BindEdge,
  type FlipAction,
  type FlipConfig,
  type FlipRenderAdapter,
  type FlipSceneState,
  type FoldPose,
  type GrabMode,
  type PageProvider,
  type PageSize,
  type Point,
  type ViewMode,
} from './types';

type Phase = 'idle' | 'drag' | 'snap';

/** 双页模式的翻动侧。 */
type SpreadSide = 'left' | 'right';

interface FlipSessionState {
  action: FlipAction;
  /**
   * 语义动作（页码记账依据）：单页 = action；双页 = 右侧翻动为 forward、
   * 左侧翻动为 backward——折痕数学（action）在双页下恒为 forward。
   */
  semanticAction: FlipAction;
  /** 双页翻动侧（单页恒 'right'，不参与逻辑）。 */
  side: SpreadSide;
  mode: GrabMode;
  grab: Point;
  session: FoldSession;
  fromPage: number;
  underPage: number;
  /** 拖拽进度上限（边界橡皮筋）。 */
  progressCap: number;
  /** 输入语义：grab = 边/角抓取（触点即手指）；swipe = 中部滑动（位移折算行程）。 */
  inputMode: 'grab' | 'swipe';
  /** swipe 模式的位移原点（规范空间坐标）。 */
  swipeOrigin: Point;
  /**
   * snap 补间的触点直线路径（起 → 止）：折痕沿中垂线族全程连续——
   * 完成态止点 = 抓取点跨装订侧的镜像位（折痕恰好落在书脊/自由缘上，
   * 整页翻过），取消/回弹止点 = 抓取点（折痕收拢回平贴）。
   */
  snapTouchFrom: Point;
  snapTouchTo: Point;
  /** 本次 snap 是否为完成翻页（区别于回弹/取消）。 */
  snapCompletes: boolean;
  snapStart: number;
  snapDuration: number;
  /** 补间缓动：autoFlip = inOut（起步慢、中段快）；拖拽释放 = out（惯性延续）。 */
  snapEasing: 'out' | 'inOut';
  /** 到达终点后是否再弹回抓取点（边界回弹）。 */
  pendingReturn: boolean;
  /** 最近一次解算用的触点（snap 中被新手势接管时无缝接续）。 */
  lastTouch: Point;
}

/** 翻页事件负载（页码为语义口径：单页 = 页索引，双页 = spread 索引）。 */
export interface FlipEventInfo {
  /** 语义动作（双页下左面翻动也为 backward）。 */
  action: FlipAction;
  /** 起始页 / spread。 */
  fromPage: number;
  /** 目标页 / spread（边界回弹时 = fromPage）。 */
  toPage: number;
}

export interface FlipControllerOptions {
  config?: FlipConfig;
  onStateChange?: (currentPage: number) => void;
  /** 翻页开始（抓取会话 / 中部滑动提交 / 自动翻页与边界回弹）。 */
  onFlipStart?: (info: FlipEventInfo) => void;
  /** 翻页结束；completed = 是否完成翻页（回弹 / 取消 / 被跳页打断为 false）。 */
  onFlipEnd?: (info: FlipEventInfo & { completed: boolean }) => void;
  /** 注入渲染适配器（默认创建 GlRenderer；测试注入桩实现）。 */
  renderer?: FlipRenderAdapter;
}

export class FlipController {
  currentPage = 0;
  fps = 0;
  /** 调试视图开关；赋值即请求重绘（帧循环仅在 dirty 时出帧）。 */
  get debug(): boolean {
    return this.debugFlag;
  }
  set debug(value: boolean) {
    if (this.debugFlag === value) {
      return;
    }
    this.debugFlag = value;
    this.markDirty();
  }
  private debugFlag = false;
  private phase: Phase = 'idle';
  private session: FlipSessionState | null = null;
  /** 悬停预览（idle 态且指针悬于抓取热区；仅鼠标 / 笔 hover 触发）。 */
  private hover: { zone: GrabZone; side: SpreadSide; pose: FoldPose } | null = null;
  /** 书脊弯折（边缘悬停）：当前强度 0..1 与目标（tick 内渐入渐出）。 */
  private flexK = 0;
  private flexTarget = 0;
  private rawTouch: Point = { x: 0, y: 0 };
  private filteredTouch: Point = { x: 0, y: 0 };
  private pose: FoldPose | null = null;
  private downTime = 0;
  private downScreen: Point = { x: 0, y: 0 };
  /** 中部滑动的待判定起点（屏幕坐标；提交判定在规范空间进行）。 */
  private pendingSwipe: { x: number; y: number } | null = null;
  /** snap 期间收到的最后一条翻页脉冲（键盘/滚轮），补间结束后接续执行。 */
  private queuedPulse: FlipAction | null = null;
  private samples: Array<{ time: number; dist: number }> = [];
  private provider: PageProvider | null = null;
  private bitmapSource: PageBitmapSource | null = null;
  private textures: TextureStore | null = null;
  /** 屏幕页面矩形（舞台内，CSS px）。单页 = 整页；双页 = 右侧面矩形。 */
  private pageRect = { x: 0, y: 0, width: 0, height: 0 };
  /** 双页模式左侧面矩形（书脊 = pageRect 左缘；单页恒 null）。 */
  private leftRect = { x: 0, y: 0, width: 0, height: 0 };
  /** 装订侧（粘胶侧）：left/right/top/bottom。 */
  private bindEdge: BindEdge = 'left';
  /** 视图模式（单页 / 双页对开；双页仅 left 装订生效）。 */
  private viewModeFlag: ViewMode;
  private viewSize: PageSize = { width: 0, height: 0 };
  private dpr = 1;
  private rafId = 0;
  /** 帧循环是否在排程（空闲停帧：干净且静止时停转，事件/脏标记唤醒）。 */
  private rafActive = false;
  /** 纹理失效防抖计时器（连续 resize 期间保留旧纹理，停稳后统一换新）。 */
  private textureInvalidateTimer = 0;
  private lastFrame = 0;
  private fpsSamples: number[] = [];
  private readonly config: FlipConfig;
  private readonly onStateChange: ((currentPage: number) => void) | undefined;
  private readonly onFlipStart: ((info: FlipEventInfo) => void) | undefined;
  private readonly onFlipEnd: ((info: FlipEventInfo & { completed: boolean }) => void) | undefined;
  private input: InputSource;
  private readonly renderer: FlipRenderAdapter;

  constructor(private readonly canvas: HTMLCanvasElement, options: FlipControllerOptions = {}) {
    this.config = resolveFlipConfig(options.config);
    this.viewModeFlag = this.config.behavior.viewMode;
    this.onStateChange = options.onStateChange;
    this.onFlipStart = options.onFlipStart;
    this.onFlipEnd = options.onFlipEnd;
    this.renderer = options.renderer ?? new GlRenderer(canvas, () => this.textures?.clear());
    this.renderer.setRenderOptions?.(this.config.render);
    this.textures = new TextureStore(this.renderer.gl, this.renderer.isWebGL2, {
      maxEntries: this.config.render.textureCacheSize,
    });
    this.input = new InputSource(
      canvas,
      {
        onPointer: (event) => this.onPointer(event),
        onHover: (x, y) => this.handleHover(x, y),
        onHoverEnd: () => this.clearHover(),
        onWheelPulse: (direction) => {
          if (this.config.behavior.enableWheel) {
            this.autoFlip(direction > 0 ? 'forward' : 'backward');
          }
        },
        onKeyPulse: (direction) => {
          if (this.config.behavior.enableKeyboard) {
            this.autoFlip(direction > 0 ? 'forward' : 'backward');
          }
        },
      },
      {
        tapMaxMs: this.config.interaction.tapMaxMs,
        tapMaxDist: this.config.interaction.tapMaxDist,
        wheelThreshold: this.config.interaction.wheelThreshold,
        wheelCooldownMs: this.config.interaction.wheelCooldownMs,
      }
    );
    this.schedule();
  }

  /** 绑定页面内容提供者（切换书源时重置到第 0 页）。 */
  setProvider(provider: PageProvider): void {
    this.discardSession();
    this.provider = provider;
    this.bindEdge = resolveBindEdge(provider);
    this.input.setKeyAxis(this.keyAxisFor(this.bindEdge));
    this.currentPage = 0;
    this.bitmapSource = new PageBitmapSource(provider, this.pageSize(), this.dpr);
    this.textures?.clear();
    this.prefetchTextures(true); // 立即回填可见面（避免预算 1 张/帧的连续数帧缺页）
    this.layout();
    // 内容就绪（图片类 provider 异步解码）后重灌纹理：突发阶段绘制的
    // 是未就绪占位图，缓存命中不会自动刷新，必须显式失效
    void provider.ready.then(() => {
      if (this.provider !== provider || !this.textures) {
        return;
      }
      this.textures.clear();
      this.prefetchTextures(true);
      this.markDirty();
    });
    this.emitState();
  }

  /** 视口尺寸变化：重排页面矩形并适配渲染分辨率。 */
  setViewport(cssWidth: number, cssHeight: number, dpr: number): void {
    this.viewSize = { width: cssWidth, height: cssHeight };
    const dprChanged = Math.min(dpr, this.config.render.dprCap) !== this.dpr;
    const oldScreen = this.screenPage;
    this.dpr = Math.min(dpr, this.config.render.dprCap);
    this.layout();
    this.renderer.resize(cssWidth, cssHeight, this.dpr);
    const pageChanged =
      dprChanged ||
      Math.abs(this.screenPage.width - oldScreen.width) > 0.5 ||
      Math.abs(this.screenPage.height - oldScreen.height) > 0.5;
    if (pageChanged && this.provider) {
      // 位图像素尺寸随页面尺寸/dpr 变化，旧纹理全部失效。
      // 防抖失效：连续 resize 期间保留旧纹理（内容拉伸但无缺页黑洞），
      // 停稳后统一清空并突发回填。
      this.bitmapSource = new PageBitmapSource(this.provider, this.screenPage, this.dpr);
      this.scheduleTextureInvalidate();
    }
  }

  destroy(): void {
    this.cancelSchedule();
    if (this.textureInvalidateTimer) {
      clearTimeout(this.textureInvalidateTimer);
      this.textureInvalidateTimer = 0;
    }
    this.input.dispose();
    this.queuedPulse = null;
    this.hover = null;
    this.textures?.dispose();
    this.renderer.dispose();
  }

  private schedule(): void {
    if (this.rafActive) {
      return; // 已排程（空闲停帧：仅由 markDirty / 会话启动唤醒）
    }
    this.rafActive = true;
    if (typeof requestAnimationFrame === 'function') {
      this.rafId = requestAnimationFrame(this.tick);
    } else {
      // 非 DOM 环境（headless 测试）：退化为定时器
      this.rafId = setTimeout(() => this.tick(performance.now()), 16) as unknown as number;
    }
  }

  private cancelSchedule(): void {
    this.rafActive = false;
    if (typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.rafId);
    }
    clearTimeout(this.rafId);
  }

  private dirty = false;

  /** 请求重绘并唤醒帧循环（空闲停帧下的事件入口）。 */
  private markDirty(): void {
    this.dirty = true;
    this.schedule();
  }

  /** 纹理失效防抖：连续 resize 期间保留旧纹理渲染（拉伸显示），停稳后统一换新。 */
  private scheduleTextureInvalidate(): void {
    if (this.textureInvalidateTimer) {
      clearTimeout(this.textureInvalidateTimer);
    }
    this.textureInvalidateTimer = setTimeout(() => {
      this.textureInvalidateTimer = 0;
      this.textures?.clear();
      this.prefetchTextures(true); // 突发回填可见面，避免数帧缺页
      this.markDirty();
    }, 160) as unknown as number;
  }

  /** 视图模式（单页 / 双页对开）。双页仅 left 装订生效，其余装订侧自动回退单页。 */
  get viewMode(): ViewMode {
    return this.effectiveViewMode();
  }

  /** 是否有翻页会话进行中（拖拽或补间）。 */
  get isFlipping(): boolean {
    return this.phase !== 'idle';
  }

  /** 跳页（无动画）：单页 = 页索引，双页 = spread 索引。越界自动钳制。 */
  goToPage(page: number): void {
    if (!this.provider) {
      return;
    }
    const max =
      this.effectiveViewMode() === 'spread' ? this.spreadCount() - 1 : this.pageCount() - 1;
    const target = clamp(Math.round(page), 0, Math.max(0, max));
    this.discardSession();
    this.currentPage = target;
    this.prefetchTextures(true); // 跳页立即回填可见面（无动画，缺页会直接露黑）
    this.markDirty();
    this.emitState();
  }

  /** 前翻一页（等价 autoFlip('backward')，供消费方语义化调用）。 */
  prev(): void {
    this.autoFlip('backward');
  }

  /** 后翻一页（等价 autoFlip('forward')，供消费方语义化调用）。 */
  next(): void {
    this.autoFlip('forward');
  }

  /** 切换视图模式（重排并回到首个 spread / 第 0 页）。 */
  setViewMode(mode: ViewMode): void {
    if (this.viewModeFlag === mode) {
      return;
    }
    this.viewModeFlag = mode;
    this.discardSession();
    this.currentPage = 0;
    this.textures?.clear();
    this.prefetchTextures(true);
    this.layout();
    this.emitState();
    this.markDirty();
  }

  /** 生效视图模式：双页要求 left 装订（上下装订 / right 装订自动回退单页）。 */
  private effectiveViewMode(): ViewMode {
    return this.viewModeFlag === 'spread' && this.bindEdge === 'left' ? 'spread' : 'single';
  }

  /** 双页总数 = ⌊面数/2⌋ + 1（spread s：封面 s=0 右面 = 面 0；
   *  偶数面数时末 spread 左侧孤页 = 面 n−1、右面为空——保证末面可达）。 */
  private spreadCount(): number {
    return Math.floor(this.pageCount() / 2) + 1;
  }

  /** 屏幕页面尺寸（舞台内矩形，位图 / 排版依据）。 */
  private get screenPage(): PageSize {
    return { width: this.pageRect.width, height: this.pageRect.height };
  }

  /** 页面尺寸（规范空间 = CSS 像素）：几何求解统一依据（单页 = 整页，双页 = 单侧面）。 */
  private get page(): PageSize {
    return canonicalSize(this.screenPage, this.bindEdge);
  }

  private pageSize(): PageSize {
    const aspect = this.provider?.aspect ?? 0.68;
    const spread = this.effectiveViewMode() === 'spread';
    const shareW = spread ? 0.5 : 1;
    const maxW = this.viewSize.width * this.config.render.layoutWidthRatio * shareW;
    const maxH = this.viewSize.height * this.config.render.layoutHeightRatio;
    let height = maxH;
    let width = height * aspect;
    if (width > maxW) {
      width = maxW;
      height = width / aspect;
    }
    return { width, height };
  }

  private layout(): void {
    const size = this.pageSize();
    const spread = this.effectiveViewMode() === 'spread';
    // 双页：书脊居中，右面矩形在右、左面镜像；单页：整页居中
    const blockLeft = (this.viewSize.width - (spread ? size.width * 2 : size.width)) / 2;
    this.pageRect = {
      x: blockLeft + (spread ? size.width : 0),
      y: (this.viewSize.height - size.height) / 2,
      width: size.width,
      height: size.height,
    };
    this.leftRect = {
      x: blockLeft,
      y: this.pageRect.y,
      width: size.width,
      height: size.height,
    };
    if (this.bitmapSource) {
      this.bitmapSource.setPageSize(size);
    }
    this.renderer.updateLayout(this.page, this.bindEdge);
    this.markDirty();
  }

  /** 键盘方向轴随装订侧：左右装订 ←→、上装订 ↑↓（↑=下一页）、下装订 ↓=下一页。 */
  private keyAxisFor(edge: BindEdge): { dir: 'x' | 'y'; sign: 1 | -1 } {
    if (edge === 'top') {
      return { dir: 'y', sign: 1 };
    }
    if (edge === 'bottom') {
      return { dir: 'y', sign: -1 };
    }
    return { dir: 'x', sign: 1 };
  }

  // ---------- 指针事件 ----------

  private toCanonical(x: number, y: number): Point {
    return screenToCanonical(
      { x: x - this.pageRect.x, y: y - this.pageRect.y },
      this.screenPage,
      this.bindEdge
    );
  }

  /** 双页：屏幕坐标 → 所在侧的规范空间（左面帧 right、右面帧 left）。 */
  private toSideCanonical(x: number, y: number, side: SpreadSide): Point {
    const rect = side === 'left' ? this.leftRect : this.pageRect;
    const local = { x: x - rect.x, y: y - rect.y };
    return side === 'left'
      ? screenToCanonical(local, this.screenPage, 'right')
      : screenToCanonical(local, this.screenPage, 'left');
  }

  /** 双页：屏幕点落在哪一侧面（书脊 = pageRect 左缘）。 */
  private sideAt(x: number): SpreadSide {
    return x < this.pageRect.x ? 'left' : 'right';
  }

  private onPointer(event: { type: 'down' | 'move' | 'up' | 'cancel'; x: number; y: number; time: number }): void {
    if (event.type === 'down') {
      this.onDown(event);
    } else if (event.type === 'move') {
      this.onMove(event);
    } else if (event.type === 'up') {
      this.onUp(event);
    } else {
      this.onCancel();
    }
  }

  private onDown(event: { x: number; y: number; time: number }): void {
    if (!this.provider) {
      return;
    }
    this.clearHover();
    // snap 进行中：整体接管旧会话为拖拽（几何连续，方向不变）；
    // 边界回弹中的 pendingReturn 不接管。
    if (this.phase === 'snap' && this.session && !this.session.pendingReturn) {
      this.phase = 'drag';
      this.queuedPulse = null; // 用户接管，丢弃排队中的自动翻页脉冲
      const adopted = { ...this.session.lastTouch };
      // swipe 会话：把位移原点平移到当前按下点，使行程从当前进度无缝继续
      //（行程 = 原点.x − 触点.x，规范空间恒成立——见 commitSwipe）
      if (this.session.inputMode === 'swipe') {
        const travel = Math.max(this.axisDist(adopted), 0);
        const adoptedCanonical = this.canonicalAt(event.x, event.y, this.session.side);
        this.session.swipeOrigin = {
          x: adoptedCanonical.x + travel,
          y: adoptedCanonical.y,
        };
      }
      this.downTime = event.time;
      this.downScreen = { x: event.x, y: event.y };
      this.rawTouch = adopted;
      this.filteredTouch = { ...adopted };
      this.samples = [{ time: event.time, dist: this.axisDist(adopted) }];
      this.markDirty();
      return;
    }
    if (this.phase !== 'idle') {
      return;
    }
    const spread = this.effectiveViewMode() === 'spread';
    const side: SpreadSide = spread ? this.sideAt(event.x) : 'right';
    const touch = this.canonicalAt(event.x, event.y, side);
    if (!this.touchWithinPageBounds(touch)) {
      return;
    }
    const zone = this.resolveInteractiveZone(touch);
    this.downTime = event.time;
    this.downScreen = { x: event.x, y: event.y };
    if (!zone) {
      // 页面中部：待定滑动（位移超过阈值后按方向提交为 swipe 会话）
      this.pendingSwipe = this.config.behavior.enableSwipe ? { x: event.x, y: event.y } : null;
      return;
    }
    // 双页：折痕数学恒 forward；语义动作由翻动侧决定
    const foldAction: FlipAction = spread ? 'forward' : zone.action;
    const semanticAction: FlipAction = spread ? (side === 'right' ? 'forward' : 'backward') : zone.action;
    const foldSession = createFoldSession(zone.grab, touch, zone.mode, foldAction, this.page, this.config);
    this.phase = 'drag';
    this.pendingSwipe = null;
    this.session = {
      action: foldAction,
      semanticAction,
      side,
      mode: zone.mode,
      grab: zone.grab,
      session: foldSession,
      // 对称语义：翻动的始终是当前 spread / 当前页（fromPage），下层揭示目标
      fromPage: this.currentPage,
      underPage: semanticAction === 'forward' ? this.currentPage + 1 : this.currentPage - 1,
      progressCap: this.progressCapFor(semanticAction),
      inputMode: 'grab',
      swipeOrigin: { x: event.x, y: event.y },
      snapTouchFrom: { ...touch },
      snapTouchTo: { ...touch },
      snapCompletes: false,
      snapStart: 0,
      snapDuration: 0,
      snapEasing: 'out',
      pendingReturn: false,
      lastTouch: { ...touch },
    };
    this.emitFlipStart(semanticAction, this.currentPage);
    this.rawTouch = touch;
    this.filteredTouch = { ...touch };
    this.samples = [{ time: event.time, dist: this.axisDist(touch) }];
    this.markDirty();
  }

  private onMove(event: { x: number; y: number; time: number }): void {
    // 中部滑动：位移超过阈值后按方向提交为 swipe 会话
    if (this.phase === 'idle' && this.pendingSwipe) {
      this.commitSwipe(event.x, event.y);
    }
    const phase: Phase = this.phase;
    if (phase !== 'drag' || !this.session) {
      return;
    }
    if (this.session.inputMode === 'swipe') {
      // swipe：行程 = 手指沿装订轴（规范 x）向会话方向的有效位移
      const pointer = this.canonicalAt(event.x, event.y, this.session.side);
      const swipeState = this.session;
      const along = swipeState.swipeOrigin.x - pointer.x;
      const travel = Math.min(
        Math.max(swipeState.action === 'forward' ? along : -along, 0),
        swipeState.progressCap * swipeState.session.distEnd
      );
      const grab = swipeState.grab;
      const n = swipeState.session.axisNormal;
      this.rawTouch = {
        x: grab.x - n.x * travel,
        y: grab.y + (pointer.y - swipeState.swipeOrigin.y) * this.config.interaction.swipeVerticalFollow,
      };
      this.samples.push({ time: event.time, dist: travel });
    } else {
      const touch = clampTouch(
        this.canonicalAt(event.x, event.y, this.session.side),
        this.page,
        this.page.width * this.config.geometry.dragMarginRatio
      );
      this.rawTouch = touch;
      // 甩动采样仅对可完成会话有意义（边界橡皮筋松手恒回弹）
      if (this.session.progressCap >= 1) {
        const dist = Math.min(this.axisDist(touch), this.session.session.distEnd);
        this.samples.push({ time: event.time, dist });
      }
    }
    while (this.samples.length > 2 && event.time - this.samples[0].time > 120) {
      this.samples.shift();
    }
  }

  /**
   * 提交中部滑动（规范空间统一判定，四向装订与双页共用）：
   * 位移以装订轴（规范 x）为主且超过阈值才提交；**规范 x 减小 = 折痕 forward**——
   * left 拖左、right 拖右、top 上拖、bottom 下拖、双页右面拖左 / 左面拖右，全部成立。
   * 双页语义动作由翻动侧决定（右面 = forward、左面 = backward）。
   */
  private commitSwipe(x: number, y: number): void {
    const origin = this.pendingSwipe;
    if (!origin) {
      return;
    }
    this.clearHover();
    const spread = this.effectiveViewMode() === 'spread';
    const side: SpreadSide = spread ? this.sideAt(origin.x) : 'right';
    const originC = this.canonicalAt(origin.x, origin.y, side);
    const pointerC = this.canonicalAt(x, y, side);
    const dcx = pointerC.x - originC.x;
    const dcy = pointerC.y - originC.y;
    if (
      Math.hypot(dcx, dcy) < this.config.interaction.swipeCommitDist ||
      Math.abs(dcx) < Math.abs(dcy) * this.config.interaction.swipeCommitOrthoRatio
    ) {
      return; // 位移不足或不沿装订轴：继续等待
    }
    const foldForward = dcx < 0;
    if (spread && !foldForward) {
      return; // 左面反向拖拽 = 折痕 backward：双页无此手势（面贴书脊侧不可掀）
    }
    const action: FlipAction = foldForward ? 'forward' : 'backward';
    const semanticAction: FlipAction = spread ? (side === 'right' ? 'forward' : 'backward') : action;
    this.pendingSwipe = null;
    if (this.progressCapFor(semanticAction) < 1) {
      return; // 该方向到边界：忽略（回弹仅由点击/键盘触发）
    }
    const { width: w, height: h } = this.page;
    const edgeClamp = h * this.config.interaction.edgePressClampRatio;
    const pressCanonicalV = clamp(pointerC.y, edgeClamp, h - edgeClamp);
    const grab: Point = foldForward ? { x: w, y: pressCanonicalV } : { x: 0, y: pressCanonicalV };
    const foldSession = createFoldSession(grab, grab, 'edge', action, this.page, this.config);
    this.phase = 'drag';
    this.session = {
      action,
      semanticAction,
      side,
      mode: 'edge',
      grab,
      session: foldSession,
      // 对称语义：翻动的始终是当前页 / 当前 spread
      fromPage: this.currentPage,
      underPage: semanticAction === 'forward' ? this.currentPage + 1 : this.currentPage - 1,
      progressCap: 1,
      inputMode: 'swipe',
      // 原点保持按下点（规范空间）：提交瞬间即继承从按下到现在的全部行程
      swipeOrigin: { ...originC },
      snapTouchFrom: { ...grab },
      snapTouchTo: { ...grab },
      snapCompletes: false,
      snapStart: 0,
      snapDuration: 0,
      snapEasing: 'out',
      pendingReturn: false,
      lastTouch: { ...grab },
    };
    // 起始姿态：行程 0（触点 = 抓取点）
    this.rawTouch = { ...grab };
    this.filteredTouch = { ...grab };
    this.samples = [];
    this.emitFlipStart(semanticAction, this.currentPage);
    this.markDirty();
  }

  private onUp(event: { x: number; y: number; time: number }): void {
    if (this.phase === 'drag' && this.session) {
      const moved =
        Math.hypot(event.x - this.downScreen.x, event.y - this.downScreen.y) >
        this.config.interaction.tapMaxDist;
      if (isTap(this.downTime, event.time, moved, this.config.interaction.tapMaxMs)) {
        // 点击边/角 → 自动翻页（边界则回弹）；双页下必须用语义动作
        //（折痕数学 action 恒 forward，直接用会让点左面也向前翻）
        const action = this.session.semanticAction;
        this.discardSession();
        this.autoFlip(action);
        return;
      }
      this.finishDrag();
    }
    this.pendingSwipe = null;
  }

  private onCancel(): void {
    this.pendingSwipe = null;
    if (this.phase === 'drag' && this.session) {
      this.startSnap({ ...this.session.grab }, this.config.timing.bounceOutMs, false);
    }
  }

  /** 松手决策：进度阈值 OR 甩动速度（决策逻辑见 flip-decisions）。 */
  private finishDrag(): void {
    const state = this.session;
    if (!state || !this.pose) {
      return;
    }
    const progress = Math.min(this.pose.progress, state.progressCap);
    const decision = decideRelease(progress, this.recentVelocity(), this.config.interaction);
    // 边界橡皮筋会话（cap < 1）不因快甩误判为完成——只能回弹
    const complete = decision === 'complete' && state.progressCap >= 1;
    this.startSnap(
      complete ? this.mirrorTouch(state.grab, state.action) : { ...state.grab },
      snapDurationFor(complete ? 1 - progress : progress, this.config.timing),
      complete
    );
  }

  private recentVelocity(): number {
    if (this.samples.length < 2) {
      return 0;
    }
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    const dt = last.time - first.time;
    if (dt <= 1) {
      return 0;
    }
    return (last.dist - first.dist) / dt;
  }

  private axisDist(touch: Point): number {
    const state = this.session;
    if (!state) {
      return 0;
    }
    const n = state.session.axisNormal;
    return -((touch.x - state.grab.x) * n.x + (touch.y - state.grab.y) * n.y);
  }

  /** 由会话进度反解规范空间触点（回弹目标 / 边界钳制用）。 */
  private virtualTouchAt(grab: Point, fold: FoldSession, progress: number): Point {
    const dist = fold.distEnd * progress;
    return {
      x: grab.x - fold.axisNormal.x * dist,
      y: grab.y - fold.axisNormal.y * dist,
    };
  }

  // ---------- 抓取区判定 ----------

  private resolveGrabZone(touch: Point): { mode: GrabMode; action: FlipAction; grab: Point } | null {
    const { width: w, height: h } = this.page;
    // 纯几何判定：边界方向由 progressCapFor 给出橡皮筋上限（拖拽回弹 / 点击回弹）
    return resolveGrabZone(touch, this.page, {
      cornerRadius: Math.min(w, h) * this.config.geometry.cornerRadiusRatio,
      edgeRatio: this.config.geometry.edgeZoneRatio,
    });
  }

  private progressCapFor(action: FlipAction): number {
    if (this.effectiveViewMode() === 'spread') {
      // 双页：currentPage = spread 索引
      const allowed =
        action === 'forward' ? this.currentPage + 1 < this.spreadCount() : this.currentPage > 0;
      return allowed ? 1 : this.config.geometry.bounceProgress;
    }
    const canForward = this.currentPage < this.pageCount() - 1;
    const canBackward = this.currentPage > 0;
    const allowed = action === 'forward' ? canForward : canBackward;
    return allowed ? 1 : this.config.geometry.bounceProgress;
  }

  private pageCount(): number {
    return this.provider?.pageCount ?? 0;
  }

  // ---------- 自动翻页（点击 / 键盘 / 滚轮） ----------

  autoFlip(action: FlipAction): void {
    if (!this.provider) {
      return;
    }
    if (this.phase !== 'idle') {
      // snap 进行中：记住最后一条脉冲，补间结束后接续执行
      //（连续按键/滚轮不再被丢弃）；回弹与拖拽期间仍忽略。
      if (this.phase === 'snap' && this.session && !this.session.pendingReturn) {
        this.queuedPulse = action;
      }
      return;
    }
    this.clearHover();
    if (this.progressCapFor(action) < 1) {
      // 边界：橡皮筋回弹
      this.startBounce(action);
      this.emitFlipStart(action, this.currentPage);
      return;
    }
    // 双页：折痕数学恒 forward——forward 折右面（frame left）、
    // backward 折左面（frame right，书脊居中）；抓取点 = 该侧自由边中点
    const spread = this.effectiveViewMode() === 'spread';
    const side: SpreadSide = spread ? (action === 'forward' ? 'right' : 'left') : 'right';
    const foldAction: FlipAction = spread ? 'forward' : action;
    const h = this.page.height;
    const grab: Point = foldAction === 'forward' ? { x: this.page.width, y: h / 2 } : { x: 0, y: h / 2 };
    const mode: GrabMode = 'edge';
    const foldSession = createFoldSession(grab, grab, mode, foldAction, this.page, this.config);
    this.phase = 'snap';
    this.session = {
      action: foldAction,
      semanticAction: action,
      side,
      mode,
      grab,
      session: foldSession,
      // 对称语义：翻动的始终是当前页 / 当前 spread
      fromPage: this.currentPage,
      underPage: action === 'forward' ? this.currentPage + 1 : this.currentPage - 1,
      progressCap: 1,
      inputMode: 'grab',
      swipeOrigin: { x: 0, y: 0 },
      snapTouchFrom: { ...grab },
      snapTouchTo: this.mirrorTouch(grab, foldAction),
      snapCompletes: true,
      snapStart: performance.now(),
      snapDuration: this.config.timing.autoFlipMs,
      snapEasing: 'inOut',
      pendingReturn: false,
      lastTouch: { ...grab },
    };
    this.pose = solveFoldPose({ grab, touch: grab, mode, action: foldAction, size: this.page, config: this.config });
    this.emitFlipStart(action, this.currentPage);
    this.markDirty();
  }

  private startBounce(action: FlipAction): void {
    const spread = this.effectiveViewMode() === 'spread';
    const side: SpreadSide = spread ? (action === 'forward' ? 'right' : 'left') : 'right';
    const foldAction: FlipAction = spread ? 'forward' : action;
    const h = this.page.height;
    const grab: Point = foldAction === 'forward' ? { x: this.page.width, y: h / 2 } : { x: 0, y: h / 2 };
    const foldSession = createFoldSession(grab, grab, 'edge', foldAction, this.page, this.config);
    this.phase = 'snap';
    this.session = {
      action: foldAction,
      semanticAction: action,
      side,
      mode: 'edge',
      grab,
      session: foldSession,
      fromPage: this.currentPage,
      underPage: action === 'forward' ? this.currentPage + 1 : this.currentPage - 1,
      progressCap: this.config.geometry.bounceProgress,
      inputMode: 'grab',
      swipeOrigin: { x: 0, y: 0 },
      snapTouchFrom: { ...grab },
      snapTouchTo: this.virtualTouchAt(grab, foldSession, this.config.geometry.bounceProgress),
      snapCompletes: false,
      snapStart: performance.now(),
      snapDuration: this.config.timing.bounceOutMs,
      snapEasing: 'out',
      pendingReturn: true,
      lastTouch: { ...grab },
    };
    this.pose = solveFoldPose({ grab, touch: grab, mode: 'edge', action: foldAction, size: this.page, config: this.config });
    this.dirty = true;
  }

  /**
   * snap 补间：触点沿直线路径从当前位滑向目标位，折痕（中垂线）全程连续。
   * - 完成翻页：目标 = 抓取点跨装订侧的镜像位，折痕最终落在书脊/自由缘上；
   * - 回弹/取消：目标 = 抓取点，折痕收拢回平贴。
   */
  private startSnap(to: Point, duration: number, completes: boolean): void {
    const state = this.session;
    if (!state || !this.pose) {
      return;
    }
    state.snapTouchFrom = { ...state.lastTouch };
    state.snapTouchTo = { ...to };
    state.snapCompletes = completes;
    state.snapStart = performance.now();
    state.snapDuration = duration;
    this.phase = 'snap';
  }

  /** 完成态触点：抓取点跨装订侧边缘的镜像位（中垂线折痕恰落在装订侧上）。 */
  private mirrorTouch(grab: Point, action: FlipAction): Point {
    const w = this.page.width;
    return {
      x: action === 'forward' ? -grab.x : 2 * w - grab.x,
      y: grab.y,
    };
  }

  // ---------- 帧循环 ----------

  private tick = (now: number): void => {
    const dt = this.lastFrame ? now - this.lastFrame : 16;
    this.lastFrame = now;
    this.updateFps(dt);

    // 书脊弯折（边缘悬停）渐入渐出
    if (this.flexK !== this.flexTarget) {
      this.flexK += (this.flexTarget - this.flexK) * (1 - Math.exp(-dt / 70));
      if (Math.abs(this.flexTarget - this.flexK) < 0.004) {
        this.flexK = this.flexTarget;
      }
      this.dirty = true;
    }

    const state = this.session;
    if (this.phase === 'drag' && state) {
      // 触点低通滤波（与帧率无关），随后实时求解
      const k = 1 - Math.exp(-dt / this.config.interaction.dragSmoothingTau);
      this.filteredTouch.x += (this.rawTouch.x - this.filteredTouch.x) * k;
      this.filteredTouch.y += (this.rawTouch.y - this.filteredTouch.y) * k;
      const capped = this.capTouch(this.filteredTouch);
      // 折痕 y 跟随实时触点：同步会话偏移，snap 接续时折痕不跳变
      state.session.touchYOffset = capped.y - state.grab.y;
      state.lastTouch = { ...capped };
      this.pose = solveFoldPose({
        grab: state.grab,
        touch: capped,
        mode: state.mode,
        action: state.action,
        size: this.page,
        config: this.config,
      });
      this.dirty = true;
    } else if (this.phase === 'snap' && state && this.pose) {
      const t = clamp((now - state.snapStart) / state.snapDuration, 0, 1);
      // autoFlip = inOut（纸张离页慢起、中段快扫）；拖拽释放 = out（惯性延续）
      const eased =
        state.snapEasing === 'inOut'
          ? t < 0.5
            ? 4 * t * t * t
            : 1 - Math.pow(-2 * t + 2, 3) / 2
          : 1 - Math.pow(1 - t, 3);
      // 触点沿直线路径补间：折痕（中垂线）随之连续扫过，全程不跳变
      const touch = {
        x: state.snapTouchFrom.x + (state.snapTouchTo.x - state.snapTouchFrom.x) * eased,
        y: state.snapTouchFrom.y + (state.snapTouchTo.y - state.snapTouchFrom.y) * eased,
      };
      state.lastTouch = touch;
      this.pose = solveFoldPose({
        grab: state.grab,
        touch,
        mode: state.mode,
        action: state.action,
        size: this.page,
        config: this.config,
      });
      // 纸张落定微颤（仅完成方向，衰减正弦）
      if (t > this.config.timing.wobbleStart && state.snapCompletes) {
        const k = (t - this.config.timing.wobbleStart) / (1 - this.config.timing.wobbleStart);
        const wobble =
          Math.sin(k * Math.PI * this.config.timing.wobbleCycles) *
          this.config.timing.wobbleAmp *
          (1 - k);
        this.pose = { ...this.pose, radius: Math.max(this.pose.radius * (1 + wobble), 0.3) };
      }
      this.dirty = true;
      if (t >= 1) {
        this.completeSnap();
      }
    }

    const pendingUploads = this.prefetchTextures();
    if (this.dirty) {
      this.dirty = false;
      this.renderFrame();
    }
    // 空闲停帧：静止且干净时不再排程下一帧（输入事件 / markDirty 唤醒）；
    // 翻页会话期间（drag/snap）、纹理回填欠账期间、书脊弯折渐变期间与
    // 渲染脏帧持续运转。
    this.rafActive = false;
    if (this.phase !== 'idle' || this.dirty || pendingUploads || this.flexK !== this.flexTarget) {
      this.schedule();
    } else if (this.fpsSamples.length >= 2) {
      // 停帧前用现有样本结算一次 fps（避免启动即停时读数停留在 0）
      const sum = this.fpsSamples.reduce((a, b) => a + b, 0);
      this.fps = Math.round(sum / this.fpsSamples.length);
    }
  };

  private capTouch(touch: Point): Point {
    const state = this.session;
    if (!state || state.progressCap >= 1) {
      return touch;
    }
    // 边界橡皮筋：按解算进度判定（forward/backward 进度方向相反，
    // 不能用触距直接比较），超限则钳到上限对应的虚拟触点。
    const pose = solveFoldPose({
      grab: state.grab,
      touch,
      mode: state.mode,
      action: state.action,
      size: this.page,
      config: this.config,
    });
    if (pose.progress <= state.progressCap) {
      return touch;
    }
    return this.virtualTouchAt(state.grab, state.session, state.progressCap);
  }

  private completeSnap(): void {
    const state = this.session;
    if (!state) {
      return;
    }
    if (state.pendingReturn) {
      state.pendingReturn = false;
      this.startSnap({ ...state.grab }, this.config.timing.bounceBackMs, false);
      return;
    }
    const forward = state.semanticAction === 'forward';
    if (state.snapCompletes) {
      this.currentPage = forward ? state.fromPage + 1 : state.fromPage - 1;
      this.emitState();
    }
    this.session = null;
    this.pose = null;
    this.phase = 'idle';
    this.emitFlipEnd(state, state.snapCompletes);
    this.markDirty();
    // 消费排队中的翻页脉冲（连续按键 / 滚轮 / 点击）
    const queued = this.queuedPulse;
    this.queuedPulse = null;
    if (queued) {
      this.autoFlip(queued);
    }
  }

  /** 纹理预取。返回是否仍有待上传页（帧循环据此续帧——空闲停帧下
   *  dirty 会在同帧被渲染消费，不能作为续帧依据）。
   *  burst = 突发模式（换源 / 跳页 / 失效回填）：一帧内传完整个 wanted，
   *  消除预算 1 张/帧造成的数帧缺页。wanted 按可见面优先排序并裁剪到
   *  缓存容量以内——预取面数超出缓存会引发 LRU 抖动（每帧重绘+逐出循环）。 */
  private prefetchTextures(burst = false): boolean {
    const store = this.textures;
    const source = this.bitmapSource;
    if (!store || !source || !this.provider) {
      return false;
    }
    const count = this.provider.pageCount;
    const wanted: number[] = [];
    const pushFace = (index: number): void => {
      if (index >= 0 && index < count && !wanted.includes(index)) {
        wanted.push(index);
      }
    };
    if (this.effectiveViewMode() === 'spread') {
      // 双页：当前 spread 两面 → 目标 spread 两面 → 前一 spread 两面
      //（顺序即优先级：翻动/淡出面最前，邻居预取最后）
      const s = this.currentPage;
      pushFace(2 * s - 1);
      pushFace(2 * s);
      pushFace(2 * s + 1);
      pushFace(2 * s + 2);
      pushFace(2 * s - 3);
      pushFace(2 * s - 2);
    } else if (this.phase === 'idle') {
      wanted.push(this.currentPage);
      if (this.currentPage + 1 < count) wanted.push(this.currentPage + 1);
      if (this.currentPage - 1 >= 0) wanted.push(this.currentPage - 1);
    } else if (this.session) {
      wanted.push(this.session.underPage, this.session.fromPage);
    }
    const capacity = Math.max(1, this.config.render.textureCacheSize);
    const budget = burst ? wanted.length : this.config.render.textureUploadsPerFrame;
    const remain = store.ensure(
      wanted.filter((i) => i >= 0 && i < count).slice(0, capacity),
      budget,
      (index) => source.drawPage(index)
    );
    return remain.length > 0;
  }

  private renderFrame(): void {
    if (!this.textures || !this.provider) {
      return;
    }
    const state = this.session;
    // 悬停预览：idle 态且指针悬于抓取热区 → 用预览姿态驱动翻动页（无会话、不改页码）
    const previewing = this.phase === 'idle' ? this.hover : null;
    const pose = state && this.pose ? this.pose : previewing?.pose ?? null;
    const spreadMode = this.effectiveViewMode() === 'spread';
    // 书脊弯折（边缘悬停）：仅静止双页呈现（翻页会话开始即随悬停清除退场）
    const gutterFlex = spreadMode && !state ? this.flexK : 0;
    // 落定淡出：镜像平贴态（p→1，材料翻出页外）随进度消隐，
    // 避免"悬空整页 → 完成瞬间硬切消失"；forward/backward 对称。
    let flipFade = 0;
    if (pose) {
      flipFade = smoothstep(this.config.timing.fadeStart, 1, pose.progress);
    }

    let scene: FlipSceneState;
    if (spreadMode) {
      // 双页：spread s = [面 2s−1, 面 2s]；翻动面 = 右面（forward）/ 左面（backward）。
      // 被翻侧在动画期间保留「翻页前的旧面」作为淡出层——内容只在动画
      // 揭示 / 落定时切换，点击瞬间不突变；另一侧直接揭示目标面。
      // （悬停预览复用同一场景分支：语义动作按所在侧——左面 = backward；
      //   但另一侧保持当前 spread 不变——封面 spread 左侧保持为空，
      //   预览不得提前显示其他页内容。）
      const active = state && this.pose
        ? { s: state.fromPage, forward: state.semanticAction === 'forward', side: state.side, preview: false }
        : previewing
          ? { s: this.currentPage, forward: previewing.side === 'right', side: previewing.side, preview: true }
          : null;
      const s = active ? active.s : this.currentPage;
      const forward = active ? active.forward : true;
      const flippingFace =
        active ? (forward ? 2 * s : 2 * s - 1) : null;
      let spreadFaces: {
        leftPage: number | null;
        rightPage: number | null;
        fadingFace: { page: number; side: SpreadSide } | null;
      };
      if (active && active.preview) {
        // 悬停预览：仅翻动侧下方揭示目标面，另一侧维持当前面
        spreadFaces = active.forward
          ? {
              leftPage: 2 * s - 1 >= 0 ? 2 * s - 1 : null,
              rightPage: 2 * s + 2 < this.provider.pageCount ? 2 * s + 2 : null,
              fadingFace: null,
            }
          : {
              leftPage: 2 * s - 3 >= 0 ? 2 * s - 3 : null,
              rightPage: 2 * s < this.provider.pageCount ? 2 * s : null,
              fadingFace: null,
            };
      } else if (active) {
        if (forward) {
          // 折右面：右面直接揭示目标（2s+2），左面保留旧面（2s−1）淡出，
          // 目标左面（2s+1）压在其下
          spreadFaces = {
            leftPage: 2 * s + 1 >= 0 ? 2 * s + 1 : null,
            rightPage: 2 * s + 2 < this.provider.pageCount ? 2 * s + 2 : null,
            fadingFace: 2 * s - 1 >= 0 ? { page: 2 * s - 1, side: 'left' } : null,
          };
        } else {
          // 折左面：左面直接揭示目标（2s−3），右面保留旧面（2s）淡出，
          // 目标右面（2s−2）压在其下
          spreadFaces = {
            leftPage: 2 * s - 3 >= 0 ? 2 * s - 3 : null,
            rightPage: 2 * s - 2 < this.provider.pageCount ? 2 * s - 2 : null,
            fadingFace: 2 * s < this.provider.pageCount ? { page: 2 * s, side: 'right' } : null,
          };
        }
      } else {
        spreadFaces = {
          leftPage: 2 * s - 1 >= 0 ? 2 * s - 1 : null,
          rightPage: 2 * s < this.provider.pageCount ? 2 * s : null,
          fadingFace: null,
        };
      }
      const underS = state ? state.underPage : this.currentPage;
      scene = {
        pose,
        flipFade,
        paperT: this.config.geometry.landRadius * 2,
        shading: this.config.shading,
        debug: this.debugFlag,
        gutterFlex,
        flippingPage: flippingFace,
        underPage: 2 * underS,
        spread: {
          leftPage: spreadFaces.leftPage,
          rightPage: spreadFaces.rightPage,
          flipping:
            flippingFace !== null && flippingFace >= 0 && flippingFace < this.provider.pageCount && active
              ? { page: flippingFace, side: active.side }
              : null,
          fadingFace: spreadFaces.fadingFace,
        },
      };
    } else {
      const underIndex = state
        ? state.underPage
        : previewing
          ? previewing.zone.action === 'forward'
            ? this.currentPage + 1
            : this.currentPage - 1
          : this.currentPage;
      const flipIndex = state && this.pose ? state.fromPage : previewing ? this.currentPage : null;
      scene = {
        pose,
        flipFade,
        paperT: this.config.geometry.landRadius * 2,
        shading: this.config.shading,
        debug: this.debugFlag,
        gutterFlex,
        flippingPage: flipIndex,
        underPage: underIndex,
        spread: null,
      };
    }
    this.renderer.render(scene, (index) => this.textures?.get(index) ?? null);
  }

  private updateFps(dt: number): void {
    this.fpsSamples.push(1000 / Math.max(dt, 1));
    if (this.fpsSamples.length > 30) {
      this.fpsSamples.shift();
    }
    if (this.fpsSamples.length === 30) {
      const sum = this.fpsSamples.reduce((a, b) => a + b, 0);
      this.fps = Math.round(sum / this.fpsSamples.length);
    }
  }

  private emitState(): void {
    this.onStateChange?.(this.currentPage);
  }

  // ---------- 会话收尾与事件 ----------

  /** 丢弃进行中的会话（跳页 / 换源 / 切视图 / tap 识别），按未完成收尾并通知。 */
  private discardSession(): void {
    const state = this.session;
    if (state && this.phase !== 'idle') {
      this.emitFlipEnd(state, false);
    }
    this.session = null;
    this.pose = null;
    this.phase = 'idle';
    this.queuedPulse = null;
    this.pendingSwipe = null;
    this.clearHover();
  }

  private emitFlipStart(action: FlipAction, fromPage: number): void {
    this.onFlipStart?.({ action, fromPage, toPage: this.eventTargetPage(action, fromPage) });
  }

  private emitFlipEnd(state: FlipSessionState, completed: boolean): void {
    const toPage = completed ? this.eventTargetPage(state.semanticAction, state.fromPage) : state.fromPage;
    this.onFlipEnd?.({ action: state.semanticAction, fromPage: state.fromPage, toPage, completed });
  }

  /** 事件负载的目标页（按语义动作推进一步；越界钳到边界）。 */
  private eventTargetPage(action: FlipAction, fromPage: number): number {
    const forward = action === 'forward';
    if (this.effectiveViewMode() === 'spread') {
      const max = this.spreadCount() - 1;
      return clamp(forward ? fromPage + 1 : fromPage - 1, 0, Math.max(0, max));
    }
    const max = this.pageCount() - 1;
    return clamp(forward ? fromPage + 1 : fromPage - 1, 0, Math.max(0, max));
  }

  // ---------- 抓取区 / 悬停预览 ----------

  /** 屏幕 → 规范坐标（单页整页；双页按所在侧面）。 */
  private canonicalAt(x: number, y: number, side: SpreadSide): Point {
    return this.effectiveViewMode() === 'spread'
      ? this.toSideCanonical(x, y, side)
      : this.toCanonical(x, y);
  }

  /** 触点是否落在页面判定区（页矩形 + 外扩余量）。 */
  private touchWithinPageBounds(touch: Point): boolean {
    const cw = this.page.width;
    const ch = this.page.height;
    const beyondAxis = cw * this.config.geometry.touchBeyondAxisRatio;
    const beyondSpine = this.config.geometry.touchBeyondSpinePx;
    return (
      touch.x >= -beyondAxis &&
      touch.x <= cw + beyondAxis &&
      touch.y >= -beyondSpine &&
      touch.y <= ch + beyondSpine
    );
  }

  /** 交互有效的抓取区：应用行为开关 + 双页只允许折痕数学 forward。 */
  private resolveInteractiveZone(touch: Point): GrabZone | null {
    let zone = this.resolveGrabZone(touch);
    if (zone?.mode === 'corner' && !this.config.behavior.enableCornerGrab) {
      zone = null;
    }
    if (zone?.mode === 'edge' && !this.config.behavior.enableEdgeGrab) {
      zone = null;
    }
    if (zone && this.effectiveViewMode() === 'spread' && zone.action !== 'forward') {
      // 双页：面贴书脊侧的热区无效（已装订），只允许自由边侧掀起
      zone = null;
    }
    return zone;
  }

  /** 悬停预览：idle 态指针悬于抓取热区时构建轻量预览姿态（不建会话、不改页码）。 */
  private handleHover(x: number, y: number): void {
    if (!this.provider || this.phase !== 'idle') {
      this.clearHover();
      return;
    }
    const spread = this.effectiveViewMode() === 'spread';
    const side: SpreadSide = spread ? this.sideAt(x) : 'right';
    const touch = this.canonicalAt(x, y, side);
    if (!this.touchWithinPageBounds(touch)) {
      this.clearHover();
      return;
    }
    const zone = this.resolveInteractiveZone(touch);
    if (!zone) {
      this.clearHover();
      return;
    }
    if (zone.mode === 'edge') {
      // 边缘悬停：书脊弯折——两侧页面近缝向沟内微凹（不掀页；页角卷曲
      // 已按需求移除），弯折渐入由 tick 推进。仅双页生效（单页无中缝）。
      const hadHover = this.hover !== null;
      const wanted = this.effectiveViewMode() === 'spread' ? 1 : 0;
      this.hover = null;
      if (hadHover || this.flexTarget !== wanted || this.flexK > 0) {
        this.flexTarget = wanted;
        this.markDirty();
      }
      return;
    }
    this.flexTarget = 0; // 角部卷曲预览：书脊弯折退场
    if (
      this.hover &&
      this.hover.side === side &&
      this.hover.zone.mode === zone.mode &&
      this.hover.zone.action === zone.action &&
      this.hover.zone.grab.x === zone.grab.x &&
      this.hover.zone.grab.y === zone.grab.y
    ) {
      return; // 同一热区（含所在侧与边缘跟随位）：预览姿态不变
    }
    this.hover = { zone, side, pose: this.buildPreviewPose(zone) };
    this.markDirty();
  }

  private clearHover(): void {
    this.flexTarget = 0; // 书脊弯折渐出
    if (this.hover || this.flexK > 0) {
      this.hover = null;
      this.markDirty();
    }
  }

  /** 预览姿态：从抓取点向页内探入一段固定深度（角部沿对角、边缘沿装订轴）。 */
  private buildPreviewPose(zone: GrabZone): FoldPose {
    const { width: w, height: h } = this.page;
    const d = Math.min(w, h) * 0.22;
    let touch: Point;
    if (zone.mode === 'corner') {
      const inwardX = zone.action === 'forward' ? -d : d;
      const towardCenterY = zone.grab.y < h / 2 ? d : -d;
      touch = { x: zone.grab.x + inwardX, y: zone.grab.y + towardCenterY };
    } else {
      touch = {
        x: zone.action === 'forward' ? zone.grab.x - d : zone.grab.x + d,
        y: zone.grab.y,
      };
    }
    return solveFoldPose({
      grab: zone.grab,
      touch,
      mode: zone.mode,
      action: zone.action,
      size: this.page,
      config: this.config,
    });
  }
}
