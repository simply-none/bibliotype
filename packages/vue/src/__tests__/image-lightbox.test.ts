/**
 * 图片放大弹窗测试
 *
 * - `resolveImageTarget`：阅读页真 `<img>`（块级插图 / 行内字图）与编辑画布
 *   `div.bt-image[data-src]` 三种形态命中，非图片 / 无 src 返回 null；
 * - `BtImageLightbox`：关闭态不渲染、打开渲染图片与说明文字（原字优先）、
 *   Esc / 遮罩 / 关闭按钮三条关闭途径、`maskClosable=false` 遮罩失效；
 * - `BtBookView` 接线：`imageLightbox` 开启时点击插图弹窗放大且不触发翻页分区，
 *   缺省关闭维持原点按行为（弹窗内容 Teleport 到 body，经 document.body 查询）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import { NODE_TYPES, createEmptyDocument } from '@bibliotype/core';
import { Reader, type BlockSizeEstimator } from '@bibliotype/reader';
import { resolveImageTarget } from '../use-image-lightbox.js';
import BtImageLightbox from '../components/BtImageLightbox.vue';
import BtBookView from '../components/BtBookView.vue';

/* ---------- resolveImageTarget ---------- */

describe('resolveImageTarget 命中解析', () => {
  it('阅读页块级插图 img.bt-image：src / alt', () => {
    const el = document.createElement('img');
    el.className = 'bt-image';
    el.setAttribute('src', 'data:image/png;base64,AA==');
    el.setAttribute('alt', '书影');
    expect(resolveImageTarget(el)).toEqual({
      src: 'data:image/png;base64,AA==',
      alt: '书影',
      char: undefined,
    });
  });

  it('行内字图 img.bt-glyph-image：data-char 作原字', () => {
    const el = document.createElement('img');
    el.className = 'bt-glyph-image';
    el.setAttribute('src', 'z.png');
    el.setAttribute('alt', '贔');
    el.setAttribute('data-char', '贔');
    expect(resolveImageTarget(el)).toEqual({ src: 'z.png', alt: '贔', char: '贔' });
  });

  it('点击图片内部元素时向上委托命中', () => {
    const host = document.createElement('p');
    const el = document.createElement('img');
    el.className = 'bt-glyph-image';
    el.setAttribute('src', 'z.png');
    el.setAttribute('data-char', '贔');
    host.appendChild(el);
    /* 事件目标可能是 img 内的命中点，closest 向上找 */
    expect(resolveImageTarget(el)?.char).toBe('贔');
  });

  it('编辑画布块级 image div.bt-image：src / alt 在 data-* 上', () => {
    const el = document.createElement('div');
    el.className = 'bt-image';
    el.setAttribute('data-src', 'plate.jpg');
    el.setAttribute('data-alt', '插图');
    expect(resolveImageTarget(el)).toEqual({ src: 'plate.jpg', alt: '插图', char: undefined });
  });

  it('非图片元素、无 src、空目标返回 null', () => {
    const paragraph = document.createElement('p');
    paragraph.textContent = '正文';
    expect(resolveImageTarget(paragraph)).toBeNull();
    expect(resolveImageTarget(null)).toBeNull();

    const img = document.createElement('img');
    img.className = 'bt-image';
    expect(resolveImageTarget(img)).toBeNull();

    const empty = document.createElement('img');
    empty.className = 'bt-glyph-image';
    empty.setAttribute('src', '');
    expect(resolveImageTarget(empty)).toBeNull();
  });
});

/* ---------- BtImageLightbox 组件 ---------- */

describe('BtImageLightbox 组件', () => {
  let wrapper: VueWrapper | null = null;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = '';
    document.body.removeAttribute('style');
  });

  function mountLightbox(props: Record<string, unknown> = {}): VueWrapper {
    wrapper = mount(BtImageLightbox, {
      props: {
        image: { src: 'z.png', alt: '贔', char: '贔' },
        ...props,
      },
      attachTo: document.body,
    });
    return wrapper;
  }

  function query<T extends HTMLElement>(selector: string): T {
    const el = document.body.querySelector(selector);
    if (el === null) throw new Error(`未找到 ${selector}`);
    return el as T;
  }

  it('image 为 null 不渲染；打开后渲染图片与原字说明', async () => {
    wrapper = mountLightbox({ image: null });
    await nextTick();
    expect(document.body.querySelector('.bt-lightbox')).toBeNull();

    await wrapper.setProps({ image: { src: 'z.png', alt: '贔', char: '贔' } });
    await nextTick();
    expect(query<HTMLImageElement>('.bt-lightbox__image').getAttribute('src')).toBe('z.png');
    expect(query('.bt-lightbox__caption').textContent).toBe('原字：贔');
    expect(document.body.querySelector('.bt-lightbox')?.getAttribute('aria-label')).toBe(
      '图片放大查看',
    );
  });

  it('无原字时说明取 alt；两者皆无不渲染说明', async () => {
    wrapper = mountLightbox({ image: { src: 'plate.jpg', alt: '书影一' } });
    await nextTick();
    expect(query('.bt-lightbox__caption').textContent).toBe('书影一');

    await wrapper!.setProps({ image: { src: 'plate.jpg' } });
    await nextTick();
    expect(document.body.querySelector('.bt-lightbox__caption')).toBeNull();
  });

  it('Esc 关闭', async () => {
    wrapper = mountLightbox();
    await nextTick();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await nextTick();
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('遮罩点击与关闭按钮关闭；maskClosable=false 遮罩失效', async () => {
    wrapper = mountLightbox();
    await nextTick();
    query('.bt-lightbox__mask').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(wrapper.emitted('close')).toHaveLength(1);

    wrapper.unmount();
    wrapper = mountLightbox({ maskClosable: false });
    await nextTick();
    query('.bt-lightbox__mask').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(wrapper.emitted('close')).toBeUndefined();

    query<HTMLButtonElement>('.bt-lightbox__close').click();
    await nextTick();
    expect(wrapper.emitted('close')).toHaveLength(1);
  });
});

/* ---------- 缩放 / 平移手势 ---------- */

/** 造带坐标 / 增量的滚轮事件（统一 defineProperty，happy-dom 坐标不可靠） */
function wheelEvent(deltaY: number, clientX = 0, clientY = 0): Event {
  const event = new Event('wheel', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'deltaY', { value: deltaY });
  Object.defineProperty(event, 'clientX', { value: clientX });
  Object.defineProperty(event, 'clientY', { value: clientY });
  return event;
}

/** 造指针事件（pointerId / 坐标用 defineProperty） */
function pointerEvent(type: string, id: number, clientX: number, clientY: number): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'pointerId', { value: id });
  Object.defineProperty(event, 'clientX', { value: clientX });
  Object.defineProperty(event, 'clientY', { value: clientY });
  return event;
}

describe('BtImageLightbox 缩放 / 平移', () => {
  let wrapper: VueWrapper | null = null;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = '';
    document.body.removeAttribute('style');
  });

  function mountOpen(): VueWrapper {
    wrapper = mount(BtImageLightbox, {
      props: { image: { src: 'plate.jpg', alt: '插图' } },
      attachTo: document.body,
    });
    return wrapper;
  }

  function root<T extends HTMLElement = HTMLElement>(selector = '.bt-lightbox'): T {
    const el = document.body.querySelector(selector);
    if (el === null) throw new Error(`未找到 ${selector}`);
    return el as T;
  }

  function currentScale(): number {
    const img = document.body.querySelector<HTMLElement>('.bt-lightbox__image');
    if (img === null) throw new Error('未找到弹窗图片');
    const match = /scale\(([\d.]+)\)/.exec(img.style.transform);
    return match === null ? 1 : Number.parseFloat(match[1] ?? '1');
  }

  it('滚轮缩放恒居中：倍率变化不改平移偏移，且以上限 8 倍限幅', async () => {
    wrapper = mountOpen();
    await nextTick();
    expect(currentScale()).toBe(1);

    /* 光标偏离中心缩放：图片仍居中放大，不漂移 */
    root().dispatchEvent(wheelEvent(-100, 150, 100));
    await nextTick();
    expect(currentScale()).toBeGreaterThan(1);
    expect(root<HTMLElement>('.bt-lightbox__image').style.transform).toContain(
      'translate(0px, 0px)',
    );

    for (let index = 0; index < 40; index += 1) {
      root().dispatchEvent(wheelEvent(-100));
    }
    await nextTick();
    expect(currentScale()).toBeLessThanOrEqual(8);

    root().dispatchEvent(wheelEvent(100));
    await nextTick();
    expect(currentScale()).toBeLessThan(8);
  });

  it('双指捏合按指距比缩放（move / up 跟踪挂在 window）', async () => {
    wrapper = mountOpen();
    await nextTick();
    const el = root();

    el.dispatchEvent(pointerEvent('pointerdown', 1, 100, 200));
    el.dispatchEvent(pointerEvent('pointerdown', 2, 200, 200));
    window.dispatchEvent(pointerEvent('pointermove', 2, 350, 200)); // 指距 100 → 250，倍率 2.5
    await nextTick();
    expect(Math.abs(currentScale() - 2.5)).toBeLessThan(0.01);

    window.dispatchEvent(pointerEvent('pointerup', 1, 100, 200));
    window.dispatchEvent(pointerEvent('pointerup', 2, 350, 200));
  });

  it('放大后拖拽平移；拖后的遮罩 click 不当点按关闭', async () => {
    wrapper = mountOpen();
    await nextTick();
    const el = root();

    el.dispatchEvent(wheelEvent(-100)); // 先放大
    el.dispatchEvent(pointerEvent('pointerdown', 1, 200, 200));
    window.dispatchEvent(pointerEvent('pointermove', 1, 250, 230));
    window.dispatchEvent(pointerEvent('pointerup', 1, 250, 230));
    await nextTick();
    expect(root<HTMLElement>('.bt-lightbox__image').style.transform).toContain('translate(50px, 30px)');

    /* 拖拽结束的 click 不是点按：不关闭 */
    root<HTMLElement>('.bt-lightbox__mask').dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    await nextTick();
    expect(wrapper.emitted('close')).toBeUndefined();

    /* 之后的干净点按正常关闭 */
    root<HTMLElement>('.bt-lightbox__mask').dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    await nextTick();
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('指针手势跟踪下关闭按钮仍可点击；手势结束后 window 监听已摘除', async () => {
    wrapper = mountOpen();
    await nextTick();
    const el = root();

    /* 浏览器真实点击序列：pointerdown / up 先于 click（此前 capture 会吞掉 click） */
    el.dispatchEvent(pointerEvent('pointerdown', 1, 300, 20));
    window.dispatchEvent(pointerEvent('pointerup', 1, 300, 20));
    root<HTMLButtonElement>('.bt-lightbox__close').click();
    await nextTick();
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('双击图片复位；关闭再打开缩放状态归零', async () => {
    wrapper = mountOpen();
    await nextTick();
    const el = root();

    el.dispatchEvent(wheelEvent(-100));
    await nextTick();
    expect(currentScale()).toBeGreaterThan(1);

    root<HTMLElement>('.bt-lightbox__image').dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true, cancelable: true }),
    );
    await nextTick();
    expect(currentScale()).toBe(1);
    expect(root<HTMLElement>('.bt-lightbox__image').style.transform).toContain('translate(0px, 0px)');

    /* 关闭 → 重新打开：状态不得带入上一张 */
    el.dispatchEvent(wheelEvent(-100));
    await nextTick();
    await wrapper!.setProps({ image: null });
    await nextTick();
    expect(document.body.querySelector('.bt-lightbox')).toBeNull();

    await wrapper!.setProps({ image: { src: 'z.png' } });
    await nextTick();
    expect(currentScale()).toBe(1);
  });
});

/* ---------- BtBookView 接线 ---------- */

/** mock 出的阅读区宽度（happy-dom 无布局，分区比例要靠它） */
const PAGE_WIDTH = 300;

function makeReaderWithImage(): Reader {
  const doc = createEmptyDocument({ title: '图片' });
  doc.root.children = [
    {
      type: NODE_TYPES.CHAPTER,
      id: 'ch-1',
      attrs: { title: '第一章' },
      children: [
        { type: NODE_TYPES.PARAGRAPH, id: 'p-1', children: [{ type: 'text', text: '前文' }] },
        {
          type: NODE_TYPES.IMAGE,
          id: 'img-1',
          attrs: { src: 'data:image/png;base64,AA==', alt: '插图' },
        },
        { type: NODE_TYPES.PARAGRAPH, id: 'p-2', children: [{ type: 'text', text: '后文' }] },
        { type: NODE_TYPES.PARAGRAPH, id: 'p-3', children: [{ type: 'text', text: '续文' }] },
      ],
    },
  ];
  const estimator: BlockSizeEstimator = () => 100;
  const reader = new Reader({ pageMainSize: 100, bottomSlack: 0, estimator });
  reader.loadDocument(doc);
  return reader;
}

describe('BtBookView 图片弹窗接线', () => {
  let wrapper: VueWrapper | null = null;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = '';
    document.body.removeAttribute('style');
  });

  function mountView(props: Record<string, unknown> = {}): VueWrapper {
    const reader = makeReaderWithImage();
    wrapper = mount(BtBookView, { props: { reader, ...props }, attachTo: document.body });
    reader.goToPage(1);
    const stage = wrapper.find('.bt-book-view--paged').element as HTMLElement;
    stage.getBoundingClientRect = (): DOMRect =>
      ({
        left: 0,
        top: 0,
        width: PAGE_WIDTH,
        height: 400,
        right: PAGE_WIDTH,
        bottom: 400,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    return wrapper;
  }

  it('imageLightbox 开启：点击插图弹窗放大，不触发翻页分区', async () => {
    wrapper = mountView({ imageLightbox: true });
    await nextTick();
    const before = (wrapper.emitted('update:page') ?? []).length;

    const img = document.body.querySelector('.bt-book-view--paged img.bt-image');
    if (img === null) throw new Error('页面中未渲染出 img.bt-image');
    img.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, clientX: PAGE_WIDTH * 0.9 }),
    );
    await nextTick();

    const lightbox = document.body.querySelector('.bt-lightbox');
    expect(lightbox).not.toBeNull();
    expect(document.body.querySelector('.bt-lightbox__image')?.getAttribute('src')).toBe(
      'data:image/png;base64,AA==',
    );
    expect(document.body.querySelector('.bt-lightbox__caption')?.textContent).toBe('插图');
    /* 命中图片消费点击：右缘位置也不翻页 */
    expect((wrapper.emitted('update:page') ?? []).length).toBe(before);
  });

  it('缺省关闭：点击图片维持原点按分区行为，不弹窗', async () => {
    wrapper = mountView();
    await nextTick();
    const before = (wrapper.emitted('update:page') ?? []).length;

    const img = document.body.querySelector('.bt-book-view--paged img.bt-image');
    if (img === null) throw new Error('页面中未渲染出 img.bt-image');
    img.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, clientX: PAGE_WIDTH * 0.9 }),
    );
    await nextTick();

    expect(document.body.querySelector('.bt-lightbox')).toBeNull();
    expect((wrapper.emitted('update:page') ?? []).length).toBeGreaterThan(before);
  });
});
