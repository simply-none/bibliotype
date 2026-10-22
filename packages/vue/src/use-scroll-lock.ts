/**
 * 页面滚动锁定（H5 UI 改造 D5）
 *
 * 抽屉 / 底部 sheet / 全屏模态打开时锁住 body，避免 iOS Safari 背景橡皮筋
 * 导致浮层定位漂移。口径：
 * - 计数锁：多个浮层同时开启只锁一次，全部关闭才解锁（避免「后开先关」提前解锁）；
 *   计数与快照必须模块级共享 —— 若放在实例内，两个浮层叠加时会各自快照，
 *   先关的那个会把自己那份（无锁）样式写回去，直接拆掉后关那本的锁；
 * - 位置补偿：`position: fixed` + `top: -scrollY`，解锁时恢复滚动位置；
 * - 关闭后恢复原 inline 样式，不污染宿主样式表。
 *
 * SSR / 无 `document` 环境为 no-op；组件作用域销毁时自动解锁。
 */
import { onScopeDispose, ref, type Ref } from 'vue';

/** 滚动锁定选项 */
export interface UseScrollLockOptions {
  /** 注入文档（测试用；缺省全局 `document`） */
  doc?: Document | undefined;
}

/** 滚动锁定句柄 */
export interface UseScrollLock {
  /** 当前是否处于锁定态 */
  locked: Ref<boolean>;
  /** 加锁（可重复调用，计数累加） */
  lock: () => void;
  /** 解锁（计数减到 0 才真正恢复滚动） */
  unlock: () => void;
}

/** 锁定时需要还原的 body 内联样式快照 */
interface StyleSnapshot {
  position: string;
  top: string;
  left: string;
  right: string;
  width: string;
  overflow: string;
  overscrollBehavior: string;
}

/** 读取当前内联样式（作为解锁后的还原目标） */
function readStyle(body: HTMLElement): StyleSnapshot {
  return {
    position: body.style.position,
    top: body.style.top,
    left: body.style.left,
    right: body.style.right,
    width: body.style.width,
    overflow: body.style.overflow,
    overscrollBehavior: body.style.overscrollBehavior,
  };
}

/** 写回快照（空串即移除该内联声明） */
function writeStyle(body: HTMLElement, snapshot: StyleSnapshot): void {
  body.style.position = snapshot.position;
  body.style.top = snapshot.top;
  body.style.left = snapshot.left;
  body.style.right = snapshot.right;
  body.style.width = snapshot.width;
  body.style.overflow = snapshot.overflow;
  body.style.overscrollBehavior = snapshot.overscrollBehavior;
}

/**
 * 全局锁状态（模块级单例）
 *
 * 同页面可能同时存在多个浮层（如抽屉里再弹一个全屏模态），锁必须全局一份，
 * 否则各实例各写一套样式，最后关闭的那个无法确定该还原成什么。
 */
interface SharedLockState {
  /** 当前锁深度（所有实例共享） */
  depth: number;
  /** 加锁前的样式快照（仅首层锁记录） */
  snapshot: StyleSnapshot | null;
  /** 加锁前滚动位置 */
  savedScrollY: number;
  /** 实际加锁的文档（解锁时按同一文档还原） */
  doc: Document | null;
}

const shared: SharedLockState = { depth: 0, snapshot: null, savedScrollY: 0, doc: null };

/**
 * 创建滚动锁
 *
 * @param options 见 {@link UseScrollLockOptions}
 */
export function useScrollLock(options: UseScrollLockOptions = {}): UseScrollLock {
  const doc = options.doc ?? (typeof document === 'undefined' ? undefined : document);
  const locked = ref(false);
  /** 本实例是否持有锁（防止重复 unlock 扣穿共享深度） */
  let held = false;

  function lock(): void {
    if (doc === undefined) return;
    if (!held) {
      held = true;
      shared.depth += 1;
      // 只首层锁动样式：后续层只加计数
      if (shared.depth === 1) {
        const body = doc.body;
        if (body !== null && body !== undefined) {
          shared.snapshot = readStyle(body);
          shared.savedScrollY =
            typeof doc.defaultView?.scrollY === 'number' ? doc.defaultView.scrollY : 0;
          shared.doc = doc;
          body.style.position = 'fixed';
          body.style.top = `-${shared.savedScrollY}px`;
          body.style.left = '0';
          body.style.right = '0';
          body.style.width = '100%';
          body.style.overflow = 'hidden';
          body.style.overscrollBehavior = 'none';
        }
      }
    }
    locked.value = true;
  }

  function unlock(): void {
    if (!held) return;
    held = false;
    locked.value = false;
    shared.depth = Math.max(0, shared.depth - 1);
    if (shared.depth > 0) return;
    const targetDoc = shared.doc;
    const snapshot = shared.snapshot;
    shared.doc = null;
    shared.snapshot = null;
    if (targetDoc === null || snapshot === null) return;
    const body = targetDoc.body;
    if (body !== null && body !== undefined) writeStyle(body, snapshot);
    // 恢复滚动位置：iOS / Android 都会因 fixed 复位到 0
    targetDoc.defaultView?.scrollTo?.({ top: shared.savedScrollY, left: 0 });
  }

  onScopeDispose(() => {
    if (held) unlock();
  });

  return { locked, lock, unlock };
}
