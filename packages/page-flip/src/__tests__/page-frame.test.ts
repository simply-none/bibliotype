import { describe, expect, it } from 'vitest';
import {
  canonicalSize,
  canonicalToScreen,
  frameIndex,
  resolveBindEdge,
  screenToCanonical,
} from '../page-frame';
import type { BindEdge, PageSize } from '../types';

/** 屏幕页面：竖页 400×600（左右装订）；横页 600×400（上下装订）。 */
const PORTRAIT: PageSize = { width: 400, height: 600 };
const LANDSCAPE: PageSize = { width: 600, height: 400 };

const EDGES: BindEdge[] = ['left', 'right', 'top', 'bottom'];

describe('resolveBindEdge', () => {
  it('显式 bindEdge 优先，否则按 orientation 映射', () => {
    expect(resolveBindEdge({ bindEdge: 'top', orientation: 'rtl' })).toBe('top');
    expect(resolveBindEdge({ orientation: 'ltr' })).toBe('left');
    expect(resolveBindEdge({ orientation: 'rtl' })).toBe('right');
    expect(resolveBindEdge()).toBe('left');
  });
});

describe('canonicalSize', () => {
  it('左右装订与屏幕同形，上下装订为转置', () => {
    expect(canonicalSize(PORTRAIT, 'left')).toEqual(PORTRAIT);
    expect(canonicalSize(PORTRAIT, 'right')).toEqual(PORTRAIT);
    expect(canonicalSize(LANDSCAPE, 'top')).toEqual({ width: 400, height: 600 });
    expect(canonicalSize(LANDSCAPE, 'bottom')).toEqual({ width: 400, height: 600 });
  });
});

describe('screenToCanonical / canonicalToScreen', () => {
  it('四种帧互相可逆（采样点往返零误差）', () => {
    for (const edge of EDGES) {
      const screen = edge === 'top' || edge === 'bottom' ? LANDSCAPE : PORTRAIT;
      for (const p of [
        { x: 0, y: 0 },
        { x: screen.width, y: screen.height },
        { x: 123.4, y: 256.8 },
      ]) {
        const back = canonicalToScreen(screenToCanonical(p, screen, edge), screen, edge);
        expect(back.x).toBeCloseTo(p.x, 6);
        expect(back.y).toBeCloseTo(p.y, 6);
      }
    }
  });

  it('书脊落在正确的屏幕边缘（规范 x=0）', () => {
    // left：规范 x=0 ↔ 屏幕 x=0（左缘）
    expect(canonicalToScreen({ x: 0, y: 300 }, PORTRAIT, 'left').x).toBe(0);
    // right：规范 x=0 ↔ 屏幕 x=Sw（右缘）
    expect(canonicalToScreen({ x: 0, y: 300 }, PORTRAIT, 'right').x).toBe(400);
    // top：规范 x=0 ↔ 屏幕 y=0（上缘）
    expect(canonicalToScreen({ x: 0, y: 300 }, LANDSCAPE, 'top').y).toBe(0);
    // bottom：规范 x=0 ↔ 屏幕 y=Sh（下缘）
    expect(canonicalToScreen({ x: 0, y: 300 }, LANDSCAPE, 'bottom').y).toBe(400);
  });

  it('自由边落在书脊的对侧', () => {
    const Wc = canonicalSize(PORTRAIT, 'left').width;
    expect(canonicalToScreen({ x: Wc, y: 300 }, PORTRAIT, 'left').x).toBe(400);
    expect(canonicalToScreen({ x: Wc, y: 300 }, PORTRAIT, 'right').x).toBe(0);
    const WcT = canonicalSize(LANDSCAPE, 'top').width; // = 屏幕高
    expect(canonicalToScreen({ x: WcT, y: 300 }, LANDSCAPE, 'top').y).toBe(400);
    expect(canonicalToScreen({ x: WcT, y: 300 }, LANDSCAPE, 'bottom').y).toBe(0);
  });

  it('RTL 镜像（right）与旧实现一致：sx = Sw − cx', () => {
    expect(screenToCanonical({ x: 100, y: 200 }, PORTRAIT, 'right')).toEqual({ x: 300, y: 200 });
  });
});

describe('frameIndex', () => {
  it('四种装订侧对应着色器分支 0..3', () => {
    expect(frameIndex('left')).toBe(0);
    expect(frameIndex('right')).toBe(1);
    expect(frameIndex('top')).toBe(2);
    expect(frameIndex('bottom')).toBe(3);
  });
});
