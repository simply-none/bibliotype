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
import { decideRelease, resolveGrabZone, snapDurationFor } from './flip-decisions';
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
  type FoldPose,
  type GrabMode,
  type PageProvider,
  type PageSize,
  type Point,
} from './types';

type Phase = 'idle' | 'drag' | 'snap';

interface FlipSessionState {
  action: FlipAction;
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
  /** 到达终点后是否再弹回抓取点（边界回弹）。 */
  pendingReturn: boolean;
  /** 最近一次解算用的触点（snap 中被新手势接管时无缝接续）。 */
  lastTouch: Point;
}

export interface FlipControllerOptions {
  config?: FlipConfig;
  onStateChange?: (currentPage: number) => void;
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
    this.dirty = true;
  }
  private debugFlag = false;
  private phase: Phase = 'idle';
  private session: FlipSessionState | null = null;
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
  /** 屏幕页面矩形（舞台内，CSS px）。 */
  private pageRect = { x: 0, y: 0, width: 0, height: 0 };
  /** 装订侧（粘胶侧）：left/right/top/bottom。 */
  private bindEdge: BindEdge = 'left';
  private viewSize: PageSize = { width: 0, height: 0 };
  private dpr = 1;
  private rafId = 0;
  private lastFrame = 0;
  private fpsSamples: number[] = [];
  private readonly config: FlipConfig;
  private readonly onStateChange: ((currentPage: number) => void) | undefined;
  private input: InputSource;
  private readonly renderer: FlipRenderAdapter;

  constructor(private readonly canvas: HTMLCanvasElement, options: FlipControllerOptions = {}) {
    this.config = resolveFlipConfig(options.config);
    this.onStateChange = options.onStateChange;
    this.renderer = options.renderer ?? new GlRenderer(canvas, () => this.textures?.clear());
    this.renderer.setRenderOptions?.(this.config.render);
    this.textures = new TextureStore(this.renderer.gl, this.renderer.isWebGL2, {
      maxEntries: this.config.render.textureCacheSize,
    });
    this.input = new InputSource(
      canvas,
      {
        onPointer: (event) => this.onPointer(event),
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
    this.provider = provider;
    this.bindEdge = resolveBindEdge(provider);
    this.input.setKeyAxis(this.keyAxisFor(this.bindEdge));
    this.currentPage = 0;
    this.phase = 'idle';
    this.pose = null;
    this.session = null;
    this.queuedPulse = null;
    this.bitmapSource = new PageBitmapSource(provider, this.pageSize(), this.dpr);
    this.textures?.clear();
    this.layout();
    void provider.ready.then(() => {
      this.dirty = true;
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
    if (pageChanged && this.provider && this.bitmapSource) {
      // 位图像素尺寸随页面尺寸/dpr 变化，旧纹理全部失效
      this.bitmapSource = new PageBitmapSource(this.provider, this.screenPage, this.dpr);
      this.textures?.clear();
      this.dirty = true;
    }
  }

  destroy(): void {
    this.cancelSchedule();
    this.input.dispose();
    this.queuedPulse = null;
    this.textures?.dispose();
    this.renderer.dispose();
  }

  private schedule(): void {
    if (typeof requestAnimationFrame === 'function') {
      this.rafId = requestAnimationFrame(this.tick);
    } else {
      // 非 DOM 环境（headless 测试）：退化为定时器
      this.rafId = setTimeout(() => this.tick(performance.now()), 16) as unknown as number;
    }
  }

  private cancelSchedule(): void {
    if (typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.rafId);
    }
    clearTimeout(this.rafId);
  }

  private dirty = false;

  /** 屏幕页面尺寸（舞台内矩形，位图 / 排版依据）。 */
  private get screenPage(): PageSize {
    return { width: this.pageRect.width, height: this.pageRect.height };
  }

  /** 页面尺寸（规范空间 = CSS 像素）：几何求解统一依据。 */
  private get page(): PageSize {
    return canonicalSize(this.screenPage, this.bindEdge);
  }

  private pageSize(): PageSize {
    const aspect = this.provider?.aspect ?? 0.68;
    const maxW = this.viewSize.width * this.config.render.layoutWidthRatio;
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
    this.pageRect = {
      x: (this.viewSize.width - size.width) / 2,
      y: (this.viewSize.height - size.height) / 2,
      width: size.width,
      height: size.height,
    };
    if (this.bitmapSource) {
      this.bitmapSource.setPageSize(size);
    }
    this.renderer.updateLayout(this.page, this.bindEdge);
    this.dirty = true;
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
        const adoptedScreen = event;
        const adoptedCanonical = this.toCanonical(adoptedScreen.x, adoptedScreen.y);
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
      this.dirty = true;
      return;
    }
    if (this.phase !== 'idle') {
      return;
    }
    const touch = this.toCanonical(event.x, event.y);
    const cw = this.page.width;
    const ch = this.page.height;
    const beyondAxis = cw * this.config.geometry.touchBeyondAxisRatio;
    const beyondSpine = this.config.geometry.touchBeyondSpinePx;
    if (
      touch.x < -beyondAxis ||
      touch.x > cw + beyondAxis ||
      touch.y < -beyondSpine ||
      touch.y > ch + beyondSpine
    ) {
      return;
    }
    let zone = this.resolveGrabZone(touch);
    if (zone && zone.mode === 'corner' && !this.config.behavior.enableCornerGrab) {
      zone = null;
    }
    if (zone && zone.mode === 'edge' && !this.config.behavior.enableEdgeGrab) {
      zone = null;
    }
    this.downTime = event.time;
    this.downScreen = { x: event.x, y: event.y };
    if (!zone) {
      // 页面中部：待定滑动（位移超过阈值后按方向提交为 swipe 会话）
      this.pendingSwipe = this.config.behavior.enableSwipe ? { x: event.x, y: event.y } : null;
      return;
    }
    const foldSession = createFoldSession(zone.grab, touch, zone.mode, zone.action, this.page, this.config);
    this.phase = 'drag';
    this.pendingSwipe = null;
    this.session = {
      action: zone.action,
      mode: zone.mode,
      grab: zone.grab,
      session: foldSession,
      // 对称语义：翻动的始终是当前页（fromPage），下层揭示目标页
      fromPage: this.currentPage,
      underPage: zone.action === 'forward' ? this.currentPage + 1 : this.currentPage - 1,
      progressCap: this.progressCapFor(zone.action),
      inputMode: 'grab',
      swipeOrigin: { x: event.x, y: event.y },
      snapTouchFrom: { ...touch },
      snapTouchTo: { ...touch },
      snapCompletes: false,
      snapStart: 0,
      snapDuration: 0,
      pendingReturn: false,
      lastTouch: { ...touch },
    };
    this.rawTouch = touch;
    this.filteredTouch = { ...touch };
    this.samples = [{ time: event.time, dist: this.axisDist(touch) }];
    this.dirty = true;
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
      const pointer = this.toCanonical(event.x, event.y);
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
        this.toCanonical(event.x, event.y),
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
   * 提交中部滑动（规范空间统一判定，四向装订共用）：
   * 位移以装订轴（规范 x）为主且超过阈值才提交；**规范 x 减小 = forward**——
   * left 拖左、right 拖右、top 上拖、bottom 下拖，全部自然成立。
   */
  private commitSwipe(x: number, y: number): void {
    const origin = this.pendingSwipe;
    if (!origin) {
      return;
    }
    const originC = this.toCanonical(origin.x, origin.y);
    const pointerC = this.toCanonical(x, y);
    const dcx = pointerC.x - originC.x;
    const dcy = pointerC.y - originC.y;
    if (
      Math.hypot(dcx, dcy) < this.config.interaction.swipeCommitDist ||
      Math.abs(dcx) < Math.abs(dcy) * this.config.interaction.swipeCommitOrthoRatio
    ) {
      return; // 位移不足或不沿装订轴：继续等待
    }
    const forward = dcx < 0;
    const action: FlipAction = forward ? 'forward' : 'backward';
    this.pendingSwipe = null;
    if (this.progressCapFor(action) < 1) {
      return; // 该方向到边界：忽略（回弹仅由点击/键盘触发）
    }
    const { width: w, height: h } = this.page;
    const edgeClamp = h * this.config.interaction.edgePressClampRatio;
    const pressCanonicalV = clamp(pointerC.y, edgeClamp, h - edgeClamp);
    const grab: Point = forward ? { x: w, y: pressCanonicalV } : { x: 0, y: pressCanonicalV };
    const foldSession = createFoldSession(grab, grab, 'edge', action, this.page, this.config);
    this.phase = 'drag';
    this.session = {
      action,
      mode: 'edge',
      grab,
      session: foldSession,
      // 对称语义：翻动的始终是当前页
      fromPage: this.currentPage,
      underPage: forward ? this.currentPage + 1 : this.currentPage - 1,
      progressCap: 1,
      inputMode: 'swipe',
      // 原点保持按下点（规范空间）：提交瞬间即继承从按下到现在的全部行程
      swipeOrigin: { ...originC },
      snapTouchFrom: { ...grab },
      snapTouchTo: { ...grab },
      snapCompletes: false,
      snapStart: 0,
      snapDuration: 0,
      pendingReturn: false,
      lastTouch: { ...grab },
    };
    // 起始姿态：行程 0（触点 = 抓取点）
    this.rawTouch = { ...grab };
    this.filteredTouch = { ...grab };
    this.samples = [];
    this.dirty = true;
  }

  private onUp(event: { x: number; y: number; time: number }): void {
    if (this.phase === 'drag' && this.session) {
      const moved =
        Math.hypot(event.x - this.downScreen.x, event.y - this.downScreen.y) >
        this.config.interaction.tapMaxDist;
      if (isTap(this.downTime, event.time, moved, this.config.interaction.tapMaxMs)) {
        // 点击边/角 → 自动翻页（边界则回弹）
        const action = this.session.action;
        this.session = null;
        this.pose = null;
        this.phase = 'idle';
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
    if (this.progressCapFor(action) < 1) {
      // 边界：橡皮筋回弹
      this.startBounce(action);
      return;
    }
    const h = this.page.height;
    const grab: Point = action === 'forward' ? { x: this.page.width, y: h / 2 } : { x: 0, y: h / 2 };
    const mode: GrabMode = 'edge';
    const foldSession = createFoldSession(grab, grab, mode, action, this.page, this.config);
    this.phase = 'snap';
    this.session = {
      action,
      mode,
      grab,
      session: foldSession,
      // 对称语义：翻动的始终是当前页
      fromPage: this.currentPage,
      underPage: action === 'forward' ? this.currentPage + 1 : this.currentPage - 1,
      progressCap: 1,
      inputMode: 'grab',
      swipeOrigin: { x: 0, y: 0 },
      snapTouchFrom: { ...grab },
      snapTouchTo: this.mirrorTouch(grab, action),
      snapCompletes: true,
      snapStart: performance.now(),
      snapDuration: this.config.timing.autoFlipMs,
      pendingReturn: false,
      lastTouch: { ...grab },
    };
    this.pose = solveFoldPose({ grab, touch: grab, mode, action, size: this.page, config: this.config });
    this.dirty = true;
  }

  private startBounce(action: FlipAction): void {
    const h = this.page.height;
    const grab: Point = action === 'forward' ? { x: this.page.width, y: h / 2 } : { x: 0, y: h / 2 };
    const foldSession = createFoldSession(grab, grab, 'edge', action, this.page, this.config);
    this.phase = 'snap';
    this.session = {
      action,
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
      pendingReturn: true,
      lastTouch: { ...grab },
    };
    this.pose = solveFoldPose({ grab, touch: grab, mode: 'edge', action, size: this.page, config: this.config });
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
    this.schedule();
    const dt = this.lastFrame ? now - this.lastFrame : 16;
    this.lastFrame = now;
    this.updateFps(dt);

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
      const eased = 1 - Math.pow(1 - t, 3);
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

    this.prefetchTextures();
    if (this.dirty) {
      this.dirty = false;
      this.renderFrame();
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
    const forward = state.action === 'forward';
    if (state.snapCompletes) {
      this.currentPage = forward ? state.fromPage + 1 : state.fromPage - 1;
      this.emitState();
    }
    this.session = null;
    this.pose = null;
    this.phase = 'idle';
    this.dirty = true;
    // 消费排队中的翻页脉冲（连续按键 / 滚轮 / 点击）
    const queued = this.queuedPulse;
    this.queuedPulse = null;
    if (queued) {
      this.autoFlip(queued);
    }
  }

  private prefetchTextures(): void {
    const store = this.textures;
    const source = this.bitmapSource;
    if (!store || !source || !this.provider) {
      return;
    }
    const count = this.provider.pageCount;
    const wanted: number[] = [];
    if (this.phase === 'idle') {
      wanted.push(this.currentPage);
      if (this.currentPage + 1 < count) wanted.push(this.currentPage + 1);
      if (this.currentPage - 1 >= 0) wanted.push(this.currentPage - 1);
    } else if (this.session) {
      wanted.push(this.session.underPage, this.session.fromPage);
    }
    const remain = store.ensure(wanted.filter((i) => i >= 0 && i < count), 1, (index) => source.drawPage(index));
    if (remain.length > 0) {
      this.dirty = true; // 还有待上传纹理，下一帧继续
    }
  }

  private renderFrame(): void {
    if (!this.textures || !this.provider) {
      return;
    }
    const state = this.session;
    const underIndex = state ? state.underPage : this.currentPage;
    const flipIndex = state && this.pose ? state.fromPage : null;
    const underTex = this.textures.get(underIndex) ?? this.textures.get(this.currentPage);
    const flipTex = flipIndex !== null ? this.textures.get(flipIndex) : null;
    if (!underTex) {
      return; // 首帧纹理未就绪，prefetch 会置 dirty
    }
    // 落定淡出：镜像平贴态（p→1，材料翻出页外）随进度消隐，
    // 避免"悬空整页 → 完成瞬间硬切消失"；forward/backward 对称。
    let flipFade = 0;
    if (state && this.pose) {
      flipFade = smoothstep(this.config.timing.fadeStart, 1, this.pose.progress);
    }
    this.renderer.render(
      {
        flippingPage: flipIndex,
        underPage: underIndex,
        pose: this.pose,
        flipFade,
        paperT: this.config.geometry.landRadius * 2,
        shading: this.config.shading,
        debug: this.debugFlag,
      },
      underTex,
      flipTex
    );
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
}
