/**
 * 翻页控制器：手势状态机 + 渲染调度。
 *
 * 状态：idle（静止）/ drag（拖拽跟随）/ snap（补间：完成翻页或回弹）。
 * - 拖拽：触点一阶低通后实时求解折痕姿态（跟手且无抖动）；
 * - 松手：按「进度阈值 OR 甩动速度」判定完成或回弹，补间可被新手势打断；
 * - 点击边/角、键盘、滚轮 → 自动翻页；边界处做橡皮筋回弹；
 * - 完成 forward：当前页 = 下一页；完成 backward：当前页 = 上一页；
 *   换页瞬间翻动页与下层页几何无缝衔接，无跳变。
 */
import {
  clamp,
  clampTouch,
  createFoldSession,
  smoothstep,
  solveFoldPose,
  solveFoldPoseAtProgress,
  type FoldSession,
} from './curl-model';
import { decideRelease, resolveGrabZone, snapDurationFor } from './flip-decisions';
import { GlRenderer } from './gl-renderer';
import { InputSource, isTap } from './input';
import { PageBitmapSource } from './page-provider';
import { TextureStore } from './texture-store';
import {
  DEFAULT_FLIP_CONFIG,
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
  /** swipe 模式的位移原点（元素坐标）。 */
  swipeOrigin: Point;
  startProgress: number;
  targetProgress: number;
  snapStart: number;
  snapDuration: number;
  /** 到达 target 后是否再弹回 0（边界回弹）。 */
  pendingReturn: boolean;
}

const TAP_ZONE_RATIO = 0.25;
const CORNER_RADIUS_RATIO = 0.3;
const BOUNCE_PROGRESS = 0.1;
/** 中部滑动提交阈值（元素 px）：超过才判定方向并开始卷曲。 */
const SWIPE_COMMIT_DIST = 14;

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
  /** 中部滑动的待判定起点（位移超过阈值后按方向提交为 swipe 会话）。 */
  private pendingSwipe: { x: number; y: number } | null = null;
  /** snap 期间收到的最后一条翻页脉冲（键盘/滚轮），补间结束后接续执行。 */
  private queuedPulse: FlipAction | null = null;
  private samples: Array<{ time: number; dist: number }> = [];
  private provider: PageProvider | null = null;
  private bitmapSource: PageBitmapSource | null = null;
  private textures: TextureStore | null = null;
  private pageRect = { x: 0, y: 0, width: 0, height: 0 };
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
    this.config = options.config ?? DEFAULT_FLIP_CONFIG;
    this.onStateChange = options.onStateChange;
    this.renderer = options.renderer ?? new GlRenderer(canvas, () => this.textures?.clear());
    this.textures = new TextureStore(this.renderer.gl, this.renderer.isWebGL2);
    this.input = new InputSource(canvas, {
      onPointer: (event) => this.onPointer(event),
      onWheelPulse: (direction) => this.autoFlip(direction > 0 ? 'forward' : 'backward'),
      onKeyPulse: (direction) => this.autoFlip(direction > 0 ? 'forward' : 'backward'),
    });
    this.schedule();
  }

  /** 绑定页面内容提供者（切换书源时重置到第 0 页）。 */
  setProvider(provider: PageProvider): void {
    this.provider = provider;
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
    const dprChanged = Math.min(dpr, 2) !== this.dpr;
    const oldPage = this.page;
    this.dpr = Math.min(dpr, 2);
    this.layout();
    this.renderer.resize(cssWidth, cssHeight, this.dpr);
    const pageChanged = dprChanged || Math.abs(this.page.width - oldPage.width) > 0.5 || Math.abs(this.page.height - oldPage.height) > 0.5;
    if (pageChanged && this.provider && this.bitmapSource) {
      // 位图像素尺寸随页面尺寸/dpr 变化，旧纹理全部失效
      this.bitmapSource = new PageBitmapSource(this.provider, this.page, this.dpr);
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

  /** 页面尺寸（规范空间 = CSS 像素）。 */
  private get page(): PageSize {
    return { width: this.pageRect.width, height: this.pageRect.height };
  }

  private pageSize(): PageSize {
    const aspect = this.provider?.aspect ?? 0.68;
    const maxW = this.viewSize.width * 0.94;
    const maxH = this.viewSize.height * 0.92;
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
    this.renderer.updateLayout(size, this.provider?.orientation ?? 'ltr');
    this.dirty = true;
  }

  // ---------- 指针事件 ----------

  private toCanonical(x: number, y: number): Point {
    const pageX = x - this.pageRect.x;
    const pageY = y - this.pageRect.y;
    const canonicalX = (this.provider?.orientation ?? 'ltr') === 'rtl' ? this.pageRect.width - pageX : pageX;
    return { x: canonicalX, y: pageY };
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
      const progress = this.pose?.progress ?? 0;
      const adopted = this.virtualTouchAt(this.session, progress);
      // swipe 会话：把位移原点平移到当前按下点，使行程从当前进度无缝继续
      //（两方向行程均为 2×折痕推进——中垂线模型）
      if (this.session.inputMode === 'swipe') {
        const forwardLtr =
          (this.session.action === 'forward') === ((this.provider?.orientation ?? 'ltr') === 'ltr');
        const travel = this.session.session.distEnd * 2 * progress;
        this.session.swipeOrigin = { x: forwardLtr ? event.x + travel : event.x - travel, y: event.y };
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
    if (touch.x < -this.pageRect.width * 0.2 || touch.x > this.pageRect.width * 1.2 || touch.y < -80 || touch.y > this.pageRect.height + 80) {
      return;
    }
    const zone = this.resolveGrabZone(touch);
    this.downTime = event.time;
    this.downScreen = { x: event.x, y: event.y };
    if (!zone) {
      // 页面中部：待定滑动（位移超过阈值后按方向提交为 swipe 会话）
      this.pendingSwipe = { x: event.x, y: event.y };
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
      startProgress: 0,
      targetProgress: 0,
      snapStart: 0,
      snapDuration: 0,
      pendingReturn: false,
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
      // swipe：行程 = 手指沿翻页方向的有效位移
      const travel = Math.min(
        Math.max(this.swipeTravel(event.x), 0),
        this.session.progressCap * this.session.session.distEnd
      );
      const grab = this.session.grab;
      const n = this.session.session.axisNormal;
      this.rawTouch = {
        x: grab.x - n.x * travel,
        y: grab.y + (event.y - this.session.swipeOrigin.y) * 0.5,
      };
      this.samples.push({ time: event.time, dist: travel });
    } else {
      const touch = clampTouch(this.toCanonical(event.x, event.y), this.page, this.page.width * 0.3);
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

  /** swipe 模式的有向行程：沿翻页方向为正。 */
  private swipeTravel(x: number): number {
    const state = this.session;
    if (!state) {
      return 0;
    }
    const dx = x - state.swipeOrigin.x;
    const forwardLtr = (state.action === 'forward') === ((this.provider?.orientation ?? 'ltr') === 'ltr');
    return forwardLtr ? -dx : dx;
  }

  /** 提交中部滑动：按水平位移方向决定翻页方向（行款自适应）。 */
  private commitSwipe(x: number, y: number): void {
    const origin = this.pendingSwipe;
    if (!origin) {
      return;
    }
    const dx = x - origin.x;
    const dy = y - origin.y;
    if (Math.hypot(dx, dy) < SWIPE_COMMIT_DIST || Math.abs(dx) < Math.abs(dy) * 0.9) {
      return; // 位移不足或以纵向为主：继续等待
    }
    const rtl = (this.provider?.orientation ?? 'ltr') === 'rtl';
    const forward = rtl ? dx > 0 : dx < 0;
    const action: FlipAction = forward ? 'forward' : 'backward';
    this.pendingSwipe = null;
    if (this.progressCapFor(action) < 1) {
      return; // 该方向到边界：忽略（回弹仅由点击/键盘触发）
    }
    const { width: w, height: h } = this.page;
    const pressCanonicalY = clamp(y - this.pageRect.y, h * 0.15, h * 0.85);
    const grab: Point = forward ? { x: w, y: pressCanonicalY } : { x: 0, y: pressCanonicalY };
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
      // 原点保持按下点：提交瞬间即继承从按下到现在的全部行程
      swipeOrigin: { x: origin.x, y: origin.y },
      startProgress: 0,
      targetProgress: 0,
      snapStart: 0,
      snapDuration: 0,
      pendingReturn: false,
    };
    // 起始姿态：行程 0（触点 = 抓取点）
    this.rawTouch = { ...grab };
    this.filteredTouch = { ...grab };
    this.samples = [];
    this.dirty = true;
  }

  private onUp(event: { x: number; y: number; time: number }): void {
    if (this.phase === 'drag' && this.session) {
      const moved = Math.hypot(event.x - this.downScreen.x, event.y - this.downScreen.y) > 8;
      if (isTap(this.downTime, event.time, moved)) {
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
    if (this.phase === 'drag') {
      this.startSnap(0, 300);
    }
  }

  /** 松手决策：进度阈值 OR 甩动速度（决策逻辑见 flip-decisions）。 */
  private finishDrag(): void {
    const state = this.session;
    if (!state || !this.pose) {
      return;
    }
    const progress = Math.min(this.pose.progress, state.progressCap);
    const decision = decideRelease(progress, this.recentVelocity(), this.config);
    // 边界橡皮筋会话（cap < 1）不因快甩误判为完成——只能回弹
    const complete = decision === 'complete' && state.progressCap >= 1;
    this.startSnap(complete ? 1 : 0, snapDurationFor(complete ? 1 - progress : progress));
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

  /** 由会话进度反解规范空间触点（打断接续用）。 */
  private virtualTouchAt(state: FlipSessionState, progress: number): Point {
    const dist = state.session.distEnd * progress;
    return {
      x: state.grab.x - state.session.axisNormal.x * dist,
      y: state.grab.y - state.session.axisNormal.y * dist,
    };
  }

  // ---------- 抓取区判定 ----------

  private resolveGrabZone(touch: Point): { mode: GrabMode; action: FlipAction; grab: Point } | null {
    const { width: w, height: h } = this.page;
    // 纯几何判定：边界方向由 progressCapFor 给出橡皮筋上限（拖拽回弹 / 点击回弹）
    return resolveGrabZone(touch, this.page, {
      cornerRadius: Math.min(w, h) * CORNER_RADIUS_RATIO,
      edgeRatio: TAP_ZONE_RATIO,
    });
  }

  private progressCapFor(action: FlipAction): number {
    const canForward = this.currentPage < this.pageCount() - 1;
    const canBackward = this.currentPage > 0;
    const allowed = action === 'forward' ? canForward : canBackward;
    return allowed ? 1 : BOUNCE_PROGRESS;
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
      startProgress: 0,
      targetProgress: 1,
      snapStart: performance.now(),
      snapDuration: 520,
      pendingReturn: false,
    };
    this.pose = solveFoldPoseAtProgress(foldSession, 0);
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
      progressCap: BOUNCE_PROGRESS,
      inputMode: 'grab',
      swipeOrigin: { x: 0, y: 0 },
      startProgress: 0,
      targetProgress: BOUNCE_PROGRESS,
      snapStart: performance.now(),
      snapDuration: 300,
      pendingReturn: true,
    };
    this.pose = solveFoldPoseAtProgress(foldSession, 0);
    this.dirty = true;
  }

  private startSnap(target: number, duration: number): void {
    const state = this.session;
    if (!state || !this.pose) {
      return;
    }
    state.startProgress = this.pose.progress;
    state.targetProgress = target;
    state.snapStart = performance.now();
    state.snapDuration = duration;
    this.phase = 'snap';
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
      const k = 1 - Math.exp(-dt / this.config.dragSmoothingTau);
      this.filteredTouch.x += (this.rawTouch.x - this.filteredTouch.x) * k;
      this.filteredTouch.y += (this.rawTouch.y - this.filteredTouch.y) * k;
      const capped = this.capTouch(this.filteredTouch);
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
      const progress = state.startProgress + (state.targetProgress - state.startProgress) * eased;
      this.pose = solveFoldPoseAtProgress(state.session, progress);
      // 纸张落定微颤（仅完成方向，衰减正弦）
      if (t > 0.6) {
        const k = (t - 0.6) / 0.4;
        const wobble = Math.sin(k * Math.PI * 2.5) * 0.05 * (1 - k);
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
    return this.virtualTouchAt(state, state.progressCap);
  }

  private completeSnap(): void {
    const state = this.session;
    if (!state) {
      return;
    }
    if (state.pendingReturn) {
      state.pendingReturn = false;
      state.startProgress = state.targetProgress;
      state.targetProgress = 0;
      state.snapStart = performance.now();
      state.snapDuration = 280;
      return;
    }
    const forward = state.action === 'forward';
    if (state.targetProgress >= 1) {
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
      flipFade = smoothstep(0.85, 1, this.pose.progress);
    }
    this.renderer.render(
      {
        flippingPage: flipIndex,
        underPage: underIndex,
        pose: this.pose,
        flipFade,
        paperT: this.config.landRadius * 2,
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
