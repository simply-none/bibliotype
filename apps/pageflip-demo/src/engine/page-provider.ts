/**
 * 页面位图源：把 PageProvider 的绘制结果落到离屏画布上，
 * 供纹理上传。画布按 dpr 缩放，尺寸变化时重建。
 */
import type { PageProvider, PageSize } from './types';

export class PageBitmapSource {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private renderedSize: PageSize = { width: 0, height: 0 };
  private renderedDpr = 0;

  constructor(
    private readonly provider: PageProvider,
    private pageSize: PageSize,
    private readonly dpr: number
  ) {}

  /** 更新页面尺寸（视口变化时），内容缓存随之失效。 */
  setPageSize(size: PageSize): void {
    this.pageSize = size;
  }

  /** 位图像素尺寸（dpr 缩放后）。 */
  get pixelSize(): PageSize {
    return { width: Math.round(this.pageSize.width * this.dpr), height: Math.round(this.pageSize.height * this.dpr) };
  }

  /**
   * 绘制第 pageIndex 页并返回画布（同步）。
   * texImage2D 同步快照画布，单画布复用即可。
   */
  drawPage(pageIndex: number): HTMLCanvasElement {
    const pixel = this.pixelSize;
    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.ctx = this.canvas.getContext('2d');
    }
    if (
      this.renderedSize.width !== this.pageSize.width ||
      this.renderedSize.height !== this.pageSize.height ||
      this.renderedDpr !== this.dpr
    ) {
      this.canvas.width = pixel.width;
      this.canvas.height = pixel.height;
      this.renderedSize = { ...this.pageSize };
      this.renderedDpr = this.dpr;
    }
    const ctx = this.ctx;
    if (!ctx) {
      throw new Error('PageBitmapSource：无法创建 2D 上下文');
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pixel.width, pixel.height);
    this.provider.renderPage(ctx, pageIndex, pixel.width, pixel.height);
    return this.canvas;
  }
}
