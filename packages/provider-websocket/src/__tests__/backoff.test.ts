import { describe, expect, it } from 'vitest';
import { nextReconnectDelay } from '../backoff.js';

describe('重连退避', () => {
  it('无抖动时按倍数增长', () => {
    const options = { baseDelayMs: 500, factor: 2, jitterRatio: 0, random: () => 0.5 };
    expect(nextReconnectDelay(0, options)).toBe(500);
    expect(nextReconnectDelay(1, options)).toBe(1000);
    expect(nextReconnectDelay(2, options)).toBe(2000);
    expect(nextReconnectDelay(3, options)).toBe(4000);
  });

  it('达到上限后不再增长', () => {
    const options = { baseDelayMs: 500, maxDelayMs: 3000, jitterRatio: 0 };
    expect(nextReconnectDelay(10, options)).toBe(3000);
  });

  it('抖动边界：random=0 取下界，random=1 取上界', () => {
    const low = nextReconnectDelay(0, {
      baseDelayMs: 1000,
      jitterRatio: 0.5,
      random: () => 0,
    });
    const high = nextReconnectDelay(0, {
      baseDelayMs: 1000,
      jitterRatio: 0.5,
      random: () => 1,
    });
    expect(low).toBe(500);
    expect(high).toBe(1500);
  });

  it('抖动不会超过上限', () => {
    expect(
      nextReconnectDelay(5, {
        baseDelayMs: 1000,
        maxDelayMs: 2000,
        jitterRatio: 0.9,
        random: () => 1,
      }),
    ).toBe(2000);
  });

  it('非法输入回退到安全值（不产生 NaN / 负延迟）', () => {
    const delay = nextReconnectDelay(-3, {
      baseDelayMs: Number.NaN,
      maxDelayMs: -1,
      factor: 0.5,
      jitterRatio: 2,
      random: () => Number.NaN,
    });
    expect(Number.isFinite(delay)).toBe(true);
    expect(delay).toBeGreaterThanOrEqual(0);
  });
});
