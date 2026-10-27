/**
 * 触屏缩放守卫：预览区内放行、区外拦截
 *
 * happy-dom 不提供可构造的 `TouchEvent`，这里用普通 `Event` 补齐 `touches` / `target`
 * 两个只读字段后调用处理器——断言的正是「会不会 preventDefault」这一对外行为。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { ref } from 'vue';
import { useMobileZoomGuard } from '../composables/use-mobile-zoom-guard.js';

/** 合成带触点数量的事件 */
function eventOf(type: string, touchCount: number, target: EventTarget): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', { value: { length: touchCount } });
  Object.defineProperty(event, 'target', { value: target });
  return event;
}

/** 搭建「舞台（含子节点）+ 舞台外的浮层」两处命中区 */
function setup(enabled = true) {
  const stage = document.createElement('div');
  const insideNode = document.createElement('p');
  stage.append(insideNode);
  const outsideNode = document.createElement('div');
  document.body.append(stage, outsideNode);
  const guard = useMobileZoomGuard({ enabled: ref(enabled), stage: ref(stage) });
  return { guard, stage, insideNode, outsideNode };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('useMobileZoomGuard', () => {
  it('预览区内双指按下放行（交给阅读器自己的手势）', () => {
    const { guard, insideNode } = setup();
    const event = eventOf('touchstart', 2, insideNode);
    guard.onTouchStart(event as unknown as TouchEvent);
    expect(event.defaultPrevented).toBe(false);
  });

  it('预览区外双指按下被拦截', () => {
    const { guard, outsideNode } = setup();
    const event = eventOf('touchstart', 2, outsideNode);
    guard.onTouchStart(event as unknown as TouchEvent);
    expect(event.defaultPrevented).toBe(true);
  });

  it('预览区外双指移动被拦截', () => {
    const { guard, outsideNode } = setup();
    const event = eventOf('touchmove', 2, outsideNode);
    guard.onTouchMove(event as unknown as TouchEvent);
    expect(event.defaultPrevented).toBe(true);
  });

  it('预览区内双指移动放行', () => {
    const { guard, stage } = setup();
    const event = eventOf('touchmove', 2, stage);
    guard.onTouchMove(event as unknown as TouchEvent);
    expect(event.defaultPrevented).toBe(false);
  });

  it('单指按下 / 移动都不拦截（不干扰点击、滚动与翻页）', () => {
    const { guard, outsideNode } = setup();
    const start = eventOf('touchstart', 1, outsideNode);
    const move = eventOf('touchmove', 1, outsideNode);
    guard.onTouchStart(start as unknown as TouchEvent);
    guard.onTouchMove(move as unknown as TouchEvent);
    expect(start.defaultPrevented).toBe(false);
    expect(move.defaultPrevented).toBe(false);
  });

  it('桌面（未启用）不拦截', () => {
    const { guard, outsideNode } = setup(false);
    const event = eventOf('touchmove', 2, outsideNode);
    guard.onTouchMove(event as unknown as TouchEvent);
    expect(event.defaultPrevented).toBe(false);
  });

  it('舞台尚未挂载时按区外处理', () => {
    const outsideNode = document.createElement('div');
    document.body.append(outsideNode);
    const guard = useMobileZoomGuard({ enabled: ref(true), stage: ref(null) });
    const event = eventOf('touchstart', 2, outsideNode);
    guard.onTouchStart(event as unknown as TouchEvent);
    expect(event.defaultPrevented).toBe(true);
  });

  it('Safari gesturestart：区内放行、区外拦截', () => {
    const { guard, insideNode, outsideNode } = setup();
    const inside = eventOf('gesturestart', 0, insideNode);
    const outside = eventOf('gesturestart', 0, outsideNode);
    guard.onGestureStart(inside);
    guard.onGestureStart(outside);
    expect(inside.defaultPrevented).toBe(false);
    expect(outside.defaultPrevented).toBe(true);
  });
});
