/**
 * 事件总线测试
 */
import { describe, expect, it, vi } from 'vitest';
import { EventBus, createEventBus } from '../events/event-bus.js';

interface TestEvents {
  'item:add': { id: number };
  'item:remove': { id: number };
}

describe('EventBus', () => {
  it('订阅并接收载荷', () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();
    bus.on('item:add', handler);
    bus.emit('item:add', { id: 1 });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ id: 1 });
  });

  it('on 返回的函数可解除订阅', () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();
    const unsubscribe = bus.on('item:add', handler);
    unsubscribe();
    bus.emit('item:add', { id: 1 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('once 仅触发一次', () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();
    bus.once('item:add', handler);
    bus.emit('item:add', { id: 1 });
    bus.emit('item:add', { id: 2 });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('处理器中退订不影响本轮其他处理器', () => {
    const bus = new EventBus<TestEvents>();
    const second = vi.fn();
    const unsubscribeFirst = bus.on('item:add', () => unsubscribeFirst());
    bus.on('item:add', second);
    bus.emit('item:add', { id: 1 });
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('hasListeners 与 clear 行为正确', () => {
    const bus = createEventBus();
    expect(bus.hasListeners('page:change')).toBe(false);
    bus.on('page:change', () => undefined);
    expect(bus.hasListeners('page:change')).toBe(true);
    bus.clear();
    expect(bus.hasListeners('page:change')).toBe(false);
  });
});
