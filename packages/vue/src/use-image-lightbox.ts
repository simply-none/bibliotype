/**
 * 图片放大弹窗（lightbox）的命中解析与状态组合式
 *
 * 阅读页与编辑画布的图片 DOM 形态不同：阅读页是序列化产物（真 `<img>`），
 * 编辑画布的块级 image 是缺省 toDOM 的 `div.bt-image[data-src]`（无 img 子元素），
 * 行内字图两侧都是真 `<img>`（原字在 `data-char`）。`resolveImageTarget` 统一识别
 * 三种形态取回 src / alt / 原字，供点击 / 双击委托命中；`useImageLightbox`
 * 持有弹窗状态，打开与关闭收敛到两个动作，弹窗本体见 `BtImageLightbox`。
 */
import { ref, type Ref } from 'vue';

/** 弹窗展示的图片信息 */
export interface LightboxImage {
  /** 图片 src（data URI 或资源地址） */
  src: string;
  /** 替代文本（弹窗说明文字；字图优先显示原字） */
  alt?: string;
  /** 字图原字（来自 data-char） */
  char?: string;
}

/** 委托命中选择器：阅读页块级插图 / 行内字图（真 img）+ 编辑画布块级 image（div） */
const IMAGE_TARGET_SELECTOR = 'img.bt-image, img.bt-glyph-image, div.bt-image';

/** 读元素属性（空串视为无） */
function attrOf(element: Element, name: string): string | undefined {
  const value = element.getAttribute(name);
  return value === null || value === '' ? undefined : value;
}

/**
 * 解析点击 / 双击目标为弹窗图片信息（事件委托命中判定）
 *
 * @param target 事件目标（`event.target`）
 * @returns 命中图片返回 src / alt / char；非图片或无 src 返回 null
 *
 * @example
 * const target = resolveImageTarget(event.target);
 * if (target !== null) {
 *   event.preventDefault(); // 消费该次点击，阻止翻页分区等后续管道
 *   open(target);
 * }
 */
export function resolveImageTarget(target: EventTarget | null): LightboxImage | null {
  if (target === null || typeof target !== 'object') return null;
  const element = target as Element;
  if (typeof element.closest !== 'function') return null;
  const hit = element.closest(IMAGE_TARGET_SELECTOR);
  if (hit === null) return null;
  /* 阅读页是真 img（src 属性）；编辑画布块级 image 是 div（src 在 data-src） */
  const src = attrOf(hit, 'src') ?? attrOf(hit, 'data-src');
  if (src === undefined) return null;
  return {
    src,
    alt: attrOf(hit, 'alt') ?? attrOf(hit, 'data-alt'),
    char: attrOf(hit, 'data-char'),
  };
}

/** 图片弹窗状态组合式的返回值 */
export interface UseImageLightbox {
  /** 当前展示的图片（null = 关闭态） */
  image: Ref<LightboxImage | null>;
  /** 打开弹窗 */
  open: (target: LightboxImage) => void;
  /** 关闭弹窗 */
  close: () => void;
}

/**
 * 图片弹窗状态组合式
 *
 * 状态只有一个 `image` ref：非 null 即打开态，`BtImageLightbox` 据此渲染。
 * 供宿主组件（BtBookView / BtEditor）在自身委托管道中接线，也可独立使用。
 */
export function useImageLightbox(): UseImageLightbox {
  const image = ref<LightboxImage | null>(null);
  const open = (target: LightboxImage): void => {
    image.value = target;
  };
  const close = (): void => {
    image.value = null;
  };
  return { image, open, close };
}
