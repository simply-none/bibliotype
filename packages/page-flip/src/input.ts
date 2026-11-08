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

const TAP_MAX_MS = 280;
const TAP_MAX_DIST = 8;
/** 滚轮累计触发阈值（归一化 delta）。 */
const WHEEL_THRESHOLD = 90;
/** 滚轮触发冷却（毫秒）。 */
const WHEEL_COOLDOWN = 380;

export class InputSource {
  private active = false;
  private downX = 0;
  private downY = 0;
  private downTime = 0;
  private moved = false;
  private wheelAcc = 0;
  private lastWheelFire = 0;
  private readonly controller = new AbortController();

  constructor(
    private readonly element: HTMLElement,
    private readonly handlers: InputSourceHandlers
  ) {
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
    if (Math.hypot(event.clientX - this.downX, event.clientY - this.downY) > TAP_MAX_DIST) {
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
    if (Math.abs(this.wheelAcc) >= WHEEL_THRESHOLD && now - this.lastWheelFire > WHEEL_COOLDOWN) {
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
    if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {
      direction = 1;
    } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
      direction = -1;
    }
    if (direction !== 0) {
      event.preventDefault();
      this.handlers.onKeyPulse(direction);
    }
  };
}

/** 是否构成一次点击（位移与时长均在阈值内）。 */
export function isTap(downTime: number, upTime: number, moved: boolean): boolean {
  return !moved && upTime - downTime <= TAP_MAX_MS;
}
