/**
 * 指针 / 滚轮 / 键盘输入源：Pointer Events 统一鼠标、触摸与笔输入。
 *
 * 只负责采集与基本手势判定（按下 / 移动 / 抬起 / 取消、点击识别），
 * 页面坐标换算与翻页语义由 FlipController 处理。
 */

export interface RawPointerEvent {
  type: 'down' | 'move' | 'up' | 'cancel';
  /** 相对目标元素左上角的 CSS 像素坐标。 */
  x: number;
  y: number;
  /** 事件时间戳（performance.now 语义）。 */
  time: number;
}

export interface InputSourceHandlers {
  onPointer(event: RawPointerEvent): void;
  /** 滚轮累计越过阈值：+1 向前翻，-1 向后翻。 */
  onWheelPulse(direction: number): void;
  /** 键盘翻页：+1 向前翻，-1 向后翻。 */
  onKeyPulse(direction: number): void;
}

/** 输入阈值（interaction 组透传；缺省 = 引擎默认值）。 */
export interface InputSourceOptions {
  tapMaxMs?: number;
  tapMaxDist?: number;
  wheelThreshold?: number;
  wheelCooldownMs?: number;
}

export class InputSource {
  private active = false;
  private downX = 0;
  private downY = 0;
  private downTime = 0;
  private moved = false;
  private wheelAcc = 0;
  private lastWheelFire = 0;
  private readonly tapMaxMs: number;
  private readonly tapMaxDist: number;
  private readonly wheelThreshold: number;
  private readonly wheelCooldownMs: number;
  /** 键盘方向轴（随装订侧）：左右装订 x（→=下一页）；上装订 y（↑=下一页）；下装订 y（↓=下一页）。 */
  private keyAxis: { dir: 'x' | 'y'; sign: 1 | -1 } = { dir: 'x', sign: 1 };
  private readonly controller = new AbortController();

  constructor(
    private readonly element: HTMLElement,
    private readonly handlers: InputSourceHandlers,
    options: InputSourceOptions = {}
  ) {
    this.tapMaxMs = options.tapMaxMs ?? 280;
    this.tapMaxDist = options.tapMaxDist ?? 8;
    this.wheelThreshold = options.wheelThreshold ?? 90;
    this.wheelCooldownMs = options.wheelCooldownMs ?? 380;
    const opts: AddEventListenerOptions = { signal: this.controller.signal, passive: false };
    element.addEventListener('pointerdown', this.onDown, opts);
    element.addEventListener('pointermove', this.onMove, opts);
    element.addEventListener('pointerup', this.onUp, opts);
    element.addEventListener('pointercancel', this.onCancel, opts);
    // 阻止长按菜单 / 选中，移动端手势完全接管
    element.addEventListener('contextmenu', this.prevent, opts);
    element.addEventListener('wheel', this.onWheel, opts);
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.onKey, { signal: this.controller.signal });
    }
  }

  /** 键盘方向轴随装订侧切换（由控制器在换源时同步）。 */
  setKeyAxis(axis: { dir: 'x' | 'y'; sign: 1 | -1 }): void {
    this.keyAxis = axis;
  }

  /** 释放全部监听。 */
  dispose(): void {
    this.controller.abort();
  }

  private prevent = (event: Event): void => {
    event.preventDefault();
  };

  private emit(type: RawPointerEvent['type'], event: PointerEvent): void {
    const rect = this.element.getBoundingClientRect();
    this.handlers.onPointer({
      type,
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      time: event.timeStamp,
    });
  }

  private onDown = (event: PointerEvent): void => {
    if (!event.isPrimary) {
      return;
    }
    event.preventDefault();
    // setPointerCapture 保证移出元素后仍持续收到 move/up
    if (this.element.setPointerCapture && event.pointerId !== undefined) {
      try {
        this.element.setPointerCapture(event.pointerId);
      } catch {
        // 某些合成指针不支持捕获，忽略
      }
    }
    this.active = true;
    this.moved = false;
    this.downX = event.clientX;
    this.downY = event.clientY;
    this.downTime = event.timeStamp;
    this.emit('down', event);
  };

  private onMove = (event: PointerEvent): void => {
    if (!this.active || !event.isPrimary) {
      return;
    }
    event.preventDefault();
    if (Math.hypot(event.clientX - this.downX, event.clientY - this.downY) > this.tapMaxDist) {
      this.moved = true;
    }
    this.emit('move', event);
  };

  private onUp = (event: PointerEvent): void => {
    if (!this.active || !event.isPrimary) {
      return;
    }
    this.active = false;
    event.preventDefault();
    this.emit('up', event);
  };

  private onCancel = (event: PointerEvent): void => {
    if (!this.active) {
      return;
    }
    this.active = false;
    this.emit('cancel', event);
  };

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    this.wheelAcc += delta;
    const now = event.timeStamp;
    if (Math.abs(this.wheelAcc) >= this.wheelThreshold && now - this.lastWheelFire > this.wheelCooldownMs) {
      const direction = this.wheelAcc > 0 ? 1 : -1;
      this.wheelAcc = 0;
      this.lastWheelFire = now;
      this.handlers.onWheelPulse(direction);
    }
  };

  private onKey = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
      return;
    }
    let direction = 0;
    if (event.key === 'PageDown' || event.key === ' ') {
      direction = 1;
    } else if (event.key === 'PageUp') {
      direction = -1;
    } else if (this.keyAxis.dir === 'x') {
      // 左右装订：→ = 下一页（左右装订均维持 → 前进语义）
      if (event.key === 'ArrowRight') direction = 1;
      else if (event.key === 'ArrowLeft') direction = -1;
    } else {
      // 上下装订：轴正方向 = 下一页（top: ↑；bottom: ↓）
      if (event.key === 'ArrowUp') direction = this.keyAxis.sign;
      else if (event.key === 'ArrowDown') direction = -this.keyAxis.sign;
    }
    if (direction !== 0) {
      event.preventDefault();
      this.handlers.onKeyPulse(direction);
    }
  };
}

/** 是否构成一次点击（位移与时长均在阈值内）。 */
export function isTap(downTime: number, upTime: number, moved: boolean, maxMs = 280): boolean {
  return !moved && upTime - downTime <= maxMs;
}
