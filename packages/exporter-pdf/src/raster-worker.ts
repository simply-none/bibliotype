/**
 * 光栅 Worker 池（JPEG 编码离线程）
 *
 * 职责边界：SVG 解码与按 scale 矢量直绘必须留在主线程——foreignObject 排版
 * 渲染依赖 DOM 图像解码，且 drawImage 对 SVG 矢量内容按目标分辨率直绘是
 * 清晰度的来源（先转小位图再放大会糊）。Worker 只做「白底铺底 + 1:1 绘制 +
 * JPEG 编码」：像素量最大的编码段，可多 Worker 并行且完全离主线程。
 *
 * 数据流转全部零拷贝：主线程 `createImageBitmap(canvas)` 后 transfer 位图，
 * Worker 编码出的字节 buffer 也 transfer 回来。
 *
 * Worker 以内联 Blob URL 创建——库产物不依赖打包器的 worker 插件，任何
 * bundler 下行为一致。能力不全（Node / 旧浏览器 / happy-dom）时
 * `supportsWorkerRaster` 返回 false，由调用方整体回退主线程 toBlob 路径。
 */

/** Worker 光栅能力是否齐备（缺任一则走主线程回退路径） */
export function supportsWorkerRaster(): boolean {
  return (
    typeof Worker === 'function' &&
    typeof OffscreenCanvas === 'function' &&
    typeof createImageBitmap === 'function' &&
    typeof MessageChannel === 'function' &&
    typeof Blob === 'function' &&
    typeof URL?.createObjectURL === 'function'
  );
}

/** Worker 源码（内联字符串）：收位图 → 白底 + 1:1 绘制 → JPEG → 字节回传 */
const WORKER_SOURCE = `self.onmessage = async (event) => {
  const { jobId, bitmap, width, height, quality } = event.data;
  try {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    const buffer = await blob.arrayBuffer();
    self.postMessage({ jobId, buffer }, [buffer]);
  } catch (error) {
    bitmap.close();
    self.postMessage({ jobId, error: String((error && error.message) || error) });
  }
};`;

/** 单个 Worker 槽位（在途任务集合，供 onmessage 归账） */
interface WorkerSlot {
  worker: Worker;
  pending: Set<number>;
}

/** Worker 光栅池句柄 */
export interface WorkerRasterPool {
  /**
   * 提交一页编码：位图所有权移交 Worker（调用方不得再使用 / close）
   *
   * @returns JPEG 字节
   */
  encode(
    bitmap: ImageBitmap,
    width: number,
    height: number,
    quality: number,
  ): Promise<Uint8Array>;
  /** 终止全部 Worker（导出结束 / 中止时调用；未完成任务以 AbortError 拒绝） */
  dispose(): void;
}

/**
 * 创建 Worker 光栅池
 *
 * @param workerCount 并行 Worker 数（调用方按 CPU 数与并发窗口收敛）
 */
export function createWorkerRasterPool(workerCount: number): WorkerRasterPool {
  const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
  const slots: WorkerSlot[] = [];
  const jobs = new Map<
    number,
    { resolve: (bytes: Uint8Array) => void; reject: (error: Error) => void }
  >();
  let nextJobId = 0;

  const rejectJob = (jobId: number, error: Error): void => {
    const job = jobs.get(jobId);
    if (job === undefined) return;
    jobs.delete(jobId);
    job.reject(error);
  };

  for (let index = 0; index < workerCount; index += 1) {
    const worker = new Worker(url);
    const slot: WorkerSlot = { worker, pending: new Set() };
    worker.onmessage = (event: MessageEvent) => {
      const { jobId, buffer, error } = event.data as {
        jobId: number;
        buffer?: ArrayBuffer;
        error?: string;
      };
      slot.pending.delete(jobId);
      if (error !== undefined) {
        rejectJob(jobId, new Error(`Worker 光栅化失败：${error}`));
        return;
      }
      const job = jobs.get(jobId);
      if (job === undefined) return;
      jobs.delete(jobId);
      job.resolve(new Uint8Array(buffer!));
    };
    /* Worker 级致命错误（脚本加载失败等）：其在途任务全部拒绝 */
    worker.onerror = () => {
      for (const jobId of [...slot.pending]) {
        slot.pending.delete(jobId);
        rejectJob(jobId, new Error('光栅 Worker 异常终止。'));
      }
    };
    slots.push(slot);
  }
  URL.revokeObjectURL(url);

  const pool: WorkerRasterPool = {
    encode(bitmap, width, height, quality) {
      return new Promise<Uint8Array>((resolve, reject) => {
        /* 空闲优先：选在途最少的槽位（Worker 单消息内自建 canvas，天然可并发） */
        const slot = slots.reduce((least, current) =>
          current.pending.size < least.pending.size ? current : least,
        );
        const jobId = nextJobId;
        nextJobId += 1;
        jobs.set(jobId, { resolve, reject });
        slot.pending.add(jobId);
        slot.worker.postMessage({ jobId, bitmap, width, height, quality }, [bitmap]);
      });
    },
    dispose() {
      for (const [, job] of jobs) {
        job.reject(new DOMException('PDF 导出已中止。', 'AbortError'));
      }
      jobs.clear();
      for (const slot of slots) slot.worker.terminate();
      slots.length = 0;
    },
  };
  return pool;
}
