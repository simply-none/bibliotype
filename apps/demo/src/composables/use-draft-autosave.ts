/**
 * 编辑草稿自动保存（Demo 层持久化策略）
 *
 * 目标：**落盘永不占用输入帧**。三条约束共同保证编辑流畅：
 * - 节流合并：距上次排队不足 `delay` 时不重复排队，且快照在**执行时**取得
 *   （排队期间的新输入天然并入本轮），不存在「一停手就整本写」的尖峰；
 * - 空闲落盘：序列化与 IndexedDB 写入排在浏览器空闲时段（`requestIdleCallback`，
 *   无该 API 的环境回退下一个宏任务），错开按键与绘制帧；
 * - 上限兜底：距上次成功落盘超过 `maxWait` 立即排队，长句连续输入也不会长期未落盘。
 *
 * 数据正确性：
 * - 单飞去重：写入进行中再有变更只置「待写」标记，完成后合并为下一轮，杜绝并发整本写；
 * - 基准对齐：取快照与刷新编辑器保存基准（`markSaved`）在同一同步帧完成，await 期间
 *   产生的新编辑保持未保存状态，不会被误标为「已保存」；
 * - 失败保留脏标记：写入失败（配额 / 环境不支持）保持未保存并定时重试。
 */
import { ref, type Ref } from 'vue';
import type { BookDocument, StorageAdapter } from '@bibliotype/core';
import type { BookEditor } from '@bibliotype/editor';

/** 空闲回调截止信息（`requestIdleCallback` 回调参数的所需子集） */
interface IdleDeadlineLike {
  /** 是否因超时而被强制执行 */
  didTimeout: boolean;
  /** 当前空闲时段剩余预算（ms） */
  timeRemaining: () => number;
}

/** 空闲回调宿主能力（浏览器具备，Node / 旧 Safari 可能缺失） */
interface IdleHost {
  requestIdleCallback?:
    | ((callback: (deadline: IdleDeadlineLike) => void, options?: { timeout?: number }) => number)
    | undefined;
  cancelIdleCallback?: ((handle: number) => void) | undefined;
}

/** 自动保存选项 */
export interface DraftAutosaveOptions {
  /** 取当前编辑器（惰性：编辑模式首次进入才创建，未创建时返回 null） */
  editor: () => BookEditor | null;
  /** 草稿存储适配器 */
  store: StorageAdapter;
  /** 草稿记录 id */
  id: string;
  /** 排队节流间隔（ms，缺省 1200）：连续编辑期间两轮落盘的最小间隔 */
  delay?: number;
  /** 落盘间隔上限（ms，缺省 15000）：距上次成功落盘超过则立即排队 */
  maxWait?: number;
  /** 空闲回调超时（ms，缺省 2000）：浏览器长时间不空闲时的强制执行上限 */
  idleTimeout?: number;
  /** 写入失败后的重试间隔（ms，缺省 3000） */
  retryDelay?: number;
  /** 时间源注入（测试确定性；缺省 `Date.now`） */
  now?: () => number;
}

/** 自动保存句柄 */
export interface DraftAutosave {
  /** 镜像：存在未落盘变更（调用方可在载入 / 重置后自行写入） */
  dirty: Ref<boolean>;
  /** 是否正在写入 */
  saving: Ref<boolean>;
  /** 最近一次成功落盘时刻（本地时间串；null = 本次会话未成功落盘过） */
  savedAt: Ref<string | null>;
  /** 最近一次写入是否失败（失败期间保持 untouched 重试） */
  failed: Ref<boolean>;
  /** 有变更时调用：合并调度一轮落盘 */
  schedule: () => void;
  /** 立即落盘（手动保存 / 退出编辑 / 卸载兜底）；`force` 跳过「无待写」判定 */
  flush: (flushOptions?: { force?: boolean }) => Promise<boolean>;
  /** 取消挂起的调度（不等待在飞写入） */
  cancel: () => void;
  /** 重置状态（还原样册：清脏标记与时刻，不触碰存储） */
  reset: () => void;
  /** 释放：取消调度并等待在飞写入结束 */
  dispose: () => Promise<void>;
}

/** 挂起任务槽（空闲回调或退化宏任务，二选一） */
type PendingSlot =
  | { via: 'idle'; handle: number }
  | { via: 'timer'; handle: ReturnType<typeof setTimeout> };

/**
 * 创建编辑草稿自动保存调度器
 *
 * @param options 选项（编辑器取值器 / 存储适配器 / 记录 id / 各档时限）
 */
export function useDraftAutosave(options: DraftAutosaveOptions): DraftAutosave {
  const delay = options.delay ?? 1200;
  const maxWait = options.maxWait ?? 15000;
  const idleTimeout = options.idleTimeout ?? 2000;
  const retryDelay = options.retryDelay ?? 3000;
  const now = options.now ?? Date.now;

  const dirty = ref(false);
  const saving = ref(false);
  const savedAt = ref<string | null>(null);
  const failed = ref(false);

  /** 最近一次成功落盘的时间戳；创建时取当前时刻（首次落盘同样受 `maxWait` 约束） */
  let lastOkAt = now();
  /** 编辑器保存基准已推进、但内容尚未成功落盘（写失败后的补写标记） */
  let untracked = false;
  /** 在飞写入期间又发生变更：完成后合并一轮 */
  let pending = false;
  /** 节流定时器 */
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** 空闲任务槽 */
  let slot: PendingSlot | null = null;
  /** 失败重试定时器 */
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  /** 在飞写入 */
  let inflight: Promise<boolean> | null = null;
  /** 已释放（卸载后不再调度） */
  let disposed = false;

  /** 清空空闲任务槽 */
  function clearSlot(): void {
    if (slot === null) return;
    if (slot.via === 'idle') (globalThis as IdleHost).cancelIdleCallback?.(slot.handle);
    else clearTimeout(slot.handle);
    slot = null;
  }

  /** 清空全部挂起调度（节流 / 空闲 / 重试） */
  function clearScheduled(): void {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (retryTimer !== undefined) {
      clearTimeout(retryTimer);
      retryTimer = undefined;
    }
    clearSlot();
  }

  /** 排入空闲时段执行；无 `requestIdleCallback` 时退化为下一个宏任务 */
  function queueIdle(timeoutMs: number): void {
    clearSlot();
    const host = globalThis as IdleHost;
    if (host.requestIdleCallback !== undefined) {
      slot = {
        via: 'idle',
        handle: host.requestIdleCallback(
          () => {
            slot = null;
            void runRound();
          },
          { timeout: timeoutMs },
        ),
      };
      return;
    }
    slot = {
      via: 'timer',
      handle: setTimeout(() => {
        slot = null;
        void runRound();
      }, 0),
    };
  }

  /** 失败重试：固定间隔后再排一轮（不依赖编辑器脏标记，覆盖基准已推进的情形） */
  function scheduleRetry(): void {
    if (retryTimer !== undefined || disposed) return;
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      queueIdle(0);
    }, retryDelay);
  }

  /**
   * 执行一轮落盘：同步取快照 + 对齐保存基准，随后异步写入（单飞）。
   *
   * @returns 写入是否成功；无可写内容或已有在飞写入时返回 false。
   */
  async function runRound(): Promise<boolean> {
    if (disposed) return false;
    const editor = options.editor();
    if (editor === null) return false;
    if (inflight !== null) {
      pending = true;
      return false;
    }
    // 快照与保存基准同一同步帧：await 期间的新编辑保持未保存状态
    const snapshot: BookDocument = editor.getSharedDocument();
    editor.markSaved();
    untracked = false;
    dirty.value = false;
    saving.value = true;
    const task = (async (): Promise<boolean> => {
      try {
        await options.store.save(options.id, snapshot);
        lastOkAt = now();
        savedAt.value = new Date(lastOkAt).toLocaleTimeString();
        failed.value = false;
        return true;
      } catch {
        // 写入失败（配额 / 环境不支持）：保持未保存并安排重试
        failed.value = true;
        dirty.value = true;
        untracked = true;
        scheduleRetry();
        return false;
      } finally {
        saving.value = false;
        inflight = null;
      }
    })();
    inflight = task;
    const ok = await task;
    if (pending) {
      pending = false;
      schedule();
    }
    return ok;
  }

  /** 有变更时调用：合并调度（已排队 / 在飞 / 待重试时不重复排队） */
  function schedule(): void {
    if (disposed) return;
    const editor = options.editor();
    if (editor === null) return;
    if (!untracked) {
      dirty.value = editor.isDirty;
      if (!dirty.value) return;
    }
    if (timer !== undefined || slot !== null || retryTimer !== undefined) return;
    if (inflight !== null) {
      pending = true;
      return;
    }
    // 等待时长取「节流档」与「距落盘上限的剩余额度」的较小值：排队后不再复核时限，
    // 故上限必须在这一刻折算进等待时长，持续输入时落盘间隔才不会超过 maxWait
    const remaining = maxWait - (now() - lastOkAt);
    const wait = Math.min(delay, Math.max(0, remaining));
    timer = setTimeout(() => {
      timer = undefined;
      queueIdle(wait > 0 ? idleTimeout : 0);
    }, wait);
  }

  /** 立即落盘（取消挂起调度 → 等在飞写入 → 写一轮） */
  async function flush(flushOptions: { force?: boolean } = {}): Promise<boolean> {
    clearScheduled();
    if (inflight !== null) await inflight;
    const editor = options.editor();
    if (editor === null) return false;
    if (flushOptions.force !== true && !untracked && !editor.isDirty) return true;
    return runRound();
  }

  /** 取消挂起调度（在飞写入继续完成，不阻塞调用方） */
  function cancel(): void {
    clearScheduled();
  }

  /** 重置状态（还原样册后调用） */
  function reset(): void {
    clearScheduled();
    pending = false;
    untracked = false;
    lastOkAt = now();
    dirty.value = false;
    saving.value = false;
    savedAt.value = null;
    failed.value = false;
  }

  /** 释放：停止调度并等待在飞写入 */
  async function dispose(): Promise<void> {
    disposed = true;
    clearScheduled();
    if (inflight !== null) await inflight;
  }

  return { dirty, saving, savedAt, failed, schedule, flush, cancel, reset, dispose };
}
