/**
 * 阅读进度条触摸跳页测试（A6）
 *
 * 轨道是 `slider` 语义：`aria-valuenow` 随页码变化，aria-valuemax = 总页数。
 * 点 / 拖 / 键盘三种入口最终都走 `reader.goToPage`。
 *
 * demo 未安装 `@vue/test-utils`（其余测试都是纯逻辑），这里用 `createApp` 挂到
 * 临时容器；happy-dom 无布局，`getBoundingClientRect()` 固定 0 宽，需把轨道
 * mock 成 200px 宽才能换算比例。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import { NODE_TYPES, createEmptyDocument } from '@bibliotype/core';
import { Reader, type BlockSizeEstimator } from '@bibliotype/reader';
import ProgressBar from '../components/ProgressBar.vue';

/** mock 出的轨道宽度 */
const TRACK_WIDTH = 200;

/** 当前挂载实例（每个用例结束统一卸载） */
let mounted: { app: App; container: HTMLElement } | null = null;

afterEach(() => {
  mounted?.app.unmount();
  mounted?.container.remove();
  mounted = null;
});

function makeReader(): Reader {
  const doc = createEmptyDocument({ title: '进度' });
  doc.root.children = [
    {
      type: NODE_TYPES.CHAPTER,
      id: 'ch-1',
      attrs: { title: '第一章' },
      children: [1, 2, 3, 4].map((index) => ({
        type: NODE_TYPES.PARAGRAPH,
        id: `p-${index}`,
        children: [{ type: 'text', text: `正文${index}` }],
      })),
    },
  ];
  const estimator: BlockSizeEstimator = () => 100;
  const reader = new Reader({ pageMainSize: 100, bottomSlack: 0, estimator });
  reader.loadDocument(doc);
  return reader;
}

/** 挂载进度条并返回 mock 过尺寸的轨道 */
function mountBar(): { reader: Reader; track: HTMLElement } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const reader = makeReader();
  const app = createApp(ProgressBar, { reader });
  app.mount(container);
  mounted = { app, container };

  const track = container.querySelector('.progress__track');
  if (track === null) throw new Error('未渲染进度轨道');
  track.getBoundingClientRect = (): DOMRect =>
    ({
      left: 0,
      top: 0,
      width: TRACK_WIDTH,
      height: 8,
      right: TRACK_WIDTH,
      bottom: 8,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  return { reader, track: track as HTMLElement };
}

/** 造带 clientX 的指针事件（happy-dom 无 PointerEvent 构造器） */
function pointerEvent(type: string, clientX: number): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clientX', { value: clientX });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  return event;
}

/** 读 aria-valuenow / aria-valuemax */
function aria(track: HTMLElement): { now: number; max: number } {
  return {
    now: Number(track.getAttribute('aria-valuenow')),
    max: Number(track.getAttribute('aria-valuemax')),
  };
}

describe('ProgressBar 触摸跳页（A6）', () => {
  it('轨道暴露 slider 语义', async () => {
    const { track } = mountBar();
    await nextTick();

    expect(track.getAttribute('role')).toBe('slider');
    expect(track.getAttribute('aria-label')).toBe('阅读进度');
    expect(track.getAttribute('aria-valuemin')).toBe('1');
    expect(aria(track).now).toBe(1);
    expect(aria(track).max).toBeGreaterThan(1);
  });

  it('点轨道右端跳到末页', async () => {
    const { track } = mountBar();
    await nextTick();

    track.dispatchEvent(pointerEvent('pointerdown', TRACK_WIDTH));
    track.dispatchEvent(pointerEvent('pointerup', TRACK_WIDTH));
    await nextTick();

    const state = aria(track);
    expect(state.now).toBe(state.max);
  });

  it('按下拖动时跟手换页，松开结束', async () => {
    const { track } = mountBar();
    await nextTick();

    track.dispatchEvent(pointerEvent('pointerdown', 0));
    await nextTick();
    expect(aria(track).now).toBe(1);
    expect(track.classList.contains('progress__track--dragging')).toBe(true);

    track.dispatchEvent(pointerEvent('pointermove', TRACK_WIDTH / 2));
    await nextTick();
    const mid = aria(track).now;

    track.dispatchEvent(pointerEvent('pointermove', TRACK_WIDTH));
    await nextTick();
    const last = aria(track).now;

    track.dispatchEvent(pointerEvent('pointerup', TRACK_WIDTH));
    await nextTick();

    expect(mid).toBeGreaterThan(1);
    expect(last).toBe(aria(track).max);
    expect(track.classList.contains('progress__track--dragging')).toBe(false);
  });

  it('键盘 ←/→ 逐页', async () => {
    const { track } = mountBar();
    await nextTick();
    const first = aria(track).now;

    track.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    await nextTick();
    expect(aria(track).now).toBe(first + 1);

    track.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    await nextTick();
    expect(aria(track).now).toBe(first);
  });
});
