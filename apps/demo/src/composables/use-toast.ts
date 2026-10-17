/**
 * 消息提示（Demo 层）
 *
 * 用途：**操作结果**这类一次性反馈（导出完成 / 校验有错 / 失败原因）走这里，
 * 不再往顶栏塞状态行 —— 顶栏只留书名与常驻状态，信息不堆叠、不挤占排版空间。
 *
 * 与「悬浮说明」的分工：
 * - 悬浮说明（`ToolbarUsageTip`）= **事前**告诉用户这个按钮怎么用，挂在按钮上；
 * - 消息提示（本文件）= **事后**告诉用户刚才发生了什么，浮在右下角并自动消失。
 *
 * 用法（App.vue）：
 * ```ts
 * const { items: toasts, push: pushToast, dismiss: dismissToast } = useToast();
 * pushToast('已导出 EPUB', 'success');
 * ```
 * 每条消息独立计时，同文案不去重（导出连点两次应看到两次反馈）。
 */
import { onBeforeUnmount, ref, type Ref } from 'vue';

/** 语气：决定配色与停留时长 */
export type ToastTone = 'info' | 'success' | 'error';

/** 一条消息 */
export interface ToastItem {
  /** 自增 id（列表 key 与定时器索引） */
  id: number;
  /** 文案（单行显示，过长自动换行） */
  text: string;
  /** 语气 */
  tone: ToastTone;
}

/** 对外句柄 */
export interface ToastApi {
  /** 当前消息列表（渲染用） */
  items: Ref<ToastItem[]>;
  /** 追加一条（返回 id，便于提前关闭） */
  push: (text: string, tone?: ToastTone, duration?: number) => number;
  /** 立即关闭某条 */
  dismiss: (id: number) => void;
}

/** 默认停留时长（error 给更长，便于看清失败原因） */
const DEFAULT_DURATION: Record<ToastTone, number> = {
  info: 4200,
  success: 3000,
  error: 6500,
};

/** 建一个消息队列（组件作用域内使用；卸载时清理计时器） */
export function useToast(): ToastApi {
  const items = ref<ToastItem[]>([]);
  const timers = new Map<number, number>();
  let seq = 0;

  /** 清掉某条消息的定时器 */
  function clearTimer(id: number): void {
    const timer = timers.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.delete(id);
    }
  }

  /** 关闭并移除某条消息（手动关闭与到期关闭共用） */
  function dismiss(id: number): void {
    clearTimer(id);
    items.value = items.value.filter((item) => item.id !== id);
  }

  /** 追加消息：独立计时，新消息排在末尾（视觉上向下堆叠） */
  function push(text: string, tone: ToastTone = 'info', duration = DEFAULT_DURATION[tone]): number {
    seq += 1;
    const id = seq;
    items.value = [...items.value, { id, text, tone }];
    timers.set(
      id,
      window.setTimeout(() => dismiss(id), duration),
    );
    return id;
  }

  onBeforeUnmount(() => {
    for (const id of [...timers.keys()]) clearTimer(id);
  });

  return { items, push, dismiss };
}
