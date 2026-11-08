/**
 * InputSource 测试：滚轮 deltaMode 归一化 + 悬停转发。
 * headless 环境（无 window）：键盘监听不注册，仅测元素级事件。
 */
import { describe, expect, it } from 'vitest';
import { InputSource, type InputSourceHandlers } from '../input';

/** 假元素：记录监听器 + 提供矩形。 */
function createElement() {
  const listeners = new Map<string, Array<(event: unknown) => void>>();
  const element = {
    addEventListener: (type: string, handler: (event: unknown) => void) => {
      const list = listeners.get(type) ?? [];
      list.push(handler);
      listeners.set(type, list);
    },
    removeEventListener: () => undefined,
    setPointerCapture: () => undefined,
    getBoundingClientRect: () => ({ left: 10, top: 20, right: 410, bottom: 620, width: 400, height: 600 }),
  } as unknown as HTMLElement;
  return { element, listeners };
}

function fire(listeners: Map<string, Array<(event: unknown) => void>>, type: string, event: unknown): void {
  for (const handler of listeners.get(type) ?? []) {
    handler(event);
  }
}

function wheelEvent(deltaMode: number, deltaY: number, timeStamp: number): unknown {
  return { deltaX: 0, deltaY, deltaMode, timeStamp, preventDefault: () => undefined };
}

function pointerMove(clientX: number, clientY: number, timeStamp: number): unknown {
  return { isPrimary: true, clientX, clientY, timeStamp, preventDefault: () => undefined, pointerId: 1 };
}

describe('InputSource 滚轮 deltaMode 归一化', () => {
  function create(handlers: Partial<InputSourceHandlers>) {
    const { element, listeners } = createElement();
    new InputSource(
      element,
      { onPointer: () => undefined, onWheelPulse: () => undefined, onKeyPulse: () => undefined, ...handlers },
      { wheelThreshold: 90 }
    );
    return listeners;
  }

  it('像素模式（deltaMode 0）：单格 ≥ 阈值立即触发', () => {
    const pulses: number[] = [];
    const listeners = create({ onWheelPulse: (d) => pulses.push(d) });
    fire(listeners, 'wheel', wheelEvent(0, 100, 1000));
    expect(pulses).toEqual([1]);
  });

  it('行模式（deltaMode 1，Firefox）：3 行×16=48 < 90 不触发，累计两格触发', () => {
    const pulses: number[] = [];
    const listeners = create({ onWheelPulse: (d) => pulses.push(d) });
    fire(listeners, 'wheel', wheelEvent(1, 3, 1000));
    expect(pulses).toEqual([]); // 48 < 90
    fire(listeners, 'wheel', wheelEvent(1, 3, 1100));
    expect(pulses).toEqual([1]); // 96 ≥ 90（距上次触发 > 冷却）
  });

  it('页模式（deltaMode 2）：1 页×100 触发', () => {
    const pulses: number[] = [];
    const listeners = create({ onWheelPulse: (d) => pulses.push(d) });
    fire(listeners, 'wheel', wheelEvent(2, 1, 1000));
    expect(pulses).toEqual([1]);
  });

  it('负向滚动 → backward 脉冲', () => {
    const pulses: number[] = [];
    const listeners = create({ onWheelPulse: (d) => pulses.push(d) });
    fire(listeners, 'wheel', wheelEvent(0, -120, 1000));
    expect(pulses).toEqual([-1]);
  });
});

describe('InputSource 悬停转发', () => {
  it('未按下时的 pointermove → onHover（元素内坐标）；pointerleave → onHoverEnd', () => {
    const hovers: Array<{ x: number; y: number }> = [];
    let hoverEnded = 0;
    const { element, listeners } = createElement();
    new InputSource(element, {
      onPointer: () => undefined,
      onWheelPulse: () => undefined,
      onKeyPulse: () => undefined,
      onHover: (x, y) => hovers.push({ x, y }),
      onHoverEnd: () => {
        hoverEnded++;
      },
    });
    fire(listeners, 'pointermove', pointerMove(30, 40, 5));
    expect(hovers).toEqual([{ x: 20, y: 20 }]); // clientX − rect.left, clientY − rect.top
    fire(listeners, 'pointerleave', {});
    expect(hoverEnded).toBe(1);
  });
});
